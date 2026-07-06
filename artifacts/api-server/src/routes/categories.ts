import { Router } from "express";
import { db } from "@workspace/db";
import { categoriesTable, videosTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/categories", async (_req, res) => {
  const cats = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  const withCount = await Promise.all(cats.map(async (c) => {
    const [{ value }] = await db.select({ value: count() }).from(videosTable).where(eq(videosTable.categoryId, c.id));
    return { ...c, videoCount: Number(value) };
  }));
  res.json(withCount);
});

router.post("/categories", authenticate, requireRole("owner"), async (req, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "Name required" }); return; }
  const [cat] = await db.insert(categoriesTable).values({ name, description }).returning();
  res.status(201).json({ ...cat, videoCount: 0 });
});

router.patch("/categories/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, description } = req.body;
  const [cat] = await db.update(categoriesTable).set({ name, description }).where(eq(categoriesTable.id, id)).returning();
  const [{ value }] = await db.select({ value: count() }).from(videosTable).where(eq(videosTable.categoryId, id));
  res.json({ ...cat, videoCount: Number(value) });
});

router.delete("/categories/:id", authenticate, requireRole("owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
