import { Router } from "express";
import { db } from "@workspace/db";
import {
  bundlesTable, bundleVideosTable, bundlePurchasesTable,
  videosTable, usersTable, transactionsTable, notificationsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, gte, sql } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

function discountPercentOf(price: number, originalPrice: number | null | undefined): number {
  if (!originalPrice || originalPrice <= price) return 0;
  return Math.round((1 - price / originalPrice) * 100);
}

async function formatBundle(
  b: typeof bundlesTable.$inferSelect,
  opts: { includeVideos?: boolean; userId?: number } = {},
) {
  const rows = await db
    .select({
      id: videosTable.id, title: videosTable.title, thumbnail: videosTable.thumbnail,
      visibility: videosTable.visibility, sortOrder: bundleVideosTable.sortOrder,
    })
    .from(bundleVideosTable)
    .innerJoin(videosTable, eq(videosTable.id, bundleVideosTable.videoId))
    .where(eq(bundleVideosTable.bundleId, b.id))
    .orderBy(asc(bundleVideosTable.sortOrder));

  let hasPurchased = false;
  if (opts.userId) {
    const [p] = await db
      .select({ id: bundlePurchasesTable.id })
      .from(bundlePurchasesTable)
      .where(and(eq(bundlePurchasesTable.userId, opts.userId), eq(bundlePurchasesTable.bundleId, b.id)))
      .limit(1);
    hasPurchased = !!p;
  }

  const base = {
    id: b.id,
    title: b.title,
    description: b.description,
    thumbnail: b.thumbnail,
    banner: b.banner,
    price: b.price,
    originalPrice: b.originalPrice,
    badge: b.badge,
    isActive: b.isActive,
    sortOrder: b.sortOrder,
    videoCount: rows.length,
    discountPercent: discountPercentOf(b.price, b.originalPrice),
    hasPurchased,
    createdAt: b.createdAt,
  };

  return opts.includeVideos
    ? {
        ...base,
        videos: rows.map((r) => ({
          id: r.id, title: r.title, thumbnail: r.thumbnail,
          // When user has purchased the bundle, include video details; otherwise hide
          ...(hasPurchased ? {} : {}),
        })),
      }
    : base;
}

async function validateVideoIds(videoIds: unknown): Promise<{ ids: number[] } | { error: string }> {
  if (!Array.isArray(videoIds) || videoIds.length < 1 || videoIds.length > 10) {
    return { error: "A bundle must contain between 1 and 10 videos" };
  }
  const ids = [...new Set(videoIds.map((v) => parseInt(v as any, 10)))];
  if (ids.some((id) => Number.isNaN(id))) {
    return { error: "Invalid video id in videoIds" };
  }
  const existing = await db.select({ id: videosTable.id }).from(videosTable).where(inArray(videosTable.id, ids));
  if (existing.length !== ids.length) {
    return { error: "One or more selected videos do not exist" };
  }
  return { ids };
}

/**
 * Mark all videos as hidden_bundle + keep bundleExclusive flag in sync.
 * Videos removed from all bundles have their visibility reset to "premium".
 */
async function syncBundleVideoVisibility(videoIds: number[]) {
  if (videoIds.length === 0) return;
  await db.update(videosTable)
    .set({ visibility: "hidden_bundle", bundleExclusive: true, type: "premium", updatedAt: new Date() })
    .where(inArray(videosTable.id, videoIds));
}

/** Clear bundleExclusive / reset visibility for videos no longer in any bundle. */
async function clearStaleBundleExclusive(videoIds: number[]) {
  if (videoIds.length === 0) return;
  const stillLinked = await db
    .select({ videoId: bundleVideosTable.videoId })
    .from(bundleVideosTable)
    .where(inArray(bundleVideosTable.videoId, videoIds));
  const stillLinkedSet = new Set(stillLinked.map((r) => r.videoId));
  const toClear = videoIds.filter((id) => !stillLinkedSet.has(id));
  if (toClear.length > 0) {
    // Demote to premium (not public) since these were previously locked videos
    await db.update(videosTable)
      .set({ visibility: "premium", bundleExclusive: false, updatedAt: new Date() })
      .where(inArray(videosTable.id, toClear));
  }
}

// GET /bundles — public list (inactive bundles hidden from non-admins)
router.get("/bundles", optionalAuth, async (req, res) => {
  const isStaff = req.user?.role === "admin" || req.user?.role === "owner";
  const raw = isStaff
    ? await db.select().from(bundlesTable).orderBy(asc(bundlesTable.sortOrder))
    : await db.select().from(bundlesTable).where(eq(bundlesTable.isActive, true)).orderBy(asc(bundlesTable.sortOrder));
  const data = await Promise.all(raw.map((b) => formatBundle(b, { userId: req.user?.userId })));
  res.json(data);
});

// POST /bundles (admin or owner)
router.post("/bundles", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const {
    title, description, thumbnail, banner, price, originalPrice,
    badge, isActive = true, sortOrder = 0, videoIds,
  } = req.body;

  if (!title || price == null) {
    res.status(400).json({ error: "Title and price are required" }); return;
  }

  const validated = await validateVideoIds(videoIds);
  if ("error" in validated) { res.status(400).json({ error: validated.error }); return; }

  const [bundle] = await db.insert(bundlesTable).values({
    title, description, thumbnail, banner, price, originalPrice, badge, isActive, sortOrder,
  }).returning();

  await db.insert(bundleVideosTable).values(
    validated.ids.map((videoId, i) => ({ bundleId: bundle.id, videoId, sortOrder: i })),
  );
  // Mark all videos in this bundle as hidden_bundle
  await syncBundleVideoVisibility(validated.ids);

  logger.info({ bundleId: bundle.id, videoCount: validated.ids.length }, "Bundle created");
  res.status(201).json(await formatBundle(bundle, { includeVideos: true }));
});

// GET /bundles/:id
router.get("/bundles/:id", optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, id)).limit(1);
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }
  res.json(await formatBundle(bundle, { includeVideos: true, userId: req.user?.userId }));
});

// PATCH /bundles/:id (admin or owner)
router.patch("/bundles/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, id)).limit(1);
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

  const {
    title, description, thumbnail, banner, price, originalPrice,
    badge, isActive, sortOrder, videoIds,
  } = req.body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (thumbnail !== undefined) updates.thumbnail = thumbnail;
  if (banner !== undefined) updates.banner = banner;
  if (price !== undefined) updates.price = price;
  if (originalPrice !== undefined) updates.originalPrice = originalPrice;
  if (badge !== undefined) updates.badge = badge;
  if (isActive !== undefined) updates.isActive = isActive;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;

  if (videoIds !== undefined) {
    const validated = await validateVideoIds(videoIds);
    if ("error" in validated) { res.status(400).json({ error: validated.error }); return; }

    const oldRows = await db.select({ videoId: bundleVideosTable.videoId })
      .from(bundleVideosTable).where(eq(bundleVideosTable.bundleId, id));
    const oldVideoIds = oldRows.map((r) => r.videoId);

    await db.delete(bundleVideosTable).where(eq(bundleVideosTable.bundleId, id));
    await db.insert(bundleVideosTable).values(
      validated.ids.map((videoId, i) => ({ bundleId: id, videoId, sortOrder: i })),
    );
    await syncBundleVideoVisibility(validated.ids);

    const removedVideoIds = oldVideoIds.filter((v) => !validated.ids.includes(v));
    await clearStaleBundleExclusive(removedVideoIds);
  }

  const [updated] = await db.update(bundlesTable).set(updates).where(eq(bundlesTable.id, id)).returning();
  res.json(await formatBundle(updated, { includeVideos: true }));
});

// DELETE /bundles/:id (admin or owner)
router.delete("/bundles/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, id)).limit(1);
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

  const rows = await db.select({ videoId: bundleVideosTable.videoId })
    .from(bundleVideosTable).where(eq(bundleVideosTable.bundleId, id));
  const videoIds = rows.map((r) => r.videoId);

  await db.delete(bundlesTable).where(eq(bundlesTable.id, id));
  await clearStaleBundleExclusive(videoIds);

  res.json({ message: "Deleted" });
});

// POST /bundles/:id/purchase
router.post("/bundles/:id/purchase", authenticate, async (req, res) => {
  const bundleId = parseInt(req.params.id);
  const userId = req.user!.userId;

  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, bundleId)).limit(1);
  if (!bundle || !bundle.isActive) { res.status(404).json({ error: "Bundle not found" }); return; }

  const [existing] = await db
    .select({ id: bundlePurchasesTable.id })
    .from(bundlePurchasesTable)
    .where(and(eq(bundlePurchasesTable.userId, userId), eq(bundlePurchasesTable.bundleId, bundleId)))
    .limit(1);
  if (existing) { res.status(400).json({ error: "You already own this bundle" }); return; }

  const price = bundle.price;

  try {
    const result = await db.transaction(async (tx) => {
      const [debited] = await tx
        .update(usersTable)
        .set({
          walletBalance: sql`${usersTable.walletBalance} - ${price}`,
          totalSpent: sql`${usersTable.totalSpent} + ${price}`,
          updatedAt: new Date(),
        })
        .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, price)))
        .returning({ id: usersTable.id });

      if (!debited) return { error: "INSUFFICIENT_BALANCE" as const };

      const [purchase] = await tx.insert(bundlePurchasesTable).values({ userId, bundleId, price }).returning();

      await tx.insert(transactionsTable).values({
        userId, type: "purchase", amount: -price,
        description: `Purchased bundle: ${bundle.title}`,
        referenceId: purchase.id,
      });

      await tx.insert(notificationsTable).values({
        userId, title: "Bundle Purchased",
        message: `You now own the "${bundle.title}" bundle forever.`,
        type: "purchase",
      });

      return { purchase };
    });

    if ("error" in result) {
      res.status(400).json({ error: "Insufficient wallet balance" }); return;
    }

    res.json({ ...result.purchase, bundle: await formatBundle(bundle, { includeVideos: true, userId }) });
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "23505") { res.status(400).json({ error: "You already own this bundle" }); return; }
    logger.error({ err, userId, bundleId }, "Bundle purchase failed");
    res.status(500).json({ error: "Purchase failed" });
  }
});

export default router;
