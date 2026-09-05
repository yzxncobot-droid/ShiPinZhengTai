/**
 * Telegram video streaming proxy with HTTP Range / 206 Partial Content support.
 *
 * Flow:
 *   Browser → GET /api/telegram-videos/:id/stream (with Range header)
 *   → Access check → DB lookup (file_id, chat_id, message_id)
 *   → Bot API getFile → file_path → fetch from Telegram file URL with Range
 *   → Stream to browser (206 Partial Content)
 *
 * The entire file is NEVER loaded into RAM — the response body is streamed
 * chunk-by-chunk via a ReadableStream reader. No arrayBuffer(), no
 * Buffer.concat(), no disk caching.
 *
 * File size limits:
 *   - Standard Bot API (api.telegram.org): 20 MB (Telegram-imposed)
 *   - Local Bot API Server (TELEGRAM_API_BASE set): up to 2 GB
 * The limit is determined by the Telegram infrastructure in use, not by
 * any artificial MAX_SIZE constant in this code.
 */
import type { Response } from "express";
import { logger } from "../logger";
import { getFileInfo, getFileUrl, refreshFileId, isLocalBotApiConfigured } from "./client";
import { db } from "@workspace/db";
import { telegramVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface StreamParams {
  fileId: string;
  /** Primary key of the telegram_videos row — used for targeted file_id refresh. */
  videoId: string;
  chatId: string;
  messageId: string;
  mimeType: string;
  res: Response;
  rangeHeader?: string;
}

/**
 * Parse a Range header into a { start, end } byte range (inclusive).
 * Returns null for an unsatisfiable range.
 */
function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
  if (start >= fileSize || start > end) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

/**
 * Stream a Telegram video to the HTTP response.
 * Handles Range requests (206 Partial Content) and full requests (200 OK).
 *
 * Range handling rules:
 *   - When the browser requests a Range, we forward it to Telegram.
 *   - We check the UPSTREAM response.status — response.ok is true for both 200
 *     and 206, so it cannot be trusted to confirm the range was honored.
 *   - If upstream returns 206: we verify the Content-Range matches the range we
 *     requested, then stream as 206.
 *   - If upstream returns 200 (ignored the Range): we do NOT send a fake 206.
 *     We skip the leading bytes and serve only the requested range, so the
 *     browser still receives exactly start–end as a genuine 206.
 *   - We never send a Content-Range that doesn't match the bytes we stream.
 *   - We never send the entire file when only a range was requested.
 *
 * If getFile fails with an expired/invalid file_id, the streamer attempts
 * a file_id refresh via forwardMessage — updating ONLY this specific video's
 * record (by primary key), never all videos from the same chat.
 */
export async function streamTelegramVideo({
  fileId, videoId, chatId, messageId, mimeType, res, rangeHeader,
}: StreamParams): Promise<void> {
  let fileInfo;
  try {
    fileInfo = await getFileInfo(fileId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Only attempt file_id refresh for expired/invalid file_id errors.
    // Do NOT refresh for "file is too big" — that's a size limit, not expiry.
    const isFileIdError = errMsg.includes("file_id") ||
      errMsg.includes("file_id_not_found") ||
      errMsg.includes("file_id_expired") ||
      errMsg.includes("wrong file_id") ||
      errMsg.includes("bad file_id");

    if (isFileIdError) {
      logger.info({ videoId, chatId, messageId }, "[TELEGRAM] getFile failed (file_id issue), trying refresh");
      const newFileId = await refreshFileId(chatId, messageId);

      if (newFileId) {
        // BUG FIX: Update ONLY this specific video's file_id by primary key.
        // Previously updated ALL videos from the same chat (by chatId), corrupting
        // other videos' file_ids.
        await db.update(telegramVideosTable).set({
          telegramFileId: newFileId,
          updatedAt: new Date(),
        }).where(eq(telegramVideosTable.id, videoId)).catch(() => {});

        try {
          fileInfo = await getFileInfo(newFileId);
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

  const fileSize = fileInfo.fileSize;
  const fileUrl = getFileUrl(fileInfo.filePath);
  const contentType = mimeType || "video/mp4";

  // ── Parse & validate the browser's Range request ──────────────────────────
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    range = parseRange(rangeHeader, fileSize);
    if (!range) {
      // Unsatisfiable range (e.g. start beyond file size).
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
  // Cache-Control: private, no-store — videos may have permission/premium/private
  // access. A public CDN cache could serve a private/premium video to an
  // unauthorized user. private + no-store ensures the browser/proxy never caches
  // the video body and every request re-authorizes.
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

    // ── Validate upstream status — do NOT trust response.ok ─────────────────
    // response.ok is true for 200 AND 206, so it cannot confirm the Range was
    // honored. We inspect response.status directly.
    const requestedRange = isPartial || start > 0;
    const upstreamStatus = response.status;

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

      // Verify the upstream Content-Range matches what we requested.
      const expectedRange = `bytes ${start}-${end}/${fileSize}`;
      const rangeMatches = upstreamContentRange === expectedRange ||
        upstreamContentRange === `bytes ${start}-${end}/*` ||
        upstreamContentRange === `bytes ${start}-${end}/${fileSize}`;

      if (!rangeMatches) {
        // Upstream returned a different range than requested — do NOT send a
        // fake Content-Range. Abort and return an error.
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

      // Verify Content-Length matches the expected byte count.
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

      // Stream upstream body directly — it contains exactly the requested range.
      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(value);
      }
    } else if (requestedRange && upstreamStatus === 200) {
      // ── Upstream ignored the Range (returned full file as 200) ───────────
      // Do NOT send a fake 206. We already set 206 + Content-Range for the
      // browser, and we will genuinely serve only bytes start–end by skipping
      // the leading bytes and stopping after contentLength bytes. This is a
      // REAL 206 — the bytes streamed match the Content-Range exactly.
      logger.info(
        { videoId, start, end, contentLength },
        "[TELEGRAM] Upstream returned 200 for Range request — skipping to requested range",
      );

      let remaining = contentLength;
      let skipped = 0;

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = value;

        // Skip bytes before the requested start.
        if (skipped < start) {
          const skip = Math.min(chunk.length, start - skipped);
          skipped += skip;
          if (skip < chunk.length) {
            const rest = chunk.subarray(skip);
            const write = Math.min(rest.length, remaining);
            if (write > 0) {
              res.write(write === rest.length ? rest : rest.subarray(0, write));
              remaining -= write;
            }
          }
        } else {
          const write = Math.min(chunk.length, remaining);
          if (write > 0) {
            res.write(write === chunk.length ? chunk : chunk.subarray(0, write));
            remaining -= write;
          }
        }

        if (remaining <= 0) {
          // We've served the full requested range — stop.
          reader.cancel().catch(() => {});
          break;
        }
      }
    } else {
      // ── No range requested, or upstream returned 200 for a full request ──
      // Stream the entire body directly.
      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(value);
      }
    }
  } catch (err) {
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

function handleStreamError(err: unknown, res: Response): void {
  const msg = err instanceof Error ? err.message : String(err);

  // "file is too big" — standard Bot API 20 MB limit.
  // This is a Telegram infrastructure limitation, not an application limit.
  // With a Local Bot API Server (TELEGRAM_API_BASE), this limit is lifted to 2 GB.
  if (msg.includes("too big") || msg.includes("file is too big")) {
    const usingLocalServer = isLocalBotApiConfigured();
    res.status(413).json({
      error: usingLocalServer
        ? "File terlalu besar untuk streaming"
        : "File terlalu besar untuk streaming via Bot API standar",
      detail: usingLocalServer
        ? "File melebihi batas yang dapat ditangani oleh server."
        : "Telegram Bot API standar membatasi download file hingga 20 MB. " +
          "Untuk file lebih besar (hingga 2 GB), jalankan Telegram Local Bot API Server " +
          "dan set environment variable TELEGRAM_API_BASE ke URL server tersebut. " +
          "Tidak ada credential tambahan yang diperlukan — cukup bot token yang sudah ada.",
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

  // Generic error — never expose stack trace or credentials
  res.status(502).json({
    error: "Gagal mengambil file dari Telegram",
    detail: "Terjadi kesalahan saat menghubungi Telegram. Coba lagi nanti.",
  });
}
