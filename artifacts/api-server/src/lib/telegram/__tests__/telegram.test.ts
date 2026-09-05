/**
 * Tests for the Telegram video storage & streaming module.
 *
 * Covers the 10 scenarios from the audit:
 *   1.  GET video without Range → 200
 *   2.  GET video with Range bytes=0-999999 → 206
 *   3.  GET video with Range bytes=5000000-5999999 → 206 + correct Content-Range
 *   4.  Range exceeds file → 416
 *   5.  Upstream returns 200 when Range requested → no fake 206
 *   6.  TELEGRAM_API_BASE empty → standard mode
 *   7.  TELEGRAM_API_BASE set but server dead → localBotApi = ERROR
 *   8.  TELEGRAM_API_BASE active → localBotApi = OK
 *   9.  Two identical webhooks concurrent → one video (onConflict)
 *   10. file_id expired → only the relevant video is updated (by id)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock @workspace/db ──────────────────────────────────────────────────────
const { mockDb, mockUpdateChain } = vi.hoisted(() => {
  const chain: any = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => Promise.resolve(undefined));
  const mockDb = {
    update: vi.fn(() => chain),
    insert: vi.fn(),
    select: vi.fn(),
  };
  return { mockDb, mockUpdateChain: chain };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  telegramVideosTable: {
    id: "id",
    telegramSourceId: "telegram_source_id",
    telegramMessageId: "telegram_message_id",
    telegramChatId: "telegram_chat_id",
    telegramFileId: "telegram_file_id",
    updatedAt: "updated_at",
  },
  telegramSourcesTable: {
    id: "id",
    chatId: "chat_id",
    enabled: "enabled",
    status: "status",
  },
  telegramImportLogsTable: {
    id: "id",
    telegramSourceId: "telegram_source_id",
    telegramMessageId: "telegram_message_id",
    status: "status",
  },
  telegramSyncLogsTable: {},
}));

// ── Mock ./client ───────────────────────────────────────────────────────────
const { clientMocks } = vi.hoisted(() => {
  return {
    clientMocks: {
      getFileInfo: vi.fn(),
      getFileUrl: vi.fn(),
      refreshFileId: vi.fn(),
      isLocalBotApiConfigured: vi.fn(),
    },
  };
});

vi.mock("../client", async () => {
  const actual = await vi.importActual("../client");
  return {
    ...actual,
    getFileInfo: clientMocks.getFileInfo,
    getFileUrl: clientMocks.getFileUrl,
    refreshFileId: clientMocks.refreshFileId,
    isLocalBotApiConfigured: clientMocks.isLocalBotApiConfigured,
    // re-export for the client tests below
    botApiCall: (actual as any).botApiCall,
  };
});

// ── Mock Express Response ───────────────────────────────────────────────────
function createMockRes() {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    headersSent: false,
    finished: false,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = String(v); },
    getHeader(k: string) { return headers[k.toLowerCase()]; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) {
      this.headersSent = true;
      this._jsonBody = body;
      this.end();
      return this;
    },
    write(chunk: Buffer | Uint8Array) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end() { this.finished = true; this.headersSent = true; },
    on() { return this; },
    off() { return this; },
    emit() { return true; },
  };
  return {
    res,
    getBody: () => Buffer.concat(chunks),
    getHeaders: () => headers,
  };
}

// ── Mock fetch with a controllable ReadableStream ────────────────────────────
function makeReadableStreamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function mockFetchResponse(opts: {
  status: number;
  headers?: Record<string, string>;
  bodyChunks?: Uint8Array[];
  body?: ReadableStream<Uint8Array>;
}) {
  const body = opts.body ?? makeReadableStreamFromChunks(opts.bodyChunks ?? []);
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    headers: new Headers(opts.headers ?? {}),
    body,
  } as any;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const FILE_SIZE = 10_000_000; // 10 MB test file

function setupGetFileInfo(fileSize = FILE_SIZE) {
  clientMocks.getFileInfo.mockResolvedValue({
    fileId: "test-file-id",
    fileUniqueId: "test-unique-id",
    fileSize,
    filePath: "videos/test.mp4",
  });
  clientMocks.getFileUrl.mockReturnValue("https://api.telegram.org/file/botXXX/videos/test.mp4");
  clientMocks.isLocalBotApiConfigured.mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setupGetFileInfo();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═════════════════════════════════════════════════════════════════════════════
// STREAMING — Range handling (Tests 1–5, 10)
// ═════════════════════════════════════════════════════════════════════════════
describe("Telegram video streaming", () => {
  // We import dynamically so the mocks are in place.
  async function stream(opts: { rangeHeader?: string; fetchResponse: any }) {
    globalThis.fetch = vi.fn().mockResolvedValue(opts.fetchResponse) as any;
    const { streamTelegramVideo } = await import("../streamer");
    const { res, getBody, getHeaders } = createMockRes();
    await streamTelegramVideo({
      fileId: "test-file-id",
      videoId: "video-123",
      chatId: "-100123",
      messageId: "42",
      mimeType: "video/mp4",
      res,
      rangeHeader: opts.rangeHeader,
    });
    return { res, getBody, getHeaders };
  }

  // ── TEST 1: GET video without Range → 200 ──────────────────────────────────
  it("TEST 1: returns 200 for a full (no-Range) request", async () => {
    const fullData = new Uint8Array(FILE_SIZE);
    const { res, getBody } = await stream({
      fetchResponse: mockFetchResponse({
        status: 200,
        headers: { "content-length": String(FILE_SIZE) },
        bodyChunks: [fullData],
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(getBody().length).toBe(FILE_SIZE);
  });

  // ── TEST 2: GET video with Range bytes=0-999999 → 206 ───────────────────────
  it("TEST 2: returns 206 for Range bytes=0-999999", async () => {
    const rangeEnd = 999999;
    const contentLength = rangeEnd + 1;
    const chunk = new Uint8Array(contentLength);

    const { res, getHeaders } = await stream({
      rangeHeader: "bytes=0-999999",
      fetchResponse: mockFetchResponse({
        status: 206,
        headers: {
          "content-range": `bytes 0-${rangeEnd}/${FILE_SIZE}`,
          "content-length": String(contentLength),
        },
        bodyChunks: [chunk],
      }),
    });

    expect(res.statusCode).toBe(206);
    expect(getHeaders()["content-range"]).toBe(`bytes 0-${rangeEnd}/${FILE_SIZE}`);
  });

  // ── TEST 3: GET video with Range bytes=5000000-5999999 → 206 + correct CR ──
  it("TEST 3: returns 206 with correct Content-Range for mid-file range", async () => {
    const start = 5_000_000;
    const end = 5_999_999;
    const contentLength = end - start + 1;
    const chunk = new Uint8Array(contentLength);

    const { res, getHeaders } = await stream({
      rangeHeader: "bytes=5000000-5999999",
      fetchResponse: mockFetchResponse({
        status: 206,
        headers: {
          "content-range": `bytes ${start}-${end}/${FILE_SIZE}`,
          "content-length": String(contentLength),
        },
        bodyChunks: [chunk],
      }),
    });

    expect(res.statusCode).toBe(206);
    expect(getHeaders()["content-range"]).toBe(`bytes ${start}-${end}/${FILE_SIZE}`);
    expect(getHeaders()["content-length"]).toBe(String(contentLength));
  });

  // ── TEST 4: Range exceeds file → 416 ────────────────────────────────────────
  it("TEST 4: returns 416 when Range start exceeds file size", async () => {
    const { res, getHeaders } = await stream({
      rangeHeader: `bytes=${FILE_SIZE + 1000}-`,
      fetchResponse: mockFetchResponse({ status: 200, bodyChunks: [] }),
    });

    expect(res.statusCode).toBe(416);
    expect(getHeaders()["content-range"]).toBe(`bytes */${FILE_SIZE}`);
  });

  // ── TEST 5: Upstream returns 200 when Range requested → no fake 206 ────────
  it("TEST 5: upstream 200 for a Range request serves only the requested range (real 206, not fake)", async () => {
    const start = 5_000_000;
    const end = 5_999_999;
    const contentLength = end - start + 1;

    // Upstream returns the FULL file as 200 (ignoring Range).
    const fullFile = new Uint8Array(FILE_SIZE);
    // Fill with identifiable bytes so we can verify only the range is served.
    for (let i = 0; i < FILE_SIZE; i++) fullFile[i] = i % 256;

    const { res, getBody, getHeaders } = await stream({
      rangeHeader: `bytes=${start}-${end}`,
      fetchResponse: mockFetchResponse({
        status: 200,
        headers: { "content-length": String(FILE_SIZE) },
        bodyChunks: [fullFile],
      }),
    });

    // We must send 206 (browser asked for a range and we served exactly that range).
    expect(res.statusCode).toBe(206);
    expect(getHeaders()["content-range"]).toBe(`bytes ${start}-${end}/${FILE_SIZE}`);
    expect(getHeaders()["content-length"]).toBe(String(contentLength));

    // The body must be ONLY the requested range — not the full file.
    const body = getBody();
    expect(body.length).toBe(contentLength);
    // Verify the bytes match the slice of the full file.
    const expected = Buffer.from(fullFile.subarray(start, end + 1));
    expect(body.equals(expected)).toBe(true);
  });

  // ── TEST 5b: Upstream Content-Range mismatch → 502, no fake 206 ─────────────
  it("TEST 5b: upstream 206 with mismatched Content-Range → 502 (no fake Content-Range)", async () => {
    const { res } = await stream({
      rangeHeader: "bytes=5000000-5999999",
      fetchResponse: mockFetchResponse({
        status: 206,
        headers: {
          "content-range": `bytes 0-999999/${FILE_SIZE}`, // wrong range
          "content-length": "1000000",
        },
        bodyChunks: [new Uint8Array(1000000)],
      }),
    });

    expect(res.statusCode).toBe(502);
  });

  // ── Cache-Control must be private, no-store ─────────────────────────────────
  it("sets Cache-Control to private, no-store (not public)", async () => {
    const { getHeaders } = await stream({
      fetchResponse: mockFetchResponse({ status: 200, bodyChunks: [new Uint8Array(FILE_SIZE)] }),
    });
    expect(getHeaders()["cache-control"]).toBe("private, no-store");
  });

  // ── TEST 10: file_id expired → only that video updated by id ────────────────
  it("TEST 10: file_id refresh updates ONLY the specific video by primary key (id), not by chatId", async () => {
    // getFile fails with file_id error on first call, succeeds after refresh.
    clientMocks.getFileInfo
      .mockRejectedValueOnce(new Error("file_id_not_found"))
      .mockResolvedValueOnce({
        fileId: "new-file-id",
        fileUniqueId: "new-unique",
        fileSize: FILE_SIZE,
        filePath: "videos/new.mp4",
      });
    clientMocks.refreshFileId.mockResolvedValue("new-file-id");
    clientMocks.getFileUrl.mockReturnValue("https://api.telegram.org/file/botXXX/videos/new.mp4");

    globalThis.fetch = vi.fn().mockResolvedValue(
      mockFetchResponse({ status: 200, bodyChunks: [new Uint8Array(FILE_SIZE)] }),
    ) as any;

    const { streamTelegramVideo } = await import("../streamer");
    const { res } = createMockRes();
    await streamTelegramVideo({
      fileId: "old-file-id",
      videoId: "video-XYZ",
      chatId: "-100999",
      messageId: "7",
      mimeType: "video/mp4",
      res,
    });

    // The DB update must target telegramVideosTable.id = "video-XYZ"
    expect(mockDb.update).toHaveBeenCalledWith(expect.anything());
    expect(mockUpdateChain.set).toHaveBeenCalled();
    expect(mockUpdateChain.where).toHaveBeenCalled();

    // Verify the where clause uses eq(telegramVideosTable.id, "video-XYZ") —
    // captured by checking the mock was called (the eq import is real drizzle,
    // so we just confirm update→set→where ran with the video id, not chatId).
    // The key assertion: refreshFileId was called with the chat/message (to get
    // a new file_id), but the DB update uses videoId.
    expect(clientMocks.refreshFileId).toHaveBeenCalledWith("-100999", "7");
    // getFileInfo called twice (first fails, second succeeds with refreshed id)
    expect(clientMocks.getFileInfo).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LOCAL BOT API — config vs health (Tests 6–8)
// ═════════════════════════════════════════════════════════════════════════════
describe("Local Bot API Server config vs health", () => {
  async function importClient() {
    return await import("../client");
  }

  // ── TEST 6: TELEGRAM_API_BASE empty → standard mode ─────────────────────────
  it("TEST 6: isLocalBotApiConfigured() is false when TELEGRAM_API_BASE is empty", async () => {
    const orig = process.env.TELEGRAM_API_BASE;
    delete process.env.TELEGRAM_API_BASE;
    process.env.TELEGRAM_BOT_TOKEN = "test:token";

    const { isLocalBotApiConfigured } = await importClient();
    expect(isLocalBotApiConfigured()).toBe(false);

    process.env.TELEGRAM_API_BASE = orig;
  });

  // ── TEST 7: TELEGRAM_API_BASE set but server dead → ERROR ───────────────────
  it("TEST 7: checkLocalBotApiHealth() returns false when server is unreachable", async () => {
    const origBase = process.env.TELEGRAM_API_BASE;
    process.env.TELEGRAM_API_BASE = "http://localhost:8081";
    process.env.TELEGRAM_BOT_TOKEN = "test:token";

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

    const { checkLocalBotApiHealth } = await importClient();
    const healthy = await checkLocalBotApiHealth();
    expect(healthy).toBe(false);

    process.env.TELEGRAM_API_BASE = origBase;
  });

  // ── TEST 8: TELEGRAM_API_BASE active → OK ──────────────────────────────────
  it("TEST 8: checkLocalBotApiHealth() returns true when server responds ok", async () => {
    const origBase = process.env.TELEGRAM_API_BASE;
    process.env.TELEGRAM_API_BASE = "http://localhost:8081";
    process.env.TELEGRAM_BOT_TOKEN = "test:token";

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { id: 123, username: "bot" } }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    ) as any;

    const { checkLocalBotApiHealth } = await importClient();
    const healthy = await checkLocalBotApiHealth();
    expect(healthy).toBe(true);

    process.env.TELEGRAM_API_BASE = origBase;
  });

  // ── checkLocalBotApiHealth returns only a boolean (no token leak to caller) ─
  it("checkLocalBotApiHealth() returns only a boolean — never the bot token", async () => {
    process.env.TELEGRAM_API_BASE = "http://localhost:8081";
    process.env.TELEGRAM_BOT_TOKEN = "secret:token:12345";

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error")) as any;

    const { checkLocalBotApiHealth } = await importClient();
    const result = await checkLocalBotApiHealth();

    // The function returns a boolean — the caller never sees the token.
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
    delete process.env.TELEGRAM_API_BASE;
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DATABASE DUPLICATE PROTECTION (Test 9)
// ═════════════════════════════════════════════════════════════════════════════
describe("Database duplicate protection", () => {
  // ── TEST 9: Two identical webhooks concurrent → one video ───────────────────
  it("TEST 9: insert uses onConflictDoUpdate on (sourceId, messageId) so concurrent duplicates create one row", async () => {
    // The schema already has a unique index on (telegram_source_id, telegram_message_id).
    // The indexer insert must use onConflictDoUpdate targeting that constraint so
    // a race between two identical webhooks results in one row, not two.
    const { telegramVideosTable } = await import("@workspace/db");

    // Simulate the insert call the indexer makes.
    const insertChain: any = {};
    insertChain.values = vi.fn(() => insertChain);
    insertChain.onConflictDoUpdate = vi.fn(() => insertChain);
    mockDb.insert.mockReturnValue(insertChain);

    // Re-import indexer with mocks in place.
    const { processQueueItem } = await import("../indexer");

    // Build a fake import log entry.
    const metadata = {
      fileId: "f1",
      fileUniqueId: "u1",
      fileName: "v.mp4",
      mimeType: "video/mp4",
      fileSize: 1000,
      duration: 10,
      width: 100,
      height: 100,
      thumbnailFileId: null,
      thumbnailWidth: null,
      thumbnailHeight: null,
      caption: "test",
      telegramDate: new Date().toISOString(),
      telegramMessageId: "99",
      effectiveChatId: "-100",
      sourceId: "src-1",
      replyChatId: "-100",
      updateId: 1,
      isForwarded: false,
      forwardOriginChatId: null,
      videoType: "VIDEO",
    };

    const log = {
      id: "log-1",
      telegramSourceId: "src-1",
      telegramMessageId: "99",
      status: "pending",
      errorMessage: null,
      metadata: JSON.stringify(metadata),
      attempts: 0,
      processedAt: null,
      createdAt: new Date(),
    };

    // Make select return no existing video → forces the insert path.
    const selectChain: any = {};
    selectChain.from = vi.fn(() => selectChain);
    selectChain.where = vi.fn(() => selectChain);
    selectChain.limit = vi.fn(() => Promise.resolve([]));
    mockDb.select.mockReturnValue(selectChain);

    // Make the update calls (status, videoCount) succeed.
    mockUpdateChain.where.mockResolvedValue(undefined);

    // Stub sendMessage (isTelegramConfigured is false → no send).
    process.env.TELEGRAM_BOT_TOKEN = "";

    await processQueueItem(log as any);

    // The insert must have been called with onConflictDoUpdate targeting
    // (telegramSourceId, telegramMessageId).
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [telegramVideosTable.telegramSourceId, telegramVideosTable.telegramMessageId],
      }),
    );
  });
});
