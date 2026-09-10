/**
 * TelegramFileProvider — unified file streaming abstraction.
 *
 * Selects the appropriate download method based on file size and MTProto
 * availability:
 *
 *   - MTProto (iterDownload): used when MTProto is connected and ready.
 *     Supports files of any size (no 20 MB limit). Used for all sizes when
 *     available, for architectural consistency.
 *
 *   - Bot API (getFile + HTTP fetch): fallback when MTProto is not available.
 *     Limited to 20 MB by Telegram infrastructure.
 *
 * Fallback logic:
 *   - If MTProto fails and the file is ≤20 MB → try Bot API
 *   - If Bot API fails ("too big") and MTProto is available → try MTProto
 *
 * Both providers return the same `FileRangeStream` interface — an async
 * generator yielding exactly the bytes in the requested range + the file size.
 * The caller (streamer.ts) does not need to know which provider was used.
 */
import type { Response } from "express";
import { logger } from "../logger";
import { getFileInfo, getFileUrl, refreshFileId, isLocalBotApiConfigured } from "./client";
import type { TelegramFileInfo } from "./client";
import {
  isMtProtoReady,
  isMtProtoConfigured,
  getMtProtoFileStream,
  BOT_API_THRESHOLD,
} from "./mtproto";
import { db } from "@workspace/db";
import { telegramVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Types ───────────────────────────────────────────────────────────────────

export type FileProvider = "bot_api" | "mtproto";

export interface FileRangeStream {
  /** Async generator yielding Buffer chunks for the requested byte range. */
  chunks: AsyncGenerator<Buffer>;
  /** Total file size in bytes. */
  fileSize: number;
  /** Which provider was used. */
  provider: FileProvider;
}

export interface FileDownloadParams {
  /** Telegram file_id (Bot API). */
  fileId: string;
  /** Primary key of the telegram_videos row (for DB updates on file_id refresh). */
  videoId: string;
  /** Telegram chat ID. */
  chatId: string;
  /** Telegram message ID. */
  messageId: string;
  /** File size from the database (may be null/0 if unknown). */
  fileSize: number | null;
  /** Start byte (inclusive). */
  startByte: number;
  /** End byte (inclusive), or null for end-of-file. */
  endByte: number | null;
}

// ── Provider selection ──────────────────────────────────────────────────────

/**
 * Determine whether MTProto should be used for a given file.
 *
 * - If MTProto is connected and ready: use it for ALL sizes (architectural
 *   consistency, no 20 MB limit).
 * - If MTProto is not ready: use Bot API (limited to 20 MB).
 */
export function shouldUseMtProto(fileSize: number | null): boolean {
  // When a Local Bot API Server is configured, prefer Bot API — it supports
  // files up to 2 GB and can resolve private channels via numeric ID (which
  // MTProto bot auth cannot). MTProto is kept as a fallback.
  if (isLocalBotApiConfigured()) return false;
  return isMtProtoReady();
}

/**
 * Check if a file can potentially be streamed (by any provider).
 * Files >20 MB require MTProto; files ≤20 MB can use either provider.
 */
export function canStreamFile(fileSize: number | null): boolean {
  if (isLocalBotApiConfigured()) return true; // Local server supports up to 2 GB
  if (isMtProtoReady()) return true;
  if (fileSize != null && fileSize > 0 && fileSize <= BOT_API_THRESHOLD) return true;
  return false;
}

// ── Unified getStream ───────────────────────────────────────────────────────

/**
 * Get a byte-range stream from the appropriate Telegram file provider.
 *
 * Tries the selected provider first, then falls back to the other on failure.
 * Throws if both providers fail.
 */
export async function getFileStream(params: FileDownloadParams): Promise<FileRangeStream> {
  const useMtProto = shouldUseMtProto(params.fileSize);

  if (useMtProto) {
    try {
      return await mtProtoDownload(params);
    } catch (err) {
      // If MTProto fails and the file is small enough, try Bot API.
      if (params.fileSize != null && params.fileSize > 0 && params.fileSize <= BOT_API_THRESHOLD) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), videoId: params.videoId },
          "[TELEGRAM] MTProto download failed, falling back to Bot API",
        );
        try {
          return await botApiDownload(params);
        } catch (botApiErr) {
          logger.error(
            { err: botApiErr instanceof Error ? botApiErr.message : String(botApiErr) },
            "[TELEGRAM] Bot API fallback also failed",
          );
          throw botApiErr;
        }
      }
      throw err;
    }
  } else {
    try {
      return await botApiDownload(params);
    } catch (err) {
      // If Bot API fails and MTProto is available, try MTProto.
      if (isMtProtoReady()) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), videoId: params.videoId },
          "[TELEGRAM] Bot API download failed, falling back to MTProto",
        );
        return await mtProtoDownload(params);
      }
      throw err;
    }
  }
}

// ── Bot API provider ────────────────────────────────────────────────────────

// File info cache — getFile results are stable for a given file_id (until expiry).
// Caching eliminates redundant Bot API round-trips on successive Range requests.
const FILE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;
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

/**
 * Download a byte range via Bot API (getFile + HTTP fetch).
 *
 * Handles:
 *   - file_id expiry: refreshes via forwardMessage, updates DB by video PK
 *   - Range requests: forwards to Telegram, verifies upstream response
 *   - Upstream 200 (ignored Range): serves only requested bytes
 *
 * The async generator yields exactly the bytes in [startByte, endByte].
 */
async function botApiDownload(params: FileDownloadParams): Promise<FileRangeStream> {
  const { fileId, videoId, chatId, messageId, startByte, endByte } = params;

  let fileInfo: TelegramFileInfo;
  try {
    fileInfo = await getCachedFileInfo(fileId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Only attempt file_id refresh for expired/invalid file_id errors.
    const isFileIdError =
      errMsg.includes("file_id") ||
      errMsg.includes("file_id_not_found") ||
      errMsg.includes("file_id_expired") ||
      errMsg.includes("wrong file_id") ||
      errMsg.includes("bad file_id");

    if (isFileIdError) {
      logger.info({ videoId, chatId, messageId }, "[TELEGRAM] getFile failed (file_id issue), trying refresh");
      const newFileId = await refreshFileId(chatId, messageId);

      if (newFileId) {
        // Update ONLY this specific video's file_id by primary key.
        await db
          .update(telegramVideosTable)
          .set({ telegramFileId: newFileId, updatedAt: new Date() })
          .where(eq(telegramVideosTable.id, videoId))
          .catch(() => {});

        invalidateFileInfoCache(fileId);
        fileInfo = await getCachedFileInfo(newFileId);
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  const fileSize = fileInfo.fileSize;
  const actualEndByte = endByte !== null ? endByte : fileSize - 1;
  const bytesToDownload = actualEndByte - startByte + 1;
  const fileUrl = getFileUrl(fileInfo.filePath);

  // Fetch from Telegram with Range header.
  const fetchHeaders: Record<string, string> = {};
  if (startByte > 0 || endByte !== null) {
    fetchHeaders["Range"] = `bytes=${startByte}-${actualEndByte}`;
  }

  const response = await fetch(fileUrl, { headers: fetchHeaders });

  if (response.status >= 400) {
    throw new Error(`Telegram file download failed: HTTP ${response.status}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("Telegram file response has no body");
  }

  const upstreamStatus = response.status;
  const reader = body.getReader();

  // If upstream returned 206, it honored the Range — stream directly.
  // If upstream returned 200 (ignored Range), we need to skip leading bytes.
  const skipBytes = upstreamStatus === 200 && startByte > 0 ? startByte : 0;

  async function* botApiStream(): AsyncGenerator<Buffer> {
    let bytesSent = 0;
    let bytesSkipped = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      let chunk = Buffer.from(value);

      // Skip leading bytes if upstream ignored the Range.
      if (bytesSkipped < skipBytes) {
        const toSkip = Math.min(skipBytes - bytesSkipped, chunk.length);
        chunk = chunk.subarray(toSkip);
        bytesSkipped += toSkip;
        if (chunk.length === 0) continue;
      }

      // Limit to the requested byte range.
      const remaining = bytesToDownload - bytesSent;
      if (remaining <= 0) break;

      if (chunk.length > remaining) {
        yield chunk.subarray(0, remaining) as Buffer;
        bytesSent += remaining;
        break;
      }

      yield chunk;
      bytesSent += chunk.length;
    }
  }

  return {
    chunks: botApiStream(),
    fileSize,
    provider: "bot_api",
  };
}

// ── MTProto provider ────────────────────────────────────────────────────────

/**
 * Download a byte range via MTProto (iterDownload with offset).
 *
 * Delegates to the MTProto client singleton. The async generator yields
 * exactly the bytes in [startByte, endByte]. File reference recovery is
 * handled internally by the MTProto client.
 */
async function mtProtoDownload(params: FileDownloadParams): Promise<FileRangeStream> {
  const { chatId, messageId, startByte, endByte } = params;

  const result = await getMtProtoFileStream(chatId, messageId, startByte, endByte);

  return {
    chunks: result.chunks,
    fileSize: result.fileSize,
    provider: "mtproto",
  };
}
