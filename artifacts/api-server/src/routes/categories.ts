import { Router } from "express";
import { db } from "@workspace/db";
import { categoriesTable, videosTable } from "@workspace/db";
import { eq, count, isNull } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/categories", async (_req, res) => {
  try {
    const cats = await db.select().from(categoriesTable)
      .where(isNull(categoriesTable.deletedAt))
      .orderBy(categoriesTable.name);
    const withCount = await Promise.all(cats.map(async (c: any) => {
      const [{ value }] = await db.select({ value: count() }).from(videosTable)
        .where(eq(videosTable.categoryId, c.id));
      return { ...c, videoCount: Number(value) };
    }));
    res.json(withCount);
  } catch (err) {
    console.error("GET /categories failed:", err);
    res.json([]);
  }
});

router.post("/categories", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { name, description, icon, banner, slug, sortOrder, isActive } = req.body;
  if (!name) { res.status(400).json({ error: "Name required" }); return; }
  const [cat] = await db.insert(categoriesTable)
    .values({ name, description, icon, banner, slug, sortOrder, isActive })
    .returning();
  res.status(201).json({ ...cat, videoCount: 0 });
});

router.patch("/categories/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const { name, description, icon, banner, slug, sortOrder, isActive } = req.body;
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (icon !== undefined) updates.icon = icon;
  if (banner !== undefined) updates.banner = banner;
  if (slug !== undefined) updates.slug = slug;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (isActive !== undefined) updates.isActive = isActive;
  const [cat] = await db.update(categoriesTable).set(updates).where(eq(categoriesTable.id, id)).returning();
  if (!cat) { res.status(404).json({ error: "Not found" }); return; }
  const [{ value }] = await db.select({ value: count() }).from(videosTable).where(eq(videosTable.categoryId, id));
  res.json({ ...cat, videoCount: Number(value) });
});

router.delete("/categories/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  // Soft delete
  await db.update(categoriesTable).set({ deletedAt: new Date() }).where(eq(categoriesTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
