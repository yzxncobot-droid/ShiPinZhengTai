import { beforeEach, describe, expect, it, vi } from "vitest";
import bigInt from "big-integer";
import { iterDownload } from "telegram/client/downloads.js";
import { Api } from "telegram";

const mocks = vi.hoisted(() => ({
  getMessages: vi.fn(),
  iterDownload: vi.fn(),
  invokeWithSender: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  appSecretsTable: { key: "key", value: "value" },
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }),
  },
}));
vi.mock("node:fs", () => ({
  default: { promises: {
    readFile: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    mkdir: async () => undefined,
    writeFile: async () => undefined,
  } },
}));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("telegram")>();
  return {
    ...actual,
    TelegramClient: class {
      session = { save: () => "test-session" };
      connect = async () => undefined;
      isUserAuthorized = async () => true;
      getMe = async () => ({ id: 1 });
      getMessages = mocks.getMessages;
      iterDownload = mocks.iterDownload;
    },
  };
});

const CHUNK_SIZE = 524288;
const FILE_SIZE = 25 * 1024 * 1024 + 137;
function bytes(start: number, size: number): Buffer {
  const result = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) result[i] = (start + i) % 251;
  return result;
}

describe("MTProto large-file downloads using the installed GramJS iterator", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_API_ID", "123");
    vi.stubEnv("TELEGRAM_API_HASH", "test-hash");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    mocks.getMessages.mockResolvedValue([{
      media: { document: {
        id: bigInt(1), accessHash: bigInt(2), fileReference: Buffer.from("ref"),
        size: bigInt(FILE_SIZE), dcId: 2,
      } },
    }]);
    mocks.invokeWithSender.mockImplementation(async (request) => {
      const start = request.offset.toJSNumber();
      // Telegram GetFile requires aligned offsets.
      if (start % 4096 !== 0) throw new Error("OFFSET_INVALID");
      return new Api.upload.File({
        type: new Api.storage.FileMp4(), mtime: 0,
        bytes: bytes(start, Math.min(request.limit, FILE_SIZE - start)),
      });
    });
    const gramClient = {
      _log: { info: vi.fn(), debug: vi.fn() },
      getSender: async () => ({ dcId: 2 }),
      invokeWithSender: mocks.invokeWithSender,
    };
    mocks.iterDownload.mockImplementation((options) => iterDownload(gramClient as any, options));
  });

  async function download(start: number, end: number | null) {
    const { initMtProto, getMtProtoFileStream } = await import("../mtproto");
    await initMtProto();
    const result = await getMtProtoFileStream("-100123", "42", start, end);
    const chunks: Buffer[] = [];
    for await (const chunk of result.chunks) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  it.each([
    [0, 3],
    [1, 40],
    [32, CHUNK_SIZE + 50],
    [CHUNK_SIZE - 1, CHUNK_SIZE + 1],
    [5_000_001, 5_001_000],
    [FILE_SIZE - 99, FILE_SIZE - 1],
  ])("returns exact bytes for range %i-%i", async (start, end) => {
    expect(await download(start, end)).toEqual(bytes(start, end - start + 1));
    const options = mocks.iterDownload.mock.calls[0][0];
    expect(options.offset.toJSNumber() % CHUNK_SIZE).toBe(0);
    expect(mocks.invokeWithSender).toHaveBeenCalledTimes(
      Math.ceil(((start % CHUNK_SIZE) + end - start + 1) / CHUNK_SIZE),
    );
  });

  it("reads an exact range beyond the 20 MB boundary", async () => {
    const start = 20 * 1024 * 1024 + 123;
    expect(await download(start, start + 999)).toEqual(bytes(start, 1000));
  });

  it("refreshes expired references without repeating or losing bytes", async () => {
    mocks.invokeWithSender.mockRejectedValueOnce(new Error("FILE_REFERENCE_EXPIRED"));
    expect(await download(1, 100)).toEqual(bytes(1, 100));
    expect(mocks.getMessages).toHaveBeenCalledTimes(2);
  });

  it("reports a truncated upstream file rather than silently succeeding", async () => {
    mocks.invokeWithSender.mockResolvedValueOnce(new Api.upload.File({
      type: new Api.storage.FileMp4(), mtime: 0, bytes: Buffer.alloc(5),
    }));
    await expect(download(0, 99)).rejects.toThrow("MTProto download ended early");
  });
});
