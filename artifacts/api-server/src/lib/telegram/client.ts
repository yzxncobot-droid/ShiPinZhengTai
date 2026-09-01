/**
 * Telegram (GramJS) client management.
 *
 * Lazily creates and caches a singleton TelegramClient using the bot token +
 * MTProto API credentials from environment variables. The `telegram` package
 * is dynamically imported so the API server boots even when credentials or
 * the package are absent — Telegram endpoints simply return "not configured".
 *
 * Credentials are NEVER sent to the frontend. Only the streaming endpoint
 * and metadata are exposed.
 */
import { logger } from "../logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _connecting: Promise<any> | null = null;

export function isTelegramConfigured(): boolean {
  return !!(
    process.env.TELEGRAM_API_ID &&
    process.env.TELEGRAM_API_HASH &&
    process.env.TELEGRAM_BOT_TOKEN
  );
}

/**
 * Return the cached GramJS client, or create one if needed.
 * Returns `null` when credentials are not configured.
 * Throws on connection failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTelegramClient(): Promise<any | null> {
  if (_client && _client.connected) return _client;
  if (_connecting) return _connecting;

  if (!isTelegramConfigured()) return null;

  _connecting = (async () => {
    try {
      const { TelegramClient, StringSession } = await import("telegram");

      const apiId = Number(process.env.TELEGRAM_API_ID);
      const apiHash = process.env.TELEGRAM_API_HASH!;
      const botToken = process.env.TELEGRAM_BOT_TOKEN!;

      // Optional: reuse a saved session string to avoid re-auth on every restart.
      const savedSession = process.env.TELEGRAM_SESSION || "";

      const client = new TelegramClient(
        new StringSession(savedSession),
        apiId,
        apiHash,
        { connectionRetries: 5, autoReconnect: true },
      );

      await client.start({ botAuthToken: botToken });

      logger.info("[TELEGRAM] Client connected successfully");
      _client = client;
      _connecting = null;
      return client;
    } catch (err) {
      _connecting = null;
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[TELEGRAM] Failed to connect",
      );
      throw err;
    }
  })();

  return _connecting;
}

/**
 * Export the GramJS `Api` namespace for constructing TL objects
 * (e.g. InputMessagesFilterVideo, InputDocumentFileLocation).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTelegramApi(): Promise<any> {
  const mod = await import("telegram");
  return mod.Api;
}

/** Sanitize an error message — never expose tokens, hashes, or session strings. */
function sanitizeError(message: string): string {
  return message
    .replace(/\b\d{6,}\b/g, "***") // API IDs, hashes
    .replace(/bot\d+:[\w-]+/gi, "***") // bot tokens
    .replace(/[A-Za-z0-9+/_=]{40,}/g, "***") // long secrets
    .substring(0, 500);
}

export interface ConnectionTestResult {
  success: boolean;
  title?: string;
  type?: string;
  chatId?: string;
  errorMessage?: string;
}

/**
 * Test whether the Telegram bot can access a given chat.
 * Returns the chat title and type on success, or a sanitized error message.
 */
export async function testConnection(chatId: string): Promise<ConnectionTestResult> {
  try {
    const client = await getTelegramClient();
    if (!client) {
      return { success: false, errorMessage: "Telegram credentials not configured" };
    }

    // Resolve the chat entity — this throws if the bot cannot access it.
    const entity = await client.getEntity(chatId);
    const title = entity.title || entity.firstName || entity.username || "Unknown";
    const className = entity.className || "";
    const type = className === "Channel" ? "CHANNEL" : "GROUP";

    logger.info({ chatId, title, type }, "[TELEGRAM] Connection test succeeded");

    return { success: true, title, type, chatId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const safe = sanitizeError(message);
    logger.warn({ chatId, err: safe }, "[TELEGRAM] Connection test failed");
    return { success: false, errorMessage: safe || "Telegram access denied" };
  }
}

/** Disconnect the client on shutdown. */
export async function disconnectTelegram(): Promise<void> {
  if (_client) {
    try { await _client.disconnect(); } catch { /* ignore */ }
    _client = null;
  }
}
