import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable } from "@workspace/db";
import { eq, desc, ilike, and, gte, lte, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/audit-logs", authenticate, requireRole("owner"), async (req, res) => {
  const { action, userId, page = "1", limit = "50", from, to } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 50, 200);
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (action) conditions.push(ilike(auditLogsTable.action, `%${action}%`));
  if (userId) conditions.push(eq(auditLogsTable.userId, userId)); // UUID string directly
  if (from) conditions.push(gte(auditLogsTable.createdAt, new Date(from)));
  if (to) conditions.push(lte(auditLogsTable.createdAt, new Date(to)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(auditLogsTable).where(where);

  const raw = await db.select().from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const data = await Promise.all(raw.map(async (log: any) => {
    let user = null;
    if (log.userId) {
      const [u] = await db.select({
        id: usersTable.id, username: usersTable.username, email: usersTable.email, role: usersTable.role,
      }).from(usersTable).where(eq(usersTable.id, log.userId)).limit(1);
      user = u || null;
    }
    return { ...log, user };
  }));

  res.json({ data, total: Number(total), page: pageNum, limit: limitNum });
});

export default router;
