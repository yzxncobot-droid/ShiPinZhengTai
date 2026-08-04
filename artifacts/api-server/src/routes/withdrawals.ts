import { Router } from "express";
import { db } from "@workspace/db";
import {
  withdrawalsTable, usersTable, transactionsTable, notificationsTable, auditLogsTable,
  walletTransactionsTable, walletsTable,
} from "@workspace/db";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { invalidateUserCache } from "../lib/redis";
import { logger } from "../lib/logger";

const router = Router();

// User: create withdrawal request
router.post("/withdrawals", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { amount, method = "bank", accountName, accountNumber, bankName, notes } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: "Invalid amount" }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.walletBalance < amount) {
    res.status(400).json({ error: "Insufficient wallet balance" }); return;
  }

  const [withdrawal] = await db.insert(withdrawalsTable).values({
    userId, amount, method, accountName, accountNumber, bankName, notes,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId, action: "create_withdrawal", entity: "withdrawal", entityId: withdrawal.id,
    details: JSON.stringify({ amount, method }),
    ipAddress: req.ip,
  });

  res.status(201).json(withdrawal);
});

// User: list own withdrawals
router.get("/withdrawals/my", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const [{ total }] = await db.select({ total: count() }).from(withdrawalsTable)
    .where(eq(withdrawalsTable.userId, userId));
  const data = await db.select().from(withdrawalsTable)
    .where(eq(withdrawalsTable.userId, userId))
    .orderBy(desc(withdrawalsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// Admin/owner: list all withdrawals
router.get("/withdrawals/all", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  const where = status ? eq(withdrawalsTable.status, status as any) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(withdrawalsTable).where(where);

  const raw = await db.select().from(withdrawalsTable)
    .where(where)
    .orderBy(desc(withdrawalsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = await Promise.all(raw.map(async (w: any) => {
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, avatar: usersTable.avatar,
    }).from(usersTable).where(eq(usersTable.id, w.userId)).limit(1);
    return { ...w, user: user ?? null };
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

// Admin/owner: approve withdrawal
router.patch("/withdrawals/:id/approve", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const adminId = req.user!.userId;

  try {
    const [withdrawal] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
    if (!withdrawal) { res.status(404).json({ error: "Withdrawal not found" }); return; }
    if (withdrawal.status !== "pending") {
      res.status(400).json({ error: `Cannot approve: withdrawal is already "${withdrawal.status}"` }); return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, withdrawal.userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    if (user.walletBalance < withdrawal.amount) {
      res.status(400).json({ error: `User has insufficient balance (balance: Rp ${user.walletBalance.toLocaleString("id-ID")}, requested: Rp ${withdrawal.amount.toLocaleString("id-ID")})` }); return;
    }

    const newBalance = user.walletBalance - withdrawal.amount;
    const amountFormatted = withdrawal.amount.toLocaleString("id-ID");

    logger.info({ withdrawalId: id, userId: withdrawal.userId, amount: withdrawal.amount, by: adminId }, "Withdrawal approve: starting transaction");

    await db.transaction(async (tx: any) => {
      // Step 1: deduct from user balance cache
      await tx.update(usersTable).set({
        walletBalance: newBalance,
        totalSpent: sql`${usersTable.totalSpent} + ${withdrawal.amount}`,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, withdrawal.userId));
      logger.info({ withdrawalId: id }, "Withdrawal approve: user balance updated");

      // Step 2: deduct from wallet ledger
      await tx.update(walletsTable).set({
        balance: newBalance,
        totalSpent: sql`${walletsTable.totalSpent} + ${withdrawal.amount}`,
        updatedAt: new Date(),
        lastTransactionAt: new Date(),
      }).where(eq(walletsTable.userId, withdrawal.userId));
      logger.info({ withdrawalId: id }, "Withdrawal approve: wallet updated");

      // Step 3: mark withdrawal approved
      await tx.update(withdrawalsTable).set({
        status: "approved", processedBy: adminId, processedAt: new Date(), updatedAt: new Date(),
      }).where(eq(withdrawalsTable.id, id));
      logger.info({ withdrawalId: id }, "Withdrawal approve: status set to approved");

      // Step 4: append to transactions history
      await tx.insert(transactionsTable).values({
        userId: withdrawal.userId,
        type: "adjustment",
        amount: -withdrawal.amount,
        description: `Withdrawal approved: Rp ${amountFormatted}`,
        referenceId: withdrawal.id,
      });
      logger.info({ withdrawalId: id }, "Withdrawal approve: transaction record inserted");

      // Step 5: append to wallet transactions ledger
      await tx.insert(walletTransactionsTable).values({
        userId: withdrawal.userId,
        type: "adjustment",
        amount: -withdrawal.amount,
        balanceAfter: newBalance,
        description: `Withdrawal approved: Rp ${amountFormatted}`,
        referenceType: "withdrawal",
        referenceId: withdrawal.id,
        createdBy: adminId,
      });
      logger.info({ withdrawalId: id }, "Withdrawal approve: wallet transaction record inserted");

      // Step 6: send approval notification
      await tx.insert(notificationsTable).values({
        userId: withdrawal.userId,
        title: "Penarikan Dana Disetujui",
        message: `Penarikan dana sebesar Rp ${amountFormatted} telah disetujui dan sedang diproses.`,
        type: "success",
        category: "payment",
        referenceType: "withdrawal",
        referenceId: withdrawal.id,
      });
      logger.info({ withdrawalId: id }, "Withdrawal approve: notification sent");
    });

    await invalidateUserCache(withdrawal.userId);

    const [updated] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
    logger.info({ withdrawalId: id, userId: withdrawal.userId, amount: withdrawal.amount, by: adminId }, "Withdrawal approved successfully");
    res.json(updated);
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, id }, "Withdrawal approve failed");
    const detail = err?.message ?? "Unknown error";
    res.status(500).json({ error: `Failed to approve withdrawal: ${detail}` });
  }
});

// Admin/owner: reject withdrawal
router.patch("/withdrawals/:id/reject", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const adminId = req.user!.userId;
  const { reason } = req.body;

  try {
    const [withdrawal] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, id)).limit(1);
    if (!withdrawal) { res.status(404).json({ error: "Withdrawal not found" }); return; }
    if (withdrawal.status !== "pending") {
      res.status(400).json({ error: `Cannot reject: withdrawal is already "${withdrawal.status}"` }); return;
    }

    const amountFormatted = withdrawal.amount.toLocaleString("id-ID");
    logger.info({ withdrawalId: id, userId: withdrawal.userId, amount: withdrawal.amount, by: adminId }, "Withdrawal reject: starting transaction");

    let updated: typeof withdrawal;
    await db.transaction(async (tx: any) => {
      // Step 1: mark withdrawal rejected with reason
      const [result] = await tx.update(withdrawalsTable).set({
        status: "rejected",
        processedBy: adminId,
        processedAt: new Date(),
        notes: reason || withdrawal.notes,
        updatedAt: new Date(),
      }).where(eq(withdrawalsTable.id, id)).returning();
      updated = result;
      logger.info({ withdrawalId: id }, "Withdrawal reject: status set to rejected");

      // Step 2: send rejection notification
      await tx.insert(notificationsTable).values({
        userId: withdrawal.userId,
        title: "Penarikan Dana Ditolak",
        message: `Penarikan dana sebesar Rp ${amountFormatted} ditolak.${reason ? ` Alasan: ${reason}` : " Hubungi admin untuk informasi lebih lanjut."}`,
        type: "warning",
        category: "payment",
        referenceType: "withdrawal",
        referenceId: withdrawal.id,
      });
      logger.info({ withdrawalId: id }, "Withdrawal reject: notification sent");

      // Step 3: audit log
      await tx.insert(auditLogsTable).values({
        userId: adminId,
        action: "reject_withdrawal",
        entity: "withdrawal",
        entityId: id,
        details: JSON.stringify({ amount: withdrawal.amount, reason: reason ?? null }),
        ipAddress: req.ip,
      });
      logger.info({ withdrawalId: id }, "Withdrawal reject: audit log written");
    });

    logger.info({ withdrawalId: id, userId: withdrawal.userId, amount: withdrawal.amount, by: adminId }, "Withdrawal rejected successfully");
    res.json(updated!);
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, id }, "Withdrawal reject failed");
    const detail = err?.message ?? "Unknown error";
    res.status(500).json({ error: `Failed to reject withdrawal: ${detail}` });
  }
});

export default router;
