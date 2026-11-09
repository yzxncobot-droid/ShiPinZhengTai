import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @workspace/db
const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock("@workspace/db", () => {
  const tx = {
    execute: (...args: any[]) => mockExecute(...args),
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
    insert: (...args: any[]) => mockInsert(...args),
    delete: (...args: any[]) => mockDelete(...args),
  };
  return {
    db: {
      transaction: vi.fn(async (callback: any) => callback(tx)),
      select: (...args: any[]) => mockSelect(...args),
      update: (...args: any[]) => mockUpdate(...args),
      insert: (...args: any[]) => mockInsert(...args),
      execute: (...args: any[]) => mockExecute(...args),
    },
    topupsTable: { id: "id", userId: "user_id", amount: "amount", status: "status", paymentMethod: "payment_method" },
    usersTable: { id: "id", walletBalance: "wallet_balance", totalTopup: "total_topup" },
    walletsTable: { id: "id", userId: "user_id", balance: "balance", totalEarned: "total_earned" },
    walletTransactionsTable: { id: "id", referenceType: "reference_type", referenceId: "reference_id" },
    transactionsTable: { id: "id" },
    notificationsTable: { id: "id" },
    paymentProofsTable: { id: "id" },
    settingsTable: { qrisImage: "qris_image" },
    auditLogsTable: { id: "id", action: "action", userId: "user_id" },
  };
});

vi.mock("./redis", () => ({
  invalidateUserCache: vi.fn().mockResolvedValue(undefined),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
  keys: { analytics: vi.fn().mockReturnValue("key") },
}));

import { creditVerifiedTopup, isPaidStatus } from "./topup-verification";

describe("creditVerifiedTopup - manual approval single credit path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("credits wallet when status is pending and topup exists", async () => {
    const topupId = "11111111-1111-1111-1111-111111111111";
    const userId = "22222222-2222-2222-2222-222222222222";
    const ref = `admin-${topupId}`;

    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [{ id: topupId, user_id: userId, amount: 50000, status: "pending" }] }) // topup
      .mockResolvedValueOnce({ rows: [{ id: userId, wallet_balance: 10000, total_topup: 10000 }] }); // user

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    });

    const result = await creditVerifiedTopup(topupId, ref);
    expect(result.status).toBe("paid");
    expect(result.newBalance).toBe(60000);
  });

  it("returns paid without double-crediting if topup is already paid", async () => {
    const topupId = "11111111-1111-1111-1111-111111111111";
    const userId = "22222222-2222-2222-2222-222222222222";
    const ref = `admin-${topupId}`;

    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [{ id: topupId, user_id: userId, amount: 50000, status: "paid" }] }); // topup

    const result = await creditVerifiedTopup(topupId, ref);
    expect(result.status).toBe("paid");
    expect(result.newBalance).toBeUndefined();
  });

  it("does not credit if topup status is rejected", async () => {
    const topupId = "11111111-1111-1111-1111-111111111111";
    const userId = "22222222-2222-2222-2222-222222222222";
    const ref = `admin-${topupId}`;

    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: topupId, user_id: userId, amount: 50000, status: "rejected" }] });

    const result = await creditVerifiedTopup(topupId, ref);
    expect(result.status).toBe("rejected");
    expect(result.newBalance).toBeUndefined();
  });

  it("prevents double-crediting if reference is already processed", async () => {
    const topupId = "11111111-1111-1111-1111-111111111111";
    const userId = "22222222-2222-2222-2222-222222222222";
    const ref = `admin-${topupId}`;

    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: topupId, user_id: userId, amount: 50000, status: "pending" }] });

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "existing-tx" }]),
        }),
      }),
    });

    const result = await creditVerifiedTopup(topupId, ref);
    expect(result.status).toBe("already_processed");
  });
});
