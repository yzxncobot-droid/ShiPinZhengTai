import { describe, it, expect, vi, beforeEach } from "vitest";

/* ──────────────────────────────────────────────────────────────────────────
 * Mock state — hoisted so it's available inside vi.mock factories.
 * ──────────────────────────────────────────────────────────────────────── */
const mockState = vi.hoisted(() => ({
  topup: null as any,
  txExecuteResults: [] as any[],
  txSelectResult: [] as any[],
  gatewayState: "CONNECTED",
  orderResult: null as any,
  orderThrows: false,
}));

/* ────────────────────────────────────────────────────────────────────────
 * Chainable thenable query-builder mock.
 * Drizzle's builder is chainable (select→from→where→limit) and the final
 * result is awaitable. We replicate that with a minimal chainable object.
 * ──────────────────────────────────────────────────────────────────────── */
function chainable(result: any = []): any {
  const self: any = {
    from: () => self,
    where: () => self,
    and: () => self,
    limit: () => Promise.resolve(result),
    orderBy: () => ({ limit: () => Promise.resolve(result) }),
    values: () => self,
    returning: () => Promise.resolve(result),
    set: () => ({ where: () => Promise.resolve(result) }),
  };
  return self;
}

/* ── Mock tx (inside db.transaction) ───────────────────────────────────── */
function createMockTx() {
  let execIdx = 0;
  return {
    execute: vi.fn(() => Promise.resolve(mockState.txExecuteResults[execIdx++] ?? { rows: [] })),
    select: vi.fn(() => chainable(mockState.txSelectResult)),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
  };
}

/* ── Module mocks (paths relative to this test file: src/lib/__tests__/) ── */

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => chainable(mockState.topup ? [mockState.topup] : [])),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
    transaction: vi.fn(async (cb: any) => cb(createMockTx())),
  },
  topupsTable: { id: "topups.id", userId: "topups.user_id", amount: "topups.amount", status: "topups.status", orderId: "topups.order_id" },
  usersTable: { id: "users.id", walletBalance: "users.wallet_balance", totalTopup: "users.total_topup" },
  walletsTable: { userId: "wallets.user_id" },
  walletTransactionsTable: { id: "wt.id", referenceType: "wt.reference_type", referenceId: "wt.reference_id" },
  transactionsTable: {},
  notificationsTable: {},
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../redis", () => ({
  invalidateUserCache: vi.fn(() => Promise.resolve()),
  invalidateCache: vi.fn(() => Promise.resolve()),
  keys: { analytics: (k: string) => `analytics:${k}` },
}));

vi.mock("../temanqris", () => ({
  getOrder: vi.fn(async () => {
    if (mockState.orderThrows) throw new Error("Gateway error");
    return mockState.orderResult ?? { orderId: "ORDER-123", amount: 10000, status: "pending" };
  }),
  getGatewayState: vi.fn(() => mockState.gatewayState),
}));

/* ── Import AFTER mocks are registered ──────────────────────────────────── */
import { verifyAndCreditTopup, creditVerifiedTopup } from "../topup-verification";
import { db } from "@workspace/db";
import { getOrder } from "../temanqris";

/* ── Test constants ──────────────────────────────────────────────────────── */
const TOPUP_ID = "topup-001";
const USER_ID = "user-001";
const ORDER_ID = "ORDER-123";
const AMOUNT = 10000;

function makeTopup(overrides: Partial<any> = {}) {
  return {
    id: TOPUP_ID,
    userId: USER_ID,
    amount: AMOUNT,
    orderId: ORDER_ID,
    status: "pending",
    ...overrides,
  };
}

/** Configure txExecuteResults for a pending topup that will be credited. */
function setPaidTransactionResult() {
  mockState.txExecuteResults = [
    { rows: [] }, // advisory lock
    { rows: [{ id: TOPUP_ID, user_id: USER_ID, amount: AMOUNT, status: "pending" }] }, // topup FOR UPDATE
    { rows: [{ id: USER_ID, wallet_balance: 5000, total_topup: 0 }] }, // user FOR UPDATE
  ];
  mockState.txSelectResult = []; // no duplicate wallet transaction
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default mock implementations after clearAllMocks
  (db.select as any).mockImplementation(() => chainable(mockState.topup ? [mockState.topup] : []));
  (db.transaction as any).mockImplementation(async (cb: any) => cb(createMockTx()));

  mockState.topup = null;
  mockState.txExecuteResults = [];
  mockState.txSelectResult = [];
  mockState.gatewayState = "CONNECTED";
  mockState.orderResult = null;
  mockState.orderThrows = false;
});

/* ═══════════════════════════════════════════════════════════════════════════
 *  verifyAndCreditTopup — the "Sudah Bayar" flow (Jalur A)
 * ══════════════════════════════════════════════════════════════════════════ */
describe("verifyAndCreditTopup", () => {
  /* Test 1: TemanQRIS = awaiting_confirmation → no credit */
  it("Test 1 — awaiting_confirmation from gateway → awaiting_payment, no credit", async () => {
    mockState.topup = makeTopup();
    mockState.orderResult = { orderId: ORDER_ID, amount: AMOUNT, status: "awaiting_confirmation" };

    const result = await verifyAndCreditTopup(TOPUP_ID, USER_ID);

    expect(result.success).toBe(false);
    expect(result.status).toBe("awaiting_payment");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  /* Test 2: paid + all match → credit */
  it("Test 2 — paid + order_id/amount/user match → paid, creditVerifiedTopup called", async () => {
    mockState.topup = makeTopup();
    mockState.orderResult = { orderId: ORDER_ID, amount: AMOUNT, status: "paid" };
    setPaidTransactionResult();

    const result = await verifyAndCreditTopup(TOPUP_ID, USER_ID);

    expect(result.success).toBe(true);
    expect(result.status).toBe("paid");
    expect(result.amount).toBe(AMOUNT);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  /* Test 3: paid + order_id mismatch → verification_failed, no credit */
  it("Test 3 — paid + order_id mismatch → verification_failed, no credit", async () => {
    mockState.topup = makeTopup();
    mockState.orderResult = { orderId: "DIFFERENT-ORDER", amount: AMOUNT, status: "paid" };

    const result = await verifyAndCreditTopup(TOPUP_ID, USER_ID);

    expect(result.success).toBe(false);
    expect(result.status).toBe("verification_failed");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  /* Test 4: paid + amount mismatch → verification_failed, no credit */
  it("Test 4 — paid + amount mismatch → verification_failed, no credit", async () => {
    mockState.topup = makeTopup();
    mockState.orderResult = { orderId: ORDER_ID, amount: 99999, status: "paid" };

    const result = await verifyAndCreditTopup(TOPUP_ID, USER_ID);

    expect(result.success).toBe(false);
    expect(result.status).toBe("verification_failed");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  /* Test 5: paid + user mismatch → verification_failed, no credit */
  it("Test 5 — user mismatch → verification_failed, no credit", async () => {
    mockState.topup = makeTopup({ userId: "other-user" });
    mockState.orderResult = { orderId: ORDER_ID, amount: AMOUNT, status: "paid" };

    const result = await verifyAndCreditTopup(TOPUP_ID, "different-auth-user");

    expect(result.success).toBe(false);
    expect(result.status).toBe("verification_failed");
    expect(getOrder).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  /* Test 8: double click → only one credit (idempotency) */
  it("Test 8 — double click (second call finds topup already paid) → no second credit", async () => {
    // First call: topup pending, gateway reports paid → credits
    mockState.topup = makeTopup();
    mockState.orderResult = { orderId: ORDER_ID, amount: AMOUNT, status: "paid" };
    setPaidTransactionResult();

    const result1 = await verifyAndCreditTopup(TOPUP_ID, USER_ID);
    expect(result1.success).toBe(true);
    expect(result1.status).toBe("paid");
    expect(db.transaction).toHaveBeenCalledTimes(1);

    // Second call: topup is now paid (status set by creditVerifiedTopup)
    mockState.topup = makeTopup({ status: "paid" });
    vi.clearAllMocks();
    (db.select as any).mockImplementation(() => chainable([mockState.topup]));

    const result2 = await verifyAndCreditTopup(TOPUP_ID, USER_ID);

    expect(result2.success).toBe(true);
    expect(result2.status).toBe("paid");
    expect(getOrder).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  /* Test 10: already paid rechecked → no second credit */
  it("Test 10 — already paid topup rechecked → paid returned, no credit", async () => {
    mockState.topup = makeTopup({ status: "paid" });

    const result = await verifyAndCreditTopup(TOPUP_ID, USER_ID);

    expect(result.success).toBe(true);
    expect(result.status).toBe("paid");
    expect(getOrder).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 *  creditVerifiedTopup — the single credit function
 * ══════════════════════════════════════════════════════════════════════════ */
describe("creditVerifiedTopup", () => {
  /* Test 6: payment.confirmed webhook → creditVerifiedTopup credits the wallet */
  it("Test 6 — webhook confirmed → creditVerifiedTopup credits the wallet", async () => {
    setPaidTransactionResult();

    const result = await creditVerifiedTopup(TOPUP_ID, ORDER_ID);

    expect(result.status).toBe("paid");
    expect(result.newBalance).toBe(15000); // 5000 + 10000
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  /* Test 7: webhook sent twice → balance increases only once */
  it("Test 7 — called twice with same reference → second call detects already paid, no double credit", async () => {
    setPaidTransactionResult();

    const result1 = await creditVerifiedTopup(TOPUP_ID, ORDER_ID);
    expect(result1.status).toBe("paid");

    // Second call: topup is now paid (set by first credit) — returns "paid"
    // without executing the credit logic, so balance is NOT increased again.
    mockState.txExecuteResults = [
      { rows: [] },
      { rows: [{ id: TOPUP_ID, user_id: USER_ID, amount: AMOUNT, status: "paid" }] },
    ];

    const result2 = await creditVerifiedTopup(TOPUP_ID, ORDER_ID);
    expect(result2.status).toBe("paid");
  });

  /* Test 9: awaiting_confirmation topup → can still be credited (not terminal) */
  it("Test 9 — awaiting_confirmation topup is a valid pre-credit state (not terminal)", async () => {
    mockState.txExecuteResults = [
      { rows: [] },
      { rows: [{ id: TOPUP_ID, user_id: USER_ID, amount: AMOUNT, status: "awaiting_confirmation" }] },
      { rows: [{ id: USER_ID, wallet_balance: 0, total_topup: 0 }] },
    ];
    mockState.txSelectResult = [];

    const result = await creditVerifiedTopup(TOPUP_ID, ORDER_ID);
    expect(result.status).toBe("paid");
    expect(result.newBalance).toBe(AMOUNT);
  });

  /* Extra: expired topup → not credited */
  it("expired topup → returns status without crediting", async () => {
    mockState.txExecuteResults = [
      { rows: [] },
      { rows: [{ id: TOPUP_ID, user_id: USER_ID, amount: AMOUNT, status: "expired" }] },
    ];

    const result = await creditVerifiedTopup(TOPUP_ID, ORDER_ID);
    expect(result.status).toBe("expired");
  });

  /* Extra: duplicate gateway reference → already_processed */
  it("duplicate gateway reference (topup still pending) → already_processed, no credit", async () => {
    mockState.txExecuteResults = [
      { rows: [] },
      { rows: [{ id: TOPUP_ID, user_id: USER_ID, amount: AMOUNT, status: "pending" }] },
      { rows: [{ id: USER_ID, wallet_balance: 5000, total_topup: 0 }] },
    ];
    mockState.txSelectResult = [{ id: "wt-existing" }]; // duplicate found

    const result = await creditVerifiedTopup(TOPUP_ID, ORDER_ID);
    expect(result.status).toBe("already_processed");
  });
});
