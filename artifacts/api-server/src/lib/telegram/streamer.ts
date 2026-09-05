/**
 * Telegram video streaming proxy with HTTP Range / 206 Partial Content support.
 *
 * Flow:
 *   Browser → GET /api/telegram-videos/:id/stream (with Range header)
 *   → Access check → DB lookup (file_id, chat_id, message_id)
 *   → Bot API getFile → file_path → fetch from Telegram file URL with Range
 *   → Stream to browser (206 Partial Content)
 *
 * The entire file is NEVER loaded into RAM — the response body is piped.
 *
 * File size limits:
 *   - Standard Bot API (api.telegram.org): 20 MB (Telegram-imposed)
 *   - Local Bot API Server (TELEGRAM_API_BASE set): up to 2 GB
 * The limit is determined by the Telegram infrastructure in use, not by
 * any artificial MAX_SIZE constant in this code.
 */
import type { Response } from "express";
import { logger } from "../logger";
import { getFileInfo, getFileUrl, refreshFileId, isLocalBotApiServer } from "./client";
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
 * Stream a Telegram video to the HTTP response.
 * Handles Range requests (206 Partial Content) and full requests (200 OK).
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

  // Parse Range header.
  let start = 0;
  let end = fileSize - 1;

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      start = parseInt(match[1], 10);
      if (match[2]) end = parseInt(match[2], 10);
      if (end >= fileSize) end = fileSize - 1;
    }
  }

  // Guard against invalid range.
  if (start >= fileSize || start > end) {
    res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
    res.end();
    return;
  }

  const contentLength = end - start + 1;
  const isPartial = !!rangeHeader;

  // Set HTTP headers.
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", contentLength.toString());
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (isPartial) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  } else {
    res.status(200);
  }

  // Fetch the file from Telegram with Range header — stream (pipe) to client.
  let aborted = false;
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  try {
    const fetchHeaders: Record<string, string> = {};
    if (isPartial || start > 0) {
      fetchHeaders["Range"] = `bytes=${start}-${end}`;
    }

    const response = await fetch(fileUrl, { headers: fetchHeaders });

    if (!response.ok) {
      throw new Error(`Telegram file download failed: HTTP ${response.status}`);
    }

    // Pipe the response body to the Express response.
    const body = response.body;
    if (!body) {
      throw new Error("Telegram file response has no body");
    }

    const reader = body.getReader();

    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        res.write(value);
      }
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), videoId, chatId, messageId },
      "[TELEGRAM] Streaming error",
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "Streaming failed" });
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
    const usingLocalServer = isLocalBotApiServer();
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
