/**
 * Telegram video streaming proxy with HTTP Range / Partial Content support.
 *
 * Flow:
 *   Browser → GET /api/telegram-videos/:id/stream (with Range header)
 *   → Access check
 *   → DB lookup (message_id, chat_id)
 *   → Telegram (GramJS) iterDownload in 512 KB chunks from the requested offset
 *   → Stream chunks to the browser (206 Partial Content)
 *
 * The entire file is NEVER loaded into RAM — chunks are piped as they arrive.
 * This supports seeking on large files (2 GB+) without downloading from byte 0.
 */
import type { Response } from "express";
import { logger } from "../logger";
import { getTelegramClient, getTelegramApi } from "./client";

interface StreamParams {
  chatId: string;
  messageId: string;
  res: Response;
  rangeHeader?: string;
}

/**
 * Stream a Telegram video to the HTTP response.
 * Handles Range requests (206 Partial Content) and full requests (200 OK).
 */
export async function streamTelegramVideo({
  chatId,
  messageId,
  res,
  rangeHeader,
}: StreamParams): Promise<void> {
  const client = await getTelegramClient();
  if (!client) {
    res.status(503).json({ error: "Telegram not configured" });
    return;
  }

  // Fetch the message fresh — this refreshes the file reference (which expires).
  const messages = await client.getMessages(chatId, {
    ids: [Number(messageId)],
  });

  if (!messages || messages.length === 0 || !messages[0]) {
    res.status(404).json({ error: "Video not found on Telegram" });
    return;
  }

  const message = messages[0];

  if (!message.media || !message.media.document) {
    res.status(404).json({ error: "No media in Telegram message" });
    return;
  }

  const doc = message.media.document;
  const fileSize: number = Number(doc.size) || 0;
  const mimeType: string = doc.mimeType || "video/mp4";

  if (fileSize === 0) {
    res.status(500).json({ error: "Unable to determine file size" });
    return;
  }

  // Parse Range header.
  let start = 0;
  let end = fileSize - 1;

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      start = parseInt(match[1], 10);
      if (match[2]) end = parseInt(match[2], 10);
      // Clamp end to file size.
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
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", contentLength.toString());

  if (isPartial) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  } else {
    res.status(200);
  }

  // Stream chunks from Telegram to the client.
  const Api = await getTelegramApi();

  const inputLocation = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: "",
  });

  let bytesWritten = 0;
  let aborted = false;

  // Detect client disconnect.
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  try {
    for await (const chunk of client.iterDownload({
      file: inputLocation,
      offset: BigInt(start),
      limit: BigInt(contentLength),
      requestSize: 512 * 1024, // 512 KB per MTProto request
    })) {
      if (aborted) break;

      const remaining = contentLength - bytesWritten;
      if (chunk.length > remaining) {
        res.write(chunk.subarray(0, remaining));
        bytesWritten += remaining;
        break;
      }

      res.write(chunk);
      bytesWritten += chunk.length;
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
