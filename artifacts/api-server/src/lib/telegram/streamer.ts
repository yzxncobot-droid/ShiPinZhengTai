/**
 * Telegram video streaming proxy with HTTP Range / 206 Partial Content support.
 *
 * Two file download providers:
 *   - MTProto (iterDownload): used when MTProto is connected. Supports files
 *     of any size (no 20 MB limit). Handles Range via offset-based chunked
 *     download — the browser's Range is mapped directly to an MTProto offset.
 *   - Bot API (getFile + HTTP fetch): fallback when MTProto is not available.
 *     Limited to 20 MB by Telegram infrastructure.
 *
 * Both paths:
 *   - NEVER load the entire file into RAM — chunks are piped with backpressure.
 *   - Support HTTP Range requests (206 Partial Content) for video seeking.
 *   - Use Cache-Control: private, no-store (videos may be premium/private).
 *
 * File size limits:
 *   - MTProto: no limit (determined by server capacity, not Telegram).
 *   - Standard Bot API (api.telegram.org): 20 MB (Telegram-imposed).
 *   - Local Bot API Server (TELEGRAM_API_BASE set): up to 2 GB.
 *
 * If getFile fails with an expired/invalid file_id, the streamer attempts
 * a file_id refresh via forwardMessage — updating ONLY this specific video's
 * record (by primary key), never all videos from the same chat.
 */
import type { Response } from "express";
import { createReadStream } from "fs";
import { statSync } from "fs";
import { logger } from "../logger";
import { getFileInfo, getFileUrl, refreshFileId, isLocalBotApiConfigured } from "./client";
import type { TelegramFileInfo } from "./client";
import { isMtProtoReady, getMtProtoFileStream, getMtProtoFileInfo, BOT_API_THRESHOLD } from "./mtproto";
import { shouldUseMtProto } from "./file-provider";
import { getCachedLocalBotApiHealth } from "./client";
import { db } from "@workspace/db";
import { telegramVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Check if a file path returned by getFile is a local absolute path (from the
 * local Bot API server with --local flag). The local server stores files on
 * disk and returns absolute paths like /var/lib/telegram-bot-api/<token>/...
 * — these can't be fetched via HTTP, so we read them from the filesystem.
 */
function isLocalFilePath(filePath: string): boolean {
  return filePath.startsWith("/");
}

/** Only advertise a video MIME type when the source metadata identifies one. */
export function getVideoContentType(mimeType?: string | null): string {
  const normalized = mimeType?.trim().split(";")[0].toLowerCase();
  return normalized && /^video\/[a-z0-9.+-]+$/.test(normalized)
    ? normalized
    : "application/octet-stream";
}

// ── getFile result cache (Bot API) ──────────────────────────────────────────
// A browser playing a video sends many Range requests in quick succession
// (initial load + seeks). Each Range request previously made a separate Bot API
// getFile call to obtain the file_path — but the path is stable for a given
// file_id (until it expires). Caching eliminates redundant Bot API round-trips,
// cutting latency from ~200ms (network) to ~0ms (memory) on cache hit.
const FILE_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FILE_INFO_CACHE_MAX = 200;

const fileInfoCache = new Map<string, { info: TelegramFileInfo; expiresAt: number }>();

async function getCachedFileInfo(fileId: string): Promise<TelegramFileInfo> {
  const cached = fileInfoCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }
  const info = await getFileInfo(fileId);
  if (fileInfoCache.size >= FILE_INFO_CACHE_MAX) {
    const oldest = fileInfoCache.keys().next().value;
    if (oldest) fileInfoCache.delete(oldest);
  }
  fileInfoCache.set(fileId, { info, expiresAt: Date.now() + FILE_INFO_CACHE_TTL_MS });
  return info;
}

function invalidateFileInfoCache(fileId: string): void {
  fileInfoCache.delete(fileId);
}

// ── Backpressure pipe (Bot API ReadableStream) ──────────────────────────────

async function pipeWithBackpressure(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
  isAborted: () => boolean,
): Promise<void> {
  try {
    while (!isAborted()) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        if (!res.write(value)) {
          await new Promise<void>(resolve => {
            const done = () => { res.off("close", done); res.off("drain", done); resolve(); };
            res.once("drain", done);
            res.once("close", done);
          });
        }
      }
    }
  } finally {
    // Cancel the underlying fetch connection when the client disconnects
    // so the Bot API transfer stops — don't keep downloading in the background.
    if (isAborted()) {
      reader.cancel().catch(() => {});
    }
  }
}

// ── Backpressure pipe (MTProto AsyncGenerator) ───────────────────────────────

async function pipeGeneratorWithBackpressure(
  iter: AsyncGenerator<Buffer>,
  res: Response,
  isAborted: () => boolean,
): Promise<void> {
  try {
    for await (const chunk of iter) {
      if (isAborted()) break;
      if (!res.write(chunk)) {
        await new Promise<void>(resolve => {
          const done = () => { res.off("close", done); res.off("drain", done); resolve(); };
          res.once("drain", done);
          res.once("close", done);
        });
      }
    }
  } finally {
    // Ensure the MTProto download generator is properly cleaned up on abort
    // so the Telegram transfer stops — don't keep downloading in the background.
    if (isAborted()) {
      await iter.return(undefined).catch(() => {});
    }
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface StreamParams {
  fileId: string | null;
  /** Primary key of the telegram_videos row — used for targeted file_id refresh. */
  videoId: string;
  chatId: string;
  messageId: string;
  mimeType: string;
  res: Response;
  rangeHeader?: string;
  /** File size from the database (may be null/0 if unknown). */
  fileSize?: number | null;
}

/**
 * Parse a Range header into a { start, end } byte range (inclusive).
 * Returns null for an unsatisfiable range.
 */
function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  if (rangeHeader.includes(",")) return null; // multi-range not supported
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startText, endText] = match;

  // RFC 9110 also permits suffix ranges such as bytes=-500, which browsers
  // may use when probing media near the end of a file.
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || fileSize <= 0) return null;
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : fileSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= fileSize || start > end) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stream a Telegram video to the HTTP response.
 *
 * Dispatches to the MTProto path or Bot API path based on provider selection.
 * If the selected provider fails, falls back to the other (when applicable).
 */
export async function streamTelegramVideo(params: StreamParams): Promise<void> {
  const { fileSize: dbFileSize, videoId } = params;

  // ═════════════════════════════════════════════════════════════════════════
  // NEW: Dedicated large-file path (>20 MB)
  // ═════════════════════════════════════════════════════════════════════════
  // Files above the Bot API 20 MB threshold get a dedicated streaming path
  // that prioritizes MTProto (no size limit) and falls back to the Local Bot
  // API Server when healthy. This path is completely separate from the
  // ≤20 MB Bot API path below, which remains unchanged.
  if (dbFileSize != null && dbFileSize > BOT_API_THRESHOLD) {
    await streamLargeFile(params);
    return;
  }

  // ── MTProto path (preferred when available) ──────────────────────────────
  if (shouldUseMtProto(dbFileSize ?? null)) {
    try {
      await streamViaMtProto(params);
      return;
    } catch (err) {
      // If MTProto fails and the file is small enough for Bot API, fallback.
      if (
        !params.res.headersSent &&
        params.fileId &&
        (dbFileSize == null || dbFileSize <= BOT_API_THRESHOLD)
      ) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), videoId },
          "[TELEGRAM] MTProto failed, falling back to Bot API",
        );
        // Continue to Bot API path below.
      } else {
        // Can't fallback — large file requires MTProto.
        if (!params.res.headersSent) handleStreamError(err, params.res);
        return;
      }
    }
  }

  // ── Bot API path ──────────────────────────────────────────────────────────
  // If fileId is null (AutoUP video) and we fell through to here, Bot API
  // can't work — it requires a file_id. Try MTProto as a fallback if available.
  if (!params.fileId) {
    if (isMtProtoReady()) {
      try {
        await streamViaMtProto(params);
        return;
      } catch (err) {
        if (!params.res.headersSent) handleStreamError(err, params.res);
        return;
      }
    }
    if (!params.res.headersSent) {
      params.res.status(503).json({
        error: "MTProto tidak tersedia dan video tidak memiliki file_id",
        detail: "Video ini diimpor via AutoUP (tanpa file_id). Streaming memerlukan MTProto yang aktif. Pastikan TELEGRAM_API_ID dan TELEGRAM_API_HASH telah dikonfigurasi.",
      });
    }
    return;
  }

  await streamViaBotApi(params);
}

// ═══════════════════════════════════════════════════════════════════════════
// LARGE-FILE STREAMING PATH (>20 MB) — COMPLETELY SEPARATE FROM ≤20 MB PATH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dedicated streaming path for files above the Bot API 20 MB threshold.
 *
 * This path is COMPLETELY SEPARATE from the ≤20 MB Bot API path — it has its
 * own getFile logic, its own local-file streaming, and its own HTTP streaming.
 * It does NOT call streamViaBotApi, streamViaBotApiHttp, or streamLocalFile
 * used by the small-file path. This ensures changes to large-file streaming
 * never affect the working small-file path, and vice versa.
 *
 * Strategy (in priority order):
 *   1. MTProto (iterDownload with offset) — no file size limit. Used when
 *      MTProto is connected and ready, regardless of Local Bot API config.
 *   2. Local Bot API Server — supports files up to 2 GB. Used when MTProto is
 *      not available and the local server is healthy. Uses a 120 s timeout
 *      for getFile (the local server downloads the file from Telegram first,
 *      which can take time for large files) and NEVER falls back to
 *      api.telegram.org (which can't handle files >20 MB).
 *   3. Clear error — neither provider can handle the large file.
 */
async function streamLargeFile(params: StreamParams): Promise<void> {
  const { videoId, fileId, res } = params;

  // ── 1. Try MTProto first (no size limit) ──────────────────────────────────
  if (isMtProtoReady()) {
    try {
      await streamViaMtProto(params);
      return;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), videoId },
        "[TELEGRAM] Large-file: MTProto streaming failed",
      );
      // Never start another provider after writing part of the response.
      if (res.headersSent) return;
      // Fall through to Local Bot API if healthy.
      if (getCachedLocalBotApiHealth() === true && fileId) {
        logger.warn({ videoId }, "[TELEGRAM] Large-file: falling back to Local Bot API Server");
        try {
          await streamLargeFileViaLocalBotApi(params);
          return;
        } catch (botApiErr) {
          logger.error(
            { err: botApiErr instanceof Error ? botApiErr.message : String(botApiErr), videoId },
            "[TELEGRAM] Large-file: Local Bot API fallback also failed",
          );
          if (!res.headersSent) handleStreamError(botApiErr, res);
          return;
        }
      }
      // No fallback available.
      if (!res.headersSent) handleStreamError(err, res);
      return;
    }
  }

  // ── 2. Try Local Bot API Server (up to 2 GB) ─────────────────────────────
  if (getCachedLocalBotApiHealth() === true && fileId) {
    try {
      await streamLargeFileViaLocalBotApi(params);
      return;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), videoId },
        "[TELEGRAM] Large-file: Local Bot API streaming failed",
      );
      if (!res.headersSent) handleStreamError(err, res);
      return;
    }
  }

  // ── 3. Neither provider available — clear error ──────────────────────────
  logger.error({ videoId, fileSize: params.fileSize }, "[TELEGRAM] Large-file: no streaming provider available for >20 MB file");
  if (!res.headersSent) {
    res.status(503).json({
      error: "Video gagal diputar",
      detail: "File terlalu besar untuk streaming via Bot API standar — " +
        "diperlukan MTProto (TELEGRAM_API_ID + TELEGRAM_API_HASH) atau Local Bot API Server yang aktif " +
        "untuk file di atas 20 MB.",
    });
  }
}

// ── Large-file: getFile with file_id refresh (separate from small-file path) ─

/**
 * Fetch file info for a large file via the Local Bot API Server.
 *
 * This is a DEDICATED function for the >20 MB path — it does NOT share the
 * getCachedFileInfo cache or getFileInfo logic with the small-file path.
 * It uses a 120 s timeout (the local server downloads the file from Telegram
 * first) and NEVER falls back to api.telegram.org (which can't handle >20 MB).
 *
 * Handles file_id expiry by refreshing via forwardMessage, updating only this
 * specific video's DB record.
 */
async function getLargeFileInfo(params: StreamParams): Promise<TelegramFileInfo> {
  const { fileId, videoId, chatId, messageId } = params;
  if (!fileId) {
    throw new Error("Large-file Local Bot API streaming requires a Telegram file_id");
  }

  try {
    return await getFileInfo(fileId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Only attempt file_id refresh for expired/invalid file_id errors.
    const isFileIdError =
      errMsg.includes("file_id") ||
      errMsg.includes("file_id_not_found") ||
      errMsg.includes("file_id_expired") ||
      errMsg.includes("wrong file_id") ||
      errMsg.includes("bad file_id");

    if (!isFileIdError) throw err;

    logger.info({ videoId, chatId, messageId }, "[TELEGRAM] Large-file: getFile failed (file_id issue), trying refresh");
    const newFileId = await refreshFileId(chatId, messageId);

    if (!newFileId) throw err;

    // Update ONLY this specific video's file_id by primary key.
    await db
      .update(telegramVideosTable)
      .set({ telegramFileId: newFileId, updatedAt: new Date() })
      .where(eq(telegramVideosTable.id, videoId))
      .catch(() => {});

    return await getFileInfo(newFileId);
  }
}

// ── Large-file: stream via Local Bot API Server (dedicated, separate) ───────

/**
 * Stream a large file (>20 MB) via the Local Bot API Server.
 *
 * This function is COMPLETELY SEPARATE from the small-file streamViaBotApi /
 * streamViaBotApiHttp / streamLocalFile functions. It has its own:
 *   - getFile logic (getLargeFileInfo — 120 s timeout, no fallback)
 *   - local file streaming (createReadStream with Range)
 *   - HTTP streaming (fetch with Range, backpressure pipe)
 *
 * The local Bot API server with --local stores files on disk and returns
 * absolute paths (e.g. /var/lib/telegram-bot-api/<token>/...). We read these
 * directly from the filesystem (the volume is mounted read-only in compose).
 * For non-local paths, we fetch via HTTP with Range support.
 */
async function streamLargeFileViaLocalBotApi(params: StreamParams): Promise<void> {
  const { videoId, mimeType, res, rangeHeader } = params;

  // ── 1. Get file info (120 s timeout, no fallback to api.telegram.org) ────
  const fileInfo = await getLargeFileInfo(params);

  logger.info({ videoId, fileSize: fileInfo.fileSize, filePath: fileInfo.filePath }, "[TELEGRAM STREAM] Large-file: getFile succeeded");

  // ── 2. Determine file size & parse Range ──────────────────────────────────
  let fileSize = fileInfo.fileSize;

  // If the file path is local (absolute), use statSync for the real size.
  const isLocal = isLocalFilePath(fileInfo.filePath);
  if (isLocal) {
    try {
      fileSize = statSync(fileInfo.filePath).size;
    } catch {
      // File not on disk — fall through to HTTP path with fileInfo.fileSize.
      logger.warn({ videoId, filePath: fileInfo.filePath }, "[TELEGRAM] Large-file: local file not found on disk, trying HTTP");
    }
  }

  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    range = parseRange(rangeHeader, fileSize);
    if (!range) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      res.end();
      return;
    }
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : fileSize - 1;
  const contentLength = end - start + 1;
  const isPartial = !!range;

  // ── 3. Set response headers ───────────────────────────────────────────────
  res.setHeader("Content-Type", getVideoContentType(mimeType));
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", contentLength.toString());
  res.setHeader("Cache-Control", "private, no-store");

  if (isPartial) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  } else {
    res.status(200);
  }

  let aborted = false;
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  try {
    if (isLocal) {
      // ── 3a. Stream from local filesystem ─────────────────────────────────
      logger.info({ videoId, fileSize, provider: "large-local-file" }, "[TELEGRAM STREAM] Large-file: local file path");
      const stream = createReadStream(fileInfo.filePath, { start, end });
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
          if (aborted) { stream.destroy(); return; }
          if (!res.write(chunk)) {
            stream.pause();
            res.once("drain", () => stream.resume());
          }
        });
        stream.on("end", resolve);
        stream.on("error", reject);
        res.on("close", () => { stream.destroy(); resolve(); });
      });
      logger.info({ videoId }, "[TELEGRAM STREAM] Large-file: local file stream completed");
    } else {
      // ── 3b. Stream via HTTP fetch from local Bot API server ───────────────
      logger.info({ videoId, fileSize, provider: "large-http" }, "[TELEGRAM STREAM] Large-file: HTTP path");

      const fileUrl = getFileUrl(fileInfo.filePath);
      const fetchHeaders: Record<string, string> = {};
      if (isPartial || start > 0) {
        fetchHeaders["Range"] = `bytes=${start}-${end}`;
      }

      // Generous connect timeout (120 s) — the local server may need time
      // to download from Telegram before responding. Once headers arrive,
      // the stream continues without a deadline.
      const downloadController = new AbortController();
      const connectTimer = setTimeout(() => downloadController.abort(), 120_000);

      let response: globalThis.Response;
      try {
        response = await fetch(fileUrl, {
          headers: fetchHeaders,
          signal: downloadController.signal,
        });
      } catch (fetchErr: any) {
        clearTimeout(connectTimer);
        if (fetchErr?.name === "AbortError") {
          throw new Error("File download timeout — server terlalu lambat merespons (mungkin file terlalu besar)");
        }
        throw fetchErr;
      }
      clearTimeout(connectTimer);

      if (response.status >= 400) {
        throw new Error(`Telegram file download failed: HTTP ${response.status}`);
      }

      const body = response.body;
      if (!body) throw new Error("Telegram file response has no body");

      const reader = body.getReader();
      const requestedRange = isPartial || start > 0;
      const upstreamStatus = response.status;

      logger.info({ videoId, upstreamStatus, requestedRange }, "[TELEGRAM STREAM] Large-file: upstream status");

      if (requestedRange && upstreamStatus === 206) {
        // Upstream honored the Range — pipe directly.
        await pipeWithBackpressure(reader, res, () => aborted);
      } else if (requestedRange && upstreamStatus === 200) {
        // Upstream ignored Range — skip leading bytes and serve requested range.
        logger.info({ videoId, start, end }, "[TELEGRAM] Large-file: upstream returned 200, skipping leading bytes");
        const bytesToStream = end - start + 1;
        let bytesSkipped = 0;
        let bytesSent = 0;

        try {
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            let chunk = Buffer.from(value);

            if (bytesSkipped < start) {
              const toSkip = Math.min(start - bytesSkipped, chunk.length);
              chunk = chunk.subarray(toSkip);
              bytesSkipped += toSkip;
              if (chunk.length === 0) continue;
            }

            const remaining = bytesToStream - bytesSent;
            if (remaining <= 0) break;

            if (chunk.length > remaining) {
              chunk = chunk.subarray(0, remaining) as Buffer;
              bytesSent += remaining;
              if (!res.write(chunk)) {
                await new Promise<void>(resolve => {
                  const doneFn = () => { res.off("close", doneFn); res.off("drain", doneFn); resolve(); };
                  res.once("drain", doneFn);
                  res.once("close", doneFn);
                });
              }
              break;
            }

            bytesSent += chunk.length;
            if (!res.write(chunk)) {
              await new Promise<void>(resolve => {
                const doneFn = () => { res.off("close", doneFn); res.off("drain", doneFn); resolve(); };
                res.once("drain", doneFn);
                res.once("close", doneFn);
              });
            }
          }
        } finally {
          if (aborted) reader.cancel().catch(() => {});
        }
      } else {
        // Full file (no Range requested) — pipe directly.
        await pipeWithBackpressure(reader, res, () => aborted);
      }

      logger.info({ videoId }, "[TELEGRAM STREAM] Large-file: HTTP stream completed");
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), videoId },
      "[TELEGRAM] Large-file: streaming error",
    );
    if (!res.headersSent) {
      handleStreamError(err, res);
    }
  } finally {
    res.off("close", onClose);
    if (!aborted) res.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MTProto STREAMING PATH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stream a video via MTProto (iterDownload with offset).
 *
 * This path supports files of any size — no 20 MB limit. The browser's Range
 * header is mapped directly to an MTProto download offset, so seeking works
 * natively. File reference recovery is handled internally by the MTProto client.
 */
async function streamViaMtProto(params: StreamParams): Promise<void> {
  const { videoId, chatId, messageId, mimeType, res, rangeHeader, fileSize: dbFileSize } = params;

  // ── Determine file size ──────────────────────────────────────────────────
  // Prefer the DB file size; if missing, fetch via MTProto (getMessages).
  let fileSize = dbFileSize;
  if (!fileSize || fileSize <= 0) {
    try {
      const info = await getMtProtoFileInfo(chatId, messageId);
      fileSize = info.fileSize;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), videoId },
        "[TELEGRAM MTProto] Failed to get file info",
      );
      throw err;
    }
  }

  logger.info({ videoId, fileSize, provider: "mtproto" }, "[TELEGRAM STREAM] MTProto path selected");

  // ── Parse Range ──────────────────────────────────────────────────────────
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    range = parseRange(rangeHeader, fileSize);
    if (!range) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      res.end();
      return;
    }
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : fileSize - 1;
  const contentLength = end - start + 1;
  const isPartial = !!range;

  // Open the Telegram message and read the first chunk before committing
  // HTTP headers. This lets the large-file path safely fall back to the
  // Local Bot API if MTProto cannot resolve/download the message.
  const streamResult = await getMtProtoFileStream(chatId, messageId, start, isPartial ? end : null);
  const firstChunk = await streamResult.chunks.next();
  if (firstChunk.done) {
    throw new Error("MTProto returned no video data");
  }

  // ── Set response headers only after MTProto is confirmed to be readable ──
  res.setHeader("Content-Type", getVideoContentType(mimeType));
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", contentLength.toString());
  res.setHeader("Cache-Control", "private, no-store");

  if (isPartial) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  } else {
    res.status(200);
  }

  // ── Get MTProto stream and pipe to response ──────────────────────────────
  let aborted = false;
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  try {
    async function* streamWithPrefetchedChunk(): AsyncGenerator<Buffer> {
      yield firstChunk.value;
      yield* streamResult.chunks;
    }

    await pipeGeneratorWithBackpressure(streamWithPrefetchedChunk(), res, () => aborted);
    logger.info({ videoId }, "[TELEGRAM STREAM] MTProto download completed");
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), videoId, chatId, messageId },
      "[TELEGRAM] MTProto streaming error",
    );
    // Once bytes have been sent, switching providers would corrupt the file.
    // End the partial response and let the caller avoid a second response.
    if (res.headersSent) res.destroy();
    throw err;
  } finally {
    res.off("close", onClose);
    if (!aborted && !res.writableEnded) res.end();
  }
}

// ── Network error detection ─────────────────────────────────────────────────

/** Check if an error message indicates a network/connection failure. */
function isNetworkError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("eai_again")
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL FILE STREAMING PATH (Local Bot API Server with --local)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stream a video from the local filesystem when the local Bot API server
 * (with --local flag) returns an absolute file path. The --local flag stores
 * files on disk but doesn't serve them via HTTP, so we read them directly.
 */
async function streamLocalFile(
  params: StreamParams,
  fileInfo: TelegramFileInfo,
): Promise<void> {
  const { videoId, mimeType, res, rangeHeader } = params;
  const filePath = fileInfo.filePath;

  // Determine file size — prefer statSync for accuracy, fall back to fileInfo.
  let fileSize: number;
  try {
    const stat = statSync(filePath);
    fileSize = stat.size;
  } catch {
    // File not found on local filesystem — fall through to HTTP path.
    logger.warn({ videoId, filePath }, "[TELEGRAM STREAM] Local file not found, falling back to HTTP");
    return streamViaBotApiHttp(params, fileInfo);
  }

  logger.info({ videoId, fileSize, provider: "local-file" }, "[TELEGRAM STREAM] Local file path selected");

  // Parse Range
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    range = parseRange(rangeHeader, fileSize);
    if (!range) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      res.end();
      return;
    }
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : fileSize - 1;
  const contentLength = end - start + 1;
  const isPartial = !!range;

  // Set response headers
  res.setHeader("Content-Type", getVideoContentType(mimeType));
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", contentLength.toString());
  res.setHeader("Cache-Control", "private, no-store");

  if (isPartial) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  } else {
    res.status(200);
  }

  // Create read stream with byte range and pipe to response
  let aborted = false;
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  try {
    const stream = createReadStream(filePath, { start, end });
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        if (aborted) { stream.destroy(); return; }
        if (!res.write(chunk)) {
          stream.pause();
          res.once("drain", () => stream.resume());
        }
      });
      stream.on("end", resolve);
      stream.on("error", reject);
      res.on("close", () => { stream.destroy(); resolve(); });
    });
    logger.info({ videoId }, "[TELEGRAM STREAM] Local file stream completed");
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), videoId },
      "[TELEGRAM] Local file streaming error",
    );
    if (!res.headersSent) {
      handleStreamError(err, res);
    }
  } finally {
    res.off("close", onClose);
    if (!aborted) res.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT API STREAMING PATH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stream a video via Bot API. Dispatches to local file reading (when the local
 * Bot API server with --local returns an absolute path) or HTTP fetch.
 */
async function streamViaBotApi(params: StreamParams): Promise<void> {
  const { fileId, videoId } = params;
  if (!fileId) {
    throw new Error("Telegram Bot API streaming requires a file_id");
  }

  let fileInfo;
  try {
    fileInfo = await getCachedFileInfo(fileId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // If the local Bot API server is unreachable, fall back to MTProto.
    if (isLocalBotApiConfigured() && isMtProtoReady() && isNetworkError(errMsg)) {
      logger.warn({ videoId }, "[TELEGRAM] Local Bot API Server unreachable, falling back to MTProto");
      await streamViaMtProto(params);
      return;
    }

    // If the file is too big for Bot API and MTProto is ready, fallback.
    if (isMtProtoReady() && (errMsg.includes("too big") || errMsg.includes("file is too big"))) {
      logger.info({ videoId }, "[TELEGRAM] File too big for Bot API, falling back to MTProto");
      await streamViaMtProto(params);
      return;
    }

    // Only attempt file_id refresh for expired/invalid file_id errors.
    const isFileIdError = errMsg.includes("file_id") ||
      errMsg.includes("file_id_not_found") ||
      errMsg.includes("file_id_expired") ||
      errMsg.includes("wrong file_id") ||
      errMsg.includes("bad file_id");

    if (isFileIdError) {
      logger.info({ videoId, chatId: params.chatId, messageId: params.messageId }, "[TELEGRAM] getFile failed (file_id issue), trying refresh");
      const newFileId = await refreshFileId(params.chatId, params.messageId);

      if (newFileId) {
        await db.update(telegramVideosTable).set({
          telegramFileId: newFileId,
          updatedAt: new Date(),
        }).where(eq(telegramVideosTable.id, videoId)).catch(() => {});

        invalidateFileInfoCache(fileId);

        try {
          fileInfo = await getCachedFileInfo(newFileId);
        } catch (err2) {
          logger.error({ err: err2 instanceof Error ? err2.message : String(err2) }, "[TELEGRAM] Refreshed getFile also failed");
          handleStreamError(err2, params.res);
          return;
        }
      } else {
        handleStreamError(err, params.res);
        return;
      }
    } else {
      handleStreamError(err, params.res);
      return;
    }
  }

  if (!fileInfo) {
    params.res.status(500).json({ error: "Unable to get file info from Telegram" });
    return;
  }

  logger.info({ videoId }, "[TELEGRAM STREAM] getFile succeeded");

  // Dispatch to local file or HTTP path based on the file_path format.
  if (isLocalFilePath(fileInfo.filePath)) {
    await streamLocalFile(params, fileInfo);
    return;
  }

  await streamViaBotApiHttp(params, fileInfo);
}

/**
 * Stream a video via Bot API HTTP fetch (standard Bot API or local server
 * without --local). Range requests are forwarded to Telegram; the upstream
 * response status (200 vs 206) is carefully validated to ensure the correct
 * bytes are streamed.
 *
 * If getFile fails with "file is too big" and MTProto is available, the
 * caller (streamTelegramVideo) will have already dispatched to the MTProto
 * path. This function is only reached when MTProto is not available or has
 * already failed.
 */
async function streamViaBotApiHttp(params: StreamParams, fileInfo: TelegramFileInfo): Promise<void> {
  const { videoId, mimeType, res, rangeHeader } = params;

  logger.info({ videoId }, "[TELEGRAM STREAM] getFile succeeded (HTTP path)");

  const fileSize = fileInfo.fileSize;
  const fileUrl = getFileUrl(fileInfo.filePath);
  const contentType = getVideoContentType(mimeType);

  // ── Parse & validate the browser's Range request ──────────────────────────
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    range = parseRange(rangeHeader, fileSize);
    if (!range) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      res.end();
      return;
    }
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : fileSize - 1;
  const contentLength = end - start + 1;
  const isPartial = !!range;

  // ── Set response headers ───────────────────────────────────────────────────
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", contentLength.toString());
  res.setHeader("Cache-Control", "private, no-store");

  if (isPartial) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  } else {
    res.status(200);
  }

  // ── Fetch from Telegram with Range and stream (pipe) to the client ─────────
  let aborted = false;
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  try {
    const fetchHeaders: Record<string, string> = {};
    if (isPartial || start > 0) {
      fetchHeaders["Range"] = `bytes=${start}-${end}`;
    }

    // Use an AbortController with a generous connect timeout (120 s).
    // For large files the local Bot API server may need time to download
    // from Telegram before responding. The timeout covers the initial
    // connection only — once headers arrive, the stream continues
    // without a deadline (streaming may take minutes for big files).
    const downloadController = new AbortController();
    const connectTimer = setTimeout(() => downloadController.abort(), 120_000);

    let response: globalThis.Response;
    try {
      response = await fetch(fileUrl, {
        headers: fetchHeaders,
        signal: downloadController.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(connectTimer);
      if (fetchErr?.name === "AbortError") {
        throw new Error("File download timeout — server terlalu lambat merespons (mungkin file terlalu besar)");
      }
      throw fetchErr;
    }
    clearTimeout(connectTimer);

    const requestedRange = isPartial || start > 0;
    const upstreamStatus = response.status;

    logger.info({ videoId, upstreamStatus, requestedRange }, "[TELEGRAM STREAM] upstream status");

    if (upstreamStatus >= 400) {
      throw new Error(`Telegram file download failed: HTTP ${upstreamStatus}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error("Telegram file response has no body");
    }

    const reader = body.getReader();

    if (requestedRange && upstreamStatus === 206) {
      // ── Upstream honored the Range — verify Content-Range matches ─────────
      const upstreamContentRange = response.headers.get("content-range") || "";
      const upstreamContentLength = parseInt(response.headers.get("content-length") || "", 10);

      const expectedRange = `bytes ${start}-${end}/${fileSize}`;
      const rangeMatches = upstreamContentRange === expectedRange ||
        upstreamContentRange === `bytes ${start}-${end}/*`;

      if (!rangeMatches) {
        logger.warn(
          { expected: expectedRange, got: upstreamContentRange, videoId },
          "[TELEGRAM] Upstream Content-Range mismatch",
        );
        reader.cancel().catch(() => {});
        if (!res.headersSent) {
          res.status(502).json({ error: "Range mismatch dari Telegram" });
        }
        return;
      }

      if (!Number.isNaN(upstreamContentLength) && upstreamContentLength !== contentLength) {
        logger.warn(
          { expected: contentLength, got: upstreamContentLength, videoId },
          "[TELEGRAM] Upstream Content-Length mismatch on 206",
        );
        reader.cancel().catch(() => {});
        if (!res.headersSent) {
          res.status(502).json({ error: "Content-Length mismatch dari Telegram" });
        }
        return;
      }

      await pipeWithBackpressure(reader, res, () => aborted);
    } else if (requestedRange && upstreamStatus === 200) {
      // Upstream ignored the Range header and returned the full file (200).
      // Skip the leading bytes we don't need and stream only the requested
      // range. This handles both start=0 (full file) and start>0 (seeking)
      // without wasting bandwidth or returning an error to the client.
      logger.info(
        { videoId, fileSize, start, end, upstreamStatus },
        "[TELEGRAM] Upstream returned 200 for Range — skipping leading bytes and serving requested range",
      );
      const bytesToStream = end - start + 1;
      let bytesSkipped = 0;
      let bytesSent = 0;

      try {
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          let chunk = Buffer.from(value);

          // Skip leading bytes before the requested start offset.
          if (bytesSkipped < start) {
            const toSkip = Math.min(start - bytesSkipped, chunk.length);
            chunk = chunk.subarray(toSkip);
            bytesSkipped += toSkip;
            if (chunk.length === 0) continue;
          }

          // Limit to the requested byte range.
          const remaining = bytesToStream - bytesSent;
          if (remaining <= 0) break;

          if (chunk.length > remaining) {
            chunk = chunk.subarray(0, remaining) as Buffer;
            bytesSent += remaining;
            if (!res.write(chunk)) {
              await new Promise<void>(resolve => {
                const doneFn = () => { res.off("close", doneFn); res.off("drain", doneFn); resolve(); };
                res.once("drain", doneFn);
                res.once("close", doneFn);
              });
            }
            break;
          }

          bytesSent += chunk.length;
          if (!res.write(chunk)) {
            await new Promise<void>(resolve => {
              const doneFn = () => { res.off("close", doneFn); res.off("drain", doneFn); resolve(); };
              res.once("drain", doneFn);
              res.once("close", doneFn);
            });
          }
        }
      } finally {
        if (aborted) reader.cancel().catch(() => {});
      }
    } else {
      await pipeWithBackpressure(reader, res, () => aborted);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Fall back to MTProto for any error (network, HTTP 404/5xx, etc.) as long
    // as no response bytes have been sent yet. The local Bot API server can
    // return 404 for file downloads (expired/cleaned-up file paths), and the
    // standard Bot API can fail for various reasons — MTProto handles both.
    if (isMtProtoReady() && !res.headersSent) {
      logger.warn(
        { err: errMsg, videoId },
        "[TELEGRAM] Bot API streaming failed, falling back to MTProto",
      );
      await streamViaMtProto(params);
      return;
    }

    logger.error(
      { err: errMsg, videoId },
      "[TELEGRAM] Streaming error",
    );
    if (!res.headersSent) {
      handleStreamError(err, res);
    }
  } finally {
    res.off("close", onClose);
    if (!aborted) res.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

function handleStreamError(err: unknown, res: Response): void {
  const msg = err instanceof Error ? err.message : String(err);

  // "file is too big" — standard Bot API 20 MB limit.
  if (msg.includes("too big") || msg.includes("file is too big")) {
    const mtProtoReady = isMtProtoReady();
    const usingLocalServer = isLocalBotApiConfigured();
    res.status(413).json({
      error: "File terlalu besar untuk streaming via Bot API standar",
      detail: mtProtoReady
        ? "File melebihi batas Bot API (20 MB). MTProto seharusnya digunakan tetapi gagal."
        : usingLocalServer
          ? "File melebihi batas yang dapat ditangani oleh server."
          : "Telegram Bot API standar membatasi download file hingga 20 MB. " +
            "Set TELEGRAM_API_ID dan TELEGRAM_API_HASH untuk mengaktifkan MTProto streaming " +
            "yang mendukung file berukuran besar tanpa batas 20 MB.",
    });
    return;
  }

  // Rate limit
  if (msg.includes("429") || msg.includes("Too Many Requests")) {
    res.status(429).json({
      error: "Rate limit tercapai",
      detail: "Telegram membatasi jumlah request. Coba lagi dalam beberapa saat.",
    });
    return;
  }

  // Invalid/expired file_id that couldn't be refreshed
  if (msg.includes("file_id") || msg.includes("file_id_not_found")) {
    res.status(502).json({
      error: "File ID kadaluarsa",
      detail: "File ID Telegram sudah kadaluarsa dan tidak dapat diperbarui. Coba import ulang video dengan forward ke bot.",
    });
    return;
  }

  // MTProto-specific errors
  if (msg.includes("MTProto") || msg.includes("not initialized")) {
    res.status(503).json({
      error: "MTProto tidak tersedia",
      detail: "Layanan MTProto belum siap atau tidak dikonfigurasi. Pastikan TELEGRAM_API_ID dan TELEGRAM_API_HASH telah diset.",
    });
    return;
  }

  // Message not found / not accessible
  if (msg.includes("Message not found") || msg.includes("not accessible")) {
    res.status(404).json({
      error: "Video tidak ditemukan di Telegram",
      detail: "Pesan Telegram tidak dapat diakses. Bot mungkin tidak memiliki akses ke chat ini.",
    });
    return;
  }

  // Generic error — never expose stack trace or credentials
  res.status(502).json({
    error: "Gagal mengambil file dari Telegram",
    detail: "Terjadi kesalahan saat menghubungi Telegram. Coba lagi nanti.",
  });
}
