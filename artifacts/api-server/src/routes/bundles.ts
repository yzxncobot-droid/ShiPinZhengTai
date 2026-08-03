import { Router } from "express";
import { db } from "@workspace/db";
import {
  bundlesTable, bundleVideosTable, bundlePurchasesTable,
  videosTable, usersTable, transactionsTable, notificationsTable,
  walletTransactionsTable, walletsTable, revenueSharesTable,
} from "@workspace/db";
import { eq, and, inArray, asc, gte, sql, isNull } from "drizzle-orm";
import { authenticate, optionalAuth, requireRole } from "../middlewares/auth";
import { invalidateUserCache, invalidateCache, keys } from "../lib/redis";
import { logger } from "../lib/logger";

const router = Router();

function discountPercentOf(price: number, originalPrice: number | null | undefined): number {
  if (!originalPrice || originalPrice <= price) return 0;
  return Math.round((1 - price / originalPrice) * 100);
}

async function formatBundle(
  b: typeof bundlesTable.$inferSelect,
  opts: { includeVideos?: boolean; userId?: string } = {},
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
    ? { ...base, videos: rows.map((r) => ({ id: r.id, title: r.title, thumbnail: r.thumbnail })) }
    : base;
}

/** Validate an array of video IDs (UUID strings). */
async function validateVideoIds(videoIds: unknown): Promise<{ ids: string[] } | { error: string }> {
  if (!Array.isArray(videoIds) || videoIds.length < 1 || videoIds.length > 10) {
    return { error: "A bundle must contain between 1 and 10 videos" };
  }
  const ids = [...new Set(videoIds.map((v) => String(v)))];
  // Basic UUID format validation
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (ids.some((id) => !uuidRe.test(id))) {
    return { error: "Invalid video id in videoIds" };
  }
  const existing = await db.select({ id: videosTable.id }).from(videosTable).where(inArray(videosTable.id, ids));
  if (existing.length !== ids.length) {
    return { error: "One or more selected videos do not exist" };
  }
  return { ids };
}

/** Mark all videos as hidden_bundle + keep bundleExclusive flag in sync. */
async function syncBundleVideoVisibility(videoIds: string[]) {
  if (videoIds.length === 0) return;
  await db.update(videosTable)
    .set({ visibility: "hidden_bundle", bundleExclusive: true, type: "premium", updatedAt: new Date() })
    .where(inArray(videosTable.id, videoIds));
}

/** Clear bundleExclusive / reset visibility for videos no longer in any bundle. */
async function clearStaleBundleExclusive(videoIds: string[]) {
  if (videoIds.length === 0) return;
  const stillLinked = await db
    .select({ videoId: bundleVideosTable.videoId })
    .from(bundleVideosTable)
    .where(inArray(bundleVideosTable.videoId, videoIds));
  const stillLinkedSet = new Set(stillLinked.map((r) => r.videoId));
  const toClear = videoIds.filter((id) => !stillLinkedSet.has(id));
  if (toClear.length > 0) {
    await db.update(videosTable)
      .set({ visibility: "premium", bundleExclusive: false, updatedAt: new Date() })
      .where(inArray(videosTable.id, toClear));
  }
}

// ── GET /bundles — list active bundles (public) ────────────────────────────────
router.get("/bundles", optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const bundles = await db.select().from(bundlesTable)
      .where(and(eq(bundlesTable.isActive, true), isNull(bundlesTable.deletedAt)))
      .orderBy(asc(bundlesTable.sortOrder));
    const formatted = await Promise.all(bundles.map((b) => formatBundle(b, { userId })));
    res.json(formatted);
  } catch (err) {
    logger.error({ err }, "GET /bundles failed");
    res.json([]);
  }
});

// ── GET /bundles/all — all bundles for admin ───────────────────────────────────
router.get("/bundles/all", authenticate, requireRole("admin", "owner"), async (_req, res) => {
  try {
    const bundles = await db.select().from(bundlesTable)
      .where(isNull(bundlesTable.deletedAt))
      .orderBy(asc(bundlesTable.sortOrder));
    const formatted = await Promise.all(bundles.map((b) => formatBundle(b, { includeVideos: true })));
    res.json(formatted);
  } catch (err) {
    logger.error({ err }, "GET /bundles/all failed");
    res.json([]);
  }
});

// ── GET /bundles/my — user's purchased bundles (must be before /:id) ──────────
router.get("/bundles/my", authenticate, async (req, res) => {
  const userId = req.user!.userId;
  try {
    const purchases = await db.select({
      id: bundlePurchasesTable.id,
      bundleId: bundlePurchasesTable.bundleId,
      price: bundlePurchasesTable.price,
      createdAt: bundlePurchasesTable.createdAt,
    }).from(bundlePurchasesTable)
      .where(eq(bundlePurchasesTable.userId, userId));

    const data = await Promise.all(purchases.map(async (p) => {
      const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, p.bundleId)).limit(1);
      return bundle ? { ...p, bundle: await formatBundle(bundle, { includeVideos: true, userId }) } : null;
    }));

    res.json(data.filter(Boolean));
  } catch (err) {
    logger.error({ err }, "GET /bundles/my failed");
    res.json([]);
  }
});

// ── GET /bundles/:id ──────────────────────────────────────────────────────────
router.get("/bundles/:id", optionalAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const [bundle] = await db.select().from(bundlesTable)
      .where(and(eq(bundlesTable.id, id), isNull(bundlesTable.deletedAt))).limit(1);
    if (!bundle) { res.status(404).json({ error: "Not found" }); return; }
    const formatted = await formatBundle(bundle, { includeVideos: true, userId });
    res.json(formatted);
  } catch (err) {
    logger.error({ err }, "GET /bundles/:id failed");
    res.status(500).json({ error: "Failed to load bundle" });
  }
});

// ── POST /bundles — create bundle (admin/owner) ────────────────────────────────
router.post("/bundles", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { title, description, thumbnail, banner, price, originalPrice, badge, sortOrder = 0, videoIds } = req.body;
  if (!title || price == null) {
    res.status(400).json({ error: "title and price are required" }); return;
  }

  let validatedIds: string[] = [];
  if (videoIds) {
    const result = await validateVideoIds(videoIds);
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    validatedIds = result.ids;
  }

  const [bundle] = await db.insert(bundlesTable).values({
    title, description, thumbnail, banner, price, originalPrice, badge, sortOrder, isActive: true,
  }).returning();

  if (validatedIds.length > 0) {
    await db.insert(bundleVideosTable).values(
      validatedIds.map((videoId, i) => ({ bundleId: bundle.id, videoId, sortOrder: i })),
    );
    await syncBundleVideoVisibility(validatedIds);
  }

  res.status(201).json(await formatBundle(bundle, { includeVideos: true }));
});

// ── PATCH /bundles/:id — update bundle (admin/owner) ─────────────────────────
router.patch("/bundles/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const { title, description, thumbnail, banner, price, originalPrice, badge, sortOrder, isActive, videoIds } = req.body;

  const [existing] = await db.select().from(bundlesTable)
    .where(and(eq(bundlesTable.id, id), isNull(bundlesTable.deletedAt))).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updates: any = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (thumbnail !== undefined) updates.thumbnail = thumbnail;
  if (banner !== undefined) updates.banner = banner;
  if (price !== undefined) updates.price = price;
  if (originalPrice !== undefined) updates.originalPrice = originalPrice;
  if (badge !== undefined) updates.badge = badge;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (isActive !== undefined) updates.isActive = isActive;

  const [updated] = await db.update(bundlesTable).set(updates).where(eq(bundlesTable.id, id)).returning();

  if (videoIds !== undefined) {
    const result = await validateVideoIds(videoIds);
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }

    const oldLinks = await db.select({ videoId: bundleVideosTable.videoId })
      .from(bundleVideosTable).where(eq(bundleVideosTable.bundleId, id));
    const oldIds = oldLinks.map((r) => r.videoId);

    await db.delete(bundleVideosTable).where(eq(bundleVideosTable.bundleId, id));
    if (result.ids.length > 0) {
      await db.insert(bundleVideosTable).values(
        result.ids.map((videoId, i) => ({ bundleId: id, videoId, sortOrder: i })),
      );
      await syncBundleVideoVisibility(result.ids);
    }
    // Clear visibility for removed videos
    const removed = oldIds.filter((old) => !result.ids.includes(old));
    await clearStaleBundleExclusive(removed);
  }

  res.json(await formatBundle(updated, { includeVideos: true }));
});

// ── DELETE /bundles/:id (soft delete) ────────────────────────────────────────
router.delete("/bundles/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const id = req.params.id as string;
  const oldLinks = await db.select({ videoId: bundleVideosTable.videoId })
    .from(bundleVideosTable).where(eq(bundleVideosTable.bundleId, id));
  const oldIds = oldLinks.map((r) => r.videoId);

  await db.update(bundlesTable).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(bundlesTable.id, id));
  await clearStaleBundleExclusive(oldIds);
  res.json({ message: "Deleted" });
});

// ── GET /bundles/video/:videoId — find bundle for a video + ownership check ───
router.get("/bundles/video/:videoId", optionalAuth, async (req, res) => {
  const videoId = req.params.videoId as string;
  const userId = req.user?.userId;

  // Guard against non-UUID IDs (Postgres throws on invalid UUID input)
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(videoId)) {
    res.status(404).json({ error: "Video tidak ditemukan" });
    return;
  }

  try {
    // Find which bundle this video belongs to
    const [link] = await db
      .select({ bundleId: bundleVideosTable.bundleId })
      .from(bundleVideosTable)
      .where(eq(bundleVideosTable.videoId, videoId))
      .limit(1);

    if (!link) {
      res.status(404).json({ error: "Video tidak termasuk dalam bundle manapun" });
      return;
    }

    const [bundle] = await db.select().from(bundlesTable)
      .where(and(eq(bundlesTable.id, link.bundleId), isNull(bundlesTable.deletedAt)))
      .limit(1);

    if (!bundle) {
      res.status(404).json({ error: "Bundle tidak ditemukan" });
      return;
    }

    const formatted = await formatBundle(bundle, { includeVideos: true, userId });
    res.json(formatted);
  } catch (err) {
    logger.error({ err, videoId }, "GET /bundles/video/:videoId failed");
    res.status(500).json({ error: "Gagal memuat bundle" });
  }
});

// ── POST /bundles/:id/purchase — buy a bundle ─────────────────────────────────
router.post("/bundles/:id/purchase", authenticate, async (req, res) => {
  const bundleId = req.params.id as string;
  const userId = req.user!.userId;

  const [bundle] = await db.select().from(bundlesTable)
    .where(and(eq(bundlesTable.id, bundleId), eq(bundlesTable.isActive, true), isNull(bundlesTable.deletedAt)))
    .limit(1);
  if (!bundle) { res.status(404).json({ error: "Bundle not found or inactive" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.walletBalance < bundle.price) {
    res.status(400).json({ error: "Insufficient wallet balance" }); return;
  }

  const [existing] = await db.select({ id: bundlePurchasesTable.id })
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

      const [purchase] = await tx.insert(bundlePurchasesTable)
        .values({ userId, bundleId, price }).returning();

      await tx.update(walletsTable).set({
        balance: sql`${walletsTable.balance} - ${price}`,
        totalSpent: sql`${walletsTable.totalSpent} + ${price}`,
        updatedAt: new Date(),
        lastTransactionAt: new Date(),
      }).where(eq(walletsTable.userId, userId));

      await tx.insert(transactionsTable).values({
        userId, type: "purchase", amount: -price,
        description: `Purchased bundle: ${bundle.title}`,
        referenceId: purchase.id,
      });

      await tx.insert(walletTransactionsTable).values({
        userId, type: "purchase", amount: -price,
        balanceAfter: user.walletBalance - price,
        description: `Purchased bundle: ${bundle.title}`,
        referenceType: "bundle",
        referenceId: purchase.id,
      });

      await tx.insert(notificationsTable).values({
        userId, title: "Bundle Purchased",
        message: `You now own the "${bundle.title}" bundle forever.`,
        type: "purchase",
      });

      // ── Revenue share record — bundles are platform-managed (no individual
      // creator), so the platform keeps 100% of the bundle price.
      await tx.insert(revenueSharesTable).values({
        bundlePurchaseId: purchase.id,
        creatorId: null,
        buyerId: userId,
        videoPrice: price,
        creatorShare: 0,
        platformShare: price,
        shareRate: 0,
        creatorRole: "platform",
        payoutStatus: "paid",
        payoutDate: new Date(),
      });

      return { purchase };
    });

    if ("error" in result) {
      res.status(400).json({ error: "Insufficient wallet balance" }); return;
    }

    await invalidateUserCache(userId);

    res.json({ ...result.purchase, bundle: await formatBundle(bundle, { includeVideos: true, userId }) });
  } catch (err: any) {
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "23505") { res.status(400).json({ error: "You already own this bundle" }); return; }
    logger.error({ err, userId, bundleId }, "Bundle purchase failed");
    res.status(500).json({ error: "Purchase failed" });
  }
});


export default router;
