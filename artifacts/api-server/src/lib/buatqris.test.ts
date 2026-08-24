/**
 * Tests for the BuatQris QRIS top-up system.
 *
 * Covers: webhook signature verification, credit idempotency, amount/transaction
 * validation, duplicate webhook prevention, status sync, and manual payment
 * isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock external modules (hoisted so vi.mock factories can access them) ────
const { mockTx, mockDb } = vi.hoisted(() => {
  const mockTx = {
    execute: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  const mockDb = {
    transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockTx)),
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  };
  return { mockTx, mockDb };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  topupsTable: {
    id: "id", userId: "user_id", amount: "amount", status: "status",
    orderId: "order_id", paymentMethod: "payment_method",
    providerTransactionId: "provider_transaction_id",
    providerPayload: "provider_payload", callbackReceivedAt: "callback_received_at",
    gatewayReference: "gateway_reference", paidAt: "paid_at", updatedAt: "updated_at",
    paymentProofId: "payment_proof_id", reviewedBy: "reviewed_by",
    reviewedAt: "reviewed_at", reviewNote: "review_note",
    expiredAt: "expired_at", createdAt: "created_at",
  },
  usersTable: { id: "id", walletBalance: "wallet_balance", totalTopup: "total_topup", updatedAt: "updated_at" },
  walletsTable: { userId: "user_id", balance: "balance", totalEarned: "total_earned", updatedAt: "updated_at", lastTransactionAt: "last_transaction_at" },
  walletTransactionsTable: { id: "id", referenceType: "reference_type", referenceId: "reference_id" },
  transactionsTable: {},
  notificationsTable: {},
  paymentProofsTable: { id: "id", status: "status" },
  settingsTable: { automaticFeeType: "automatic_fee_type", automaticFeeRate: "automatic_fee_rate", qrisImage: "qris_image" },
}));

vi.mock("./redis", () => ({
  invalidateUserCache: vi.fn().mockResolvedValue(undefined),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
  keys: { analytics: vi.fn(() => "analytics:overview") },
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Partially mock ./buatqris — keep verifyWebhookSignature real, mock checkQrisStatus.
vi.mock("./buatqris", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    checkQrisStatus: vi.fn(),
  };
});

// Import after mocks are set up.
import { verifyWebhookSignature } from "./buatqris";
import { creditVerifiedTopup, processBuatQrisWebhook, syncBuatQrisStatus } from "./topup-verification";
import { checkQrisStatus } from "./buatqris";

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeTopup(overrides: Record<string, any> = {}) {
  return {
    id: "topup-1",
    userId: "user-1",
    amount: 10000,
    orderId: "TOPUP-ABC123",
    paymentMethod: "automatic",
    providerTransactionId: "tx-123",
    status: "pending",
    ...overrides,
  };
}

/**
 * Set up mockTx.execute to return a sequence of results in order.
 * Each call to execute() pops the next result from the queue.
 */
function queueExecuteResults(results: any[]) {
  let i = 0;
  mockTx.execute.mockImplementation(async () => {
    return results[i++] ?? { rows: [] };
  });
}

/** Set up the chainable mock for db.select/update/insert used outside transactions. */
function chainable(result: any) {
  const chain: any = {};
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => result);
  chain.set = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.values = vi.fn(async () => undefined);
  chain.returning = vi.fn(async () => result);
  return chain;
}

function resetMocks() {
  vi.clearAllMocks();
  mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx));
}

beforeEach(() => {
  resetMocks();
});

// ── TEST 7: Webhook signature verification ──────────────────────────────────
describe("verifyWebhookSignature", () => {
  afterEach(() => {
    delete process.env.BUATQRIS_WEBHOOK_SECRET;
  });

  it("rejects when webhook secret is not configured", () => {
    const body = Buffer.from('{"event":"payment.success"}');
    expect(verifyWebhookSignature(body, "sha256=abc")).toBe(false);
  });

  it("rejects when signature header is missing", () => {
    process.env.BUATQRIS_WEBHOOK_SECRET = "test-secret";
    const body = Buffer.from('{"event":"payment.success"}');
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
  });

  it("accepts a valid HMAC-SHA256 signature", () => {
    process.env.BUATQRIS_WEBHOOK_SECRET = "test-secret";
    const body = Buffer.from('{"event":"payment.success"}');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("node:crypto");
    const expected = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, `sha256=${expected}`)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    process.env.BUATQRIS_WEBHOOK_SECRET = "test-secret";
    const body = Buffer.from('{"event":"payment.success"}');
    expect(verifyWebhookSignature(body, "sha256=invalid")).toBe(false);
  });
});

// ── TEST 6, 8, 9, 10, 11, 12: processBuatQrisWebhook ─────────────────────────
describe("processBuatQrisWebhook", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("TEST 6: payment.success valid → credits via creditVerifiedTopup", async () => {
    const topup = makeTopup();
    mockDb.select.mockReturnValue(chainable([topup]));
    mockDb.update.mockReturnValue(chainable(undefined));

    // creditVerifiedTopup internals: advisory lock → topup row → user row
    queueExecuteResults([
      { rows: [] }, // advisory lock
      { rows: [{ id: "topup-1", user_id: "user-1", amount: 10000, status: "pending" }] }, // SELECT topup
      { rows: [{ id: "user-1", wallet_balance: 5000, total_topup: 10000 }] }, // SELECT user
    ]);
    // No duplicate reference
    mockTx.select.mockReturnValue(chainable([]));
    // Updates and inserts inside the transaction
    mockTx.update.mockReturnValue(chainable([{}]));
    mockTx.insert.mockReturnValue(chainable(undefined));

    const payload = {
      event: "payment.success",
      data: { transaction_id: "tx-123", amount: 10000, status: "success" },
    };

    const result = await processBuatQrisWebhook(payload);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toHaveProperty("status");
  });

  it("TEST 8: amount mismatch → no credit, marks failed", async () => {
    const topup = makeTopup({ amount: 10000 });
    mockDb.select.mockReturnValue(chainable([topup]));
    mockDb.update.mockReturnValue(chainable(undefined));

    const payload = {
      event: "payment.success",
      data: { transaction_id: "tx-123", amount: 9000, status: "success" },
    };

    const result = await processBuatQrisWebhook(payload);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ received: true, status: "amount_mismatch" });
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("TEST 9: transaction_id mismatch → no credit", async () => {
    const topup = makeTopup({ providerTransactionId: "tx-123", amount: 10000 });
    mockDb.select.mockReturnValue(chainable([topup]));

    const payload = {
      event: "payment.success",
      data: { transaction_id: "tx-WRONG", amount: 10000, status: "success" },
    };

    const result = await processBuatQrisWebhook(payload);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ received: true, status: "transaction_mismatch" });
  });

  it("TEST 10: duplicate webhook (already paid) → no double credit", async () => {
    const topup = makeTopup({ status: "paid" });
    mockDb.select.mockReturnValue(chainable([topup]));

    const payload = {
      event: "payment.success",
      data: { transaction_id: "tx-123", amount: 10000, status: "success" },
    };

    const result = await processBuatQrisWebhook(payload);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ received: true, status: "already_paid" });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("TEST 11: payment.expired → marks expired, no credit", async () => {
    const topup = makeTopup({ status: "pending" });
    mockDb.select.mockReturnValue(chainable([topup]));
    mockDb.update.mockReturnValue(chainable(undefined));

    const payload = {
      event: "payment.expired",
      data: { transaction_id: "tx-123", status: "expired" },
    };

    const result = await processBuatQrisWebhook(payload);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ received: true, status: "expired" });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("TEST 12: payment.failed → marks failed, no credit", async () => {
    const topup = makeTopup({ status: "pending" });
    mockDb.select.mockReturnValue(chainable([topup]));
    mockDb.update.mockReturnValue(chainable(undefined));

    const payload = {
      event: "payment.failed",
      data: { transaction_id: "tx-123", status: "failed" },
    };

    const result = await processBuatQrisWebhook(payload);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ received: true, status: "failed" });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("TEST 16 variant: rejects webhook for non-automatic (manual) payment", async () => {
    const topup = makeTopup({ paymentMethod: "manual" });
    mockDb.select.mockReturnValue(chainable([topup]));

    const payload = {
      event: "payment.success",
      data: { transaction_id: "tx-123", amount: 10000, status: "success" },
    };

    const result = await processBuatQrisWebhook(payload);
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ received: true, ignored: true, reason: "wrong_payment_method" });
  });

  it("returns 400 when event is missing", async () => {
    const result = await processBuatQrisWebhook({ data: {} });
    expect(result.httpStatus).toBe(400);
  });

  it("acknowledges unknown events without crediting", async () => {
    const result = await processBuatQrisWebhook({ event: "some.unknown.event" });
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({ received: true, ignored: true });
  });
});

// ── TEST 13, 14: syncBuatQrisStatus ───────────────────────────────────────────
describe("syncBuatQrisStatus", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("TEST 13: confirm-paid when still pending → awaiting_payment, no credit", async () => {
    const topup = makeTopup({ status: "pending" });
    vi.mocked(checkQrisStatus).mockResolvedValue({
      status: "pending",
      amount: 10000,
      transactionId: "tx-123",
      orderId: "TOPUP-ABC123",
      raw: {},
    });

    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("awaiting_payment");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("TEST 14: confirm-paid after provider success → paid, creditVerifiedTopup called", async () => {
    const topup = makeTopup({ status: "pending" });
    vi.mocked(checkQrisStatus).mockResolvedValue({
      status: "success",
      amount: 10000,
      transactionId: "tx-123",
      orderId: "TOPUP-ABC123",
      raw: {},
    });

    // creditVerifiedTopup internals
    queueExecuteResults([
      { rows: [] }, // advisory lock
      { rows: [{ id: "topup-1", user_id: "user-1", amount: 10000, status: "pending" }] }, // SELECT topup
      { rows: [{ id: "user-1", wallet_balance: 5000, total_topup: 10000 }] }, // SELECT user
    ]);
    mockTx.select.mockReturnValue(chainable([])); // no duplicate
    mockTx.update.mockReturnValue(chainable([{}]));
    mockTx.insert.mockReturnValue(chainable(undefined));

    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("paid");
  });

  it("TEST 16: does not sync non-automatic (manual) payments", async () => {
    const topup = makeTopup({ paymentMethod: "manual", status: "pending" });
    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("pending");
    expect(checkQrisStatus).not.toHaveBeenCalled();
  });

  it("returns paid without checking provider if already paid", async () => {
    const topup = makeTopup({ status: "paid" });
    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("paid");
    expect(checkQrisStatus).not.toHaveBeenCalled();
  });

  it("returns expired without checking provider if already expired", async () => {
    const topup = makeTopup({ status: "expired" });
    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("expired");
    expect(checkQrisStatus).not.toHaveBeenCalled();
  });

  it("marks expired when provider reports expired", async () => {
    const topup = makeTopup({ status: "pending" });
    vi.mocked(checkQrisStatus).mockResolvedValue({
      status: "expired",
      amount: null,
      transactionId: "tx-123",
      orderId: null,
      raw: {},
    });
    mockDb.update.mockReturnValue(chainable(undefined));

    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("expired");
  });

  it("marks failed when provider reports failed", async () => {
    const topup = makeTopup({ status: "pending" });
    vi.mocked(checkQrisStatus).mockResolvedValue({
      status: "failed",
      amount: null,
      transactionId: "tx-123",
      orderId: null,
      raw: {},
    });
    mockDb.update.mockReturnValue(chainable(undefined));

    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("failed");
  });

  it("does not credit on amount mismatch from provider", async () => {
    const topup = makeTopup({ status: "pending", amount: 10000 });
    vi.mocked(checkQrisStatus).mockResolvedValue({
      status: "success",
      amount: 9000, // mismatch
      transactionId: "tx-123",
      orderId: "TOPUP-ABC123",
      raw: {},
    });

    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("pending");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("does not credit on transaction_id mismatch from provider", async () => {
    const topup = makeTopup({ status: "pending", providerTransactionId: "tx-123" });
    vi.mocked(checkQrisStatus).mockResolvedValue({
      status: "success",
      amount: 10000,
      transactionId: "tx-WRONG", // mismatch
      orderId: "TOPUP-ABC123",
      raw: {},
    });

    const result = await syncBuatQrisStatus(topup);
    expect(result).toBe("pending");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

// ── TEST 10 (variant): creditVerifiedTopup idempotency ───────────────────────
describe("creditVerifiedTopup idempotency", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("does not credit if topup is already paid", async () => {
    queueExecuteResults([
      { rows: [] }, // advisory lock
      { rows: [{ id: "topup-1", user_id: "user-1", amount: 10000, status: "paid" }] }, // SELECT topup → already paid
    ]);

    const result = await creditVerifiedTopup("topup-1", "tx-123");
    expect(result.status).toBe("paid");
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it("does not credit if duplicate reference exists", async () => {
    queueExecuteResults([
      { rows: [] }, // advisory lock
      { rows: [{ id: "topup-1", user_id: "user-1", amount: 10000, status: "pending" }] }, // SELECT topup
    ]);
    // duplicate found
    mockTx.select.mockReturnValue(chainable([{ id: "existing-tx" }]));

    const result = await creditVerifiedTopup("topup-1", "tx-123");
    expect(result.status).toBe("already_processed");
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it("does not credit terminal statuses (expired, failed, rejected)", async () => {
    for (const terminalStatus of ["expired", "failed", "rejected", "cancelled"]) {
      resetMocks();
      queueExecuteResults([
        { rows: [] }, // advisory lock
        { rows: [{ id: "topup-1", user_id: "user-1", amount: 10000, status: terminalStatus }] }, // SELECT topup
      ]);

      const result = await creditVerifiedTopup("topup-1", "tx-123");
      expect(result.status).toBe(terminalStatus);
      expect(mockTx.insert).not.toHaveBeenCalled();
    }
  });
});
