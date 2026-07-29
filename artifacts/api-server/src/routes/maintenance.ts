/**
 * Maintenance Routes
 *
 * GET  /settings/maintenance-status   — Public. Returns { enabled, title, description,
 *                                        image, buttonText, redirectUrl, eta, countdown }
 * PATCH /settings/maintenance         — Owner only. Update maintenance settings + bust cache.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { bustMaintenanceCache } from "../middlewares/maintenance";

const router = Router();

// ── Public: maintenance status (polled by frontend) ───────────────────────────

router.get("/settings/maintenance-status", async (_req, res) => {
  try {
    const [row] = await db
      .select({
        maintenanceEnabled:     settingsTable.maintenanceEnabled,
        maintenanceTitle:       settingsTable.maintenanceTitle,
        maintenanceDescription: settingsTable.maintenanceDescription,
        maintenanceImage:       settingsTable.maintenanceImage,
        maintenanceButtonText:  settingsTable.maintenanceButtonText,
        maintenanceRedirectUrl: settingsTable.maintenanceRedirectUrl,
        maintenanceEta:         settingsTable.maintenanceEta,
        maintenanceCountdown:   settingsTable.maintenanceCountdown,
        siteName:               settingsTable.siteName,
        logo:                   settingsTable.logo,
        discordLink:            settingsTable.discordLink,
        whatsappLink:           settingsTable.whatsappLink,
        telegramLink:           settingsTable.telegramLink,
      })
      .from(settingsTable)
      .limit(1);

    if (!row) {
      res.json({ maintenanceEnabled: false });
      return;
    }

    res.json(row);
  } catch (err: any) {
    // If DB is unavailable treat as not under maintenance
    res.json({ maintenanceEnabled: false, error: err.message });
  }
});

// ── Owner: update maintenance settings ────────────────────────────────────────

router.patch(
  "/settings/maintenance",
  authenticate,
  requireRole("owner"),
  async (req, res) => {
    const {
      maintenanceEnabled,
      maintenanceTitle,
      maintenanceDescription,
      maintenanceImage,
      maintenanceButtonText,
      maintenanceRedirectUrl,
      maintenanceEta,
      maintenanceCountdown,
    } = req.body;

    const updates: Record<string, any> = {
      maintenanceUpdatedAt: new Date(),
      maintenanceUpdatedBy: req.user!.userId,
    };

    if (maintenanceEnabled !== undefined)     updates.maintenanceEnabled     = Boolean(maintenanceEnabled);
    if (maintenanceTitle !== undefined)       updates.maintenanceTitle       = maintenanceTitle || null;
    if (maintenanceDescription !== undefined) updates.maintenanceDescription = maintenanceDescription || null;
    if (maintenanceImage !== undefined)       updates.maintenanceImage       = maintenanceImage || null;
    if (maintenanceButtonText !== undefined)  updates.maintenanceButtonText  = maintenanceButtonText || null;
    if (maintenanceRedirectUrl !== undefined) updates.maintenanceRedirectUrl = maintenanceRedirectUrl || null;
    if (maintenanceEta !== undefined)         updates.maintenanceEta         = maintenanceEta ? new Date(maintenanceEta) : null;
    if (maintenanceCountdown !== undefined)   updates.maintenanceCountdown   = Boolean(maintenanceCountdown);

    try {
      let [existing] = await db.select().from(settingsTable).limit(1);
      let row;
      if (!existing) {
        [row] = await db.insert(settingsTable).values(updates).returning();
      } else {
        [row] = await db.update(settingsTable)
          .set(updates)
          .where(eq(settingsTable.id, existing.id))
          .returning();
      }

      // Immediately invalidate the cache so the new state is served within the
      // next request, not after the 15-second TTL expires.
      await bustMaintenanceCache();

      res.json({
        success: true,
        maintenanceEnabled: row.maintenanceEnabled,
        maintenanceTitle: row.maintenanceTitle,
        maintenanceDescription: row.maintenanceDescription,
        maintenanceImage: row.maintenanceImage,
        maintenanceButtonText: row.maintenanceButtonText,
        maintenanceRedirectUrl: row.maintenanceRedirectUrl,
        maintenanceEta: row.maintenanceEta,
        maintenanceCountdown: row.maintenanceCountdown,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

export default router;
