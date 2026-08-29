/**
 * Tests for the Layerbase Valkey heartbeat system.
 *
 * Covers:
 *  A. Request without secret → 401
 *  B. Wrong secret → 401
 *  C. Correct secret → 200 { ok: true }
 *  D. Heartbeat key is stored in Layerbase (setex called with the right key)
 *  E. TTL is ~600 seconds
 *  F. Second heartbeat reuses the same key
 *  G. KV token never appears in the response
 *  H. Cron secret never appears in the response
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────
const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    ping: vi.fn(),
  },
}));

vi.mock("../lib/redis", () => ({
  redis: mockRedis,
  isRedisAvailable: true,
  isAtomicRedisAvailable: false,
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { performHeartbeat, getHeartbeatStatus, HEARTBEAT_KEY, HEARTBEAT_TTL } from "./layerbaseHeartbeat";
import { verifyCronSecret } from "../routes/layerbase-heartbeat";
import type { Request } from "express";

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? undefined,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.setex.mockResolvedValue("OK");
  mockRedis.get.mockResolvedValue(null);
  process.env.CRON_HEARTBEAT_SECRET = "test-cron-secret-abc123xyz";
});

afterEach(() => {
  delete process.env.CRON_HEARTBEAT_SECRET;
});

// ── Heartbeat service ────────────────────────────────────────────────────────
describe("performHeartbeat", () => {
  it("D & E: stores timestamp on the fixed key with TTL 600", async () => {
    const result = await performHeartbeat();
    expect(result.ok).toBe(true);
    expect(mockRedis.setex).toHaveBeenCalledTimes(1);
    const [key, ttl, value] = mockRedis.setex.mock.calls[0];
    expect(key).toBe(HEARTBEAT_KEY);
    expect(ttl).toBe(HEARTBEAT_TTL);
    expect(ttl).toBe(600);
    // value is a numeric string (timestamp)
    expect(Number(value)).toBeGreaterThan(0);
  });

  it("F: second heartbeat reuses the same key (no new keys)", async () => {
    await performHeartbeat();
    await performHeartbeat();
    const keys = mockRedis.setex.mock.calls.map((c) => c[0]);
    expect(keys.every((k) => k === HEARTBEAT_KEY)).toBe(true);
    expect(new Set(keys).size).toBe(1);
  });

  it("returns ok=false when KV is not available", async () => {
    const { isRedisAvailable } = await import("../lib/redis");
    vi.mocked(isRedisAvailable as any);
    // isRedisAvailable is mocked as true; simulate false by mocking the module value
    vi.doMock("../lib/redis", () => ({
      redis: mockRedis,
      isRedisAvailable: false,
      isAtomicRedisAvailable: false,
    }));
    // re-import to pick up the new mock
    vi.resetModules();
    const { performHeartbeat: hb } = await import("./layerbaseHeartbeat");
    const result = await hb();
    expect(result.ok).toBe(false);
    vi.doUnmock("../lib/redis");
    vi.resetModules();
  });

  it("returns ok=false on timeout / KV error", async () => {
    mockRedis.setex.mockRejectedValue(new Error("network error"));
    const result = await performHeartbeat();
    expect(result.ok).toBe(false);
  });
});

describe("getHeartbeatStatus", () => {
  it("returns last heartbeat timestamp when key exists", async () => {
    const ts = Date.now();
    mockRedis.get.mockResolvedValue(String(ts));
    const status = await getHeartbeatStatus();
    expect(status.ok).toBe(true);
    expect(status.lastHeartbeat).toBe(new Date(ts).toISOString());
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns ok=false when key does not exist", async () => {
    mockRedis.get.mockResolvedValue(null);
    const status = await getHeartbeatStatus();
    expect(status.ok).toBe(false);
  });

  it("returns ok=false on error", async () => {
    mockRedis.get.mockRejectedValue(new Error("timeout"));
    const status = await getHeartbeatStatus();
    expect(status.ok).toBe(false);
  });
});

// ── Endpoint auth (verifyCronSecret) ────────────────────────────────────────
describe("verifyCronSecret", () => {
  it("A: rejects request without any secret header", () => {
    expect(verifyCronSecret(makeReq({}))).toBe(false);
  });

  it("B: rejects request with wrong secret", () => {
    expect(verifyCronSecret(makeReq({ authorization: "Bearer wrong-secret" }))).toBe(false);
    expect(verifyCronSecret(makeReq({ "x-cron-secret": "wrong-secret" }))).toBe(false);
  });

  it("C: accepts correct Bearer token", () => {
    expect(verifyCronSecret(makeReq({ authorization: "Bearer test-cron-secret-abc123xyz" }))).toBe(true);
  });

  it("C: accepts correct X-Cron-Secret header", () => {
    expect(verifyCronSecret(makeReq({ "x-cron-secret": "test-cron-secret-abc123xyz" }))).toBe(true);
  });

  it("rejects when CRON_HEARTBEAT_SECRET is not configured", () => {
    delete process.env.CRON_HEARTBEAT_SECRET;
    expect(verifyCronSecret(makeReq({ authorization: "Bearer test-cron-secret-abc123xyz" }))).toBe(false);
  });

  it("rejects empty Bearer token", () => {
    expect(verifyCronSecret(makeReq({ authorization: "Bearer " }))).toBe(false);
  });
});

// ── Security: no credential leakage ─────────────────────────────────────────
describe("credential leakage", () => {
  it("G: heartbeat result does not contain KV_REST_API_TOKEN", async () => {
    process.env.KV_REST_API_TOKEN = "super-secret-token";
    const result = await performHeartbeat();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-token");
  });

  it("H: heartbeat result does not contain CRON_HEARTBEAT_SECRET", async () => {
    const result = await performHeartbeat();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("test-cron-secret-abc123xyz");
  });

  it("G: status result does not contain KV_REST_API_TOKEN", async () => {
    process.env.KV_REST_API_TOKEN = "super-secret-token";
    mockRedis.get.mockResolvedValue(String(Date.now()));
    const status = await getHeartbeatStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("super-secret-token");
  });

  it("H: status result does not contain CRON_HEARTBEAT_SECRET", async () => {
    mockRedis.get.mockResolvedValue(String(Date.now()));
    const status = await getHeartbeatStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("test-cron-secret-abc123xyz");
  });
});
