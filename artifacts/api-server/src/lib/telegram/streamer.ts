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
 * Bot API getFile limit: 20 MB per file. This is a Telegram-imposed external
 * limitation. Larger files return a clear error explaining the limit.
 */
import type { Response } from "express";
import { logger } from "../logger";
import { getFileInfo, getFileUrl, refreshFileId } from "./client";
import { db } from "@workspace/db";
import { telegramVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface StreamParams {
  fileId: string;
  chatId: string;
  messageId: string;
  mimeType: string;
  res: Response;
  rangeHeader?: string;
}

/**
 * Stream a Telegram video to the HTTP response.
 * Handles Range requests (206 Partial Content) and full requests (200 OK).
 */
export async function streamTelegramVideo({
  fileId, chatId, messageId, mimeType, res, rangeHeader,
}: StreamParams): Promise<void> {
  let fileInfo;
  try {
    fileInfo = await getFileInfo(fileId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // If file_id expired, try to refresh it by forwarding the message.
    if (errMsg.includes("file_id") || errMsg.includes("file is too big") || errMsg.includes("400")) {
      logger.info({ chatId, messageId }, "[TELEGRAM] getFile failed, trying file_id refresh");
      const newFileId = await refreshFileId(chatId, messageId);

      if (newFileId) {
        // Update the stored file_id in the database.
        await db.update(telegramVideosTable).set({
          telegramFileId: newFileId,
          updatedAt: new Date(),
        }).where(
          eq(telegramVideosTable.telegramChatId, chatId) as any,
        ).catch(() => {});

        try {
          fileInfo = await getFileInfo(newFileId);
        } catch (err2) {
          logger.error({ err: err2 instanceof Error ? err2.message : String(err2) }, "[TELEGRAM] Refreshed getFile also failed");
          handleStreamError(err2, res, true);
          return;
        }
      } else {
        handleStreamError(err, res, true);
        return;
      }
    } else {
      handleStreamError(err, res, false);
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
      { err: err instanceof Error ? err.message : String(err), chatId, messageId },
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

function handleStreamError(err: unknown, res: Response, fileExpired: boolean): void {
  const msg = err instanceof Error ? err.message : String(err);

  if (fileExpired || msg.includes("too big") || msg.includes("file is too big")) {
    res.status(501).json({
      error: "File terlalu besar untuk streaming via Bot API",
      detail: "Telegram Bot API membatasi download file hingga 20 MB. Ini adalah batasan eksternal dari Telegram, bukan batasan aplikasi. Untuk file lebih besar, gunakan MTProto (memerlukan API ID/API Hash).",
    });
    return;
  }

  res.status(502).json({
    error: "Gagal mengambil file dari Telegram",
    detail: "File ID mungkin sudah kadaluarsa. Coba import ulang video dengan forward ke bot.",
  });
}
