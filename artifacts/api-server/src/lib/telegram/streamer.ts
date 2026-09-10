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
import { logger } from "../logger";
import { getFileInfo, getFileUrl, refreshFileId, isLocalBotApiConfigured } from "./client";
import type { TelegramFileInfo } from "./client";
import { isMtProtoReady, getMtProtoFileStream, getMtProtoFileInfo, BOT_API_THRESHOLD } from "./mtproto";
import { shouldUseMtProto } from "./file-provider";
import { db } from "@workspace/db";
import { telegramVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  fileId: string;
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
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
  if (start >= fileSize || start > end) return null;
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

  // ── MTProto path (preferred when available) ──────────────────────────────
  if (shouldUseMtProto(dbFileSize ?? null)) {
    try {
      await streamViaMtProto(params);
      return;
    } catch (err) {
      // If MTProto fails and the file is small enough for Bot API, fallback.
      if (dbFileSize != null && dbFileSize > 0 && dbFileSize <= BOT_API_THRESHOLD) {
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

  // ── Set response headers ──────────────────────────────────────────────────
  res.setHeader("Content-Type", mimeType || "video/mp4");
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
    const streamResult = await getMtProtoFileStream(chatId, messageId, start, isPartial ? end : null);
    await pipeGeneratorWithBackpressure(streamResult.chunks, res, () => aborted);
    logger.info({ videoId }, "[TELEGRAM STREAM] MTProto download completed");
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), videoId, chatId, messageId },
      "[TELEGRAM] MTProto streaming error",
    );
    if (!res.headersSent) {
      handleStreamError(err, res);
    }
  } finally {
    res.off("close", onClose);
    if (!aborted) res.end();
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
// BOT API STREAMING PATH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stream a video via Bot API (getFile + HTTP fetch).
 *
 * Limited to 20 MB by Telegram infrastructure (unless using a Local Bot API
 * Server). Range requests are forwarded to Telegram; the upstream response
 * status (200 vs 206) is carefully validated to ensure the correct bytes
 * are streamed.
 *
 * If getFile fails with "file is too big" and MTProto is available, the
 * caller (streamTelegramVideo) will have already dispatched to the MTProto
 * path. This function is only reached when MTProto is not available or has
 * already failed.
 */
async function streamViaBotApi(params: StreamParams): Promise<void> {
  const { fileId, videoId, chatId, messageId, mimeType, res, rangeHeader } = params;

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
      logger.info({ videoId, chatId, messageId }, "[TELEGRAM] getFile failed (file_id issue), trying refresh");
      const newFileId = await refreshFileId(chatId, messageId);

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
          handleStreamError(err2, res);
          return;
        }
      } else {
        handleStreamError(err, res);
        return;
      }
    } else {
      handleStreamError(err, res);
      return;
    }
  }

  if (!fileInfo) {
    res.status(500).json({ error: "Unable to get file info from Telegram" });
    return;
  }

  logger.info({ videoId }, "[TELEGRAM STREAM] getFile succeeded");

  const fileSize = fileInfo.fileSize;
  const fileUrl = getFileUrl(fileInfo.filePath);
  const contentType = mimeType || "video/mp4";

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

    const response = await fetch(fileUrl, { headers: fetchHeaders });

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
      if (start === 0) {
        logger.info(
          { videoId, fileSize },
          "[TELEGRAM] Upstream returned 200 for Range (start=0) — streaming full file as 200",
        );
        res.status(200);
        res.removeHeader("Content-Range");
        res.setHeader("Content-Length", fileSize.toString());
        await pipeWithBackpressure(reader, res, () => aborted);
      } else {
        logger.warn(
          { videoId, start, end },
          "[TELEGRAM] Upstream returned 200 for Range (start>0) — refusing to waste bandwidth, returning 502",
        );
        reader.cancel().catch(() => {});
        if (!res.headersSent) {
          res.removeHeader("Content-Range");
          res.status(502).json({
            error: "Range request tidak didukung oleh endpoint Telegram",
            detail: "Endpoint file Telegram mengembalikan seluruh file (200) alih-alih range yang diminta. Seeking tidak didukung pada mode ini.",
          });
        }
        return;
      }
    } else {
      await pipeWithBackpressure(reader, res, () => aborted);
    }
  } catch (err) {
    // If the local Bot API server is unreachable during streaming, fall back to MTProto.
    if (isLocalBotApiConfigured() && isMtProtoReady() && !res.headersSent) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (isNetworkError(errMsg)) {
        logger.warn({ videoId }, "[TELEGRAM] Local Bot API Server unreachable during streaming, falling back to MTProto");
        await streamViaMtProto(params);
        return;
      }
    }
    logger.error(
      { err: err instanceof Error ? err.message : String(err), videoId, chatId, messageId },
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
