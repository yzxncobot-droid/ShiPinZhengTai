import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";

const router = Router();

router.get("/settings", async (_req, res) => {
  const [s] = await db.select().from(settingsTable).limit(1);
  if (!s) {
    // Create defaults
    const [created] = await db.insert(settingsTable).values({}).returning();
    res.json(created);
    return;
  }
  res.json(s);
});

const SETTINGS_FIELDS = [
  "siteName", "tagline", "siteDescription", "logo", "favicon", "banner", "qrisImage",
  "whatsappLink", "telegramLink", "discordLink", "instagramLink", "facebookLink",
  "youtubeLink", "tiktokLink", "chatLogo", "faq", "footerText",
  "metaTitle", "googleAnalyticsId", "googleSearchConsoleId",
] as const;

router.patch("/settings", authenticate, requireRole("owner"), async (req, res) => {
  const body: Record<string, any> = {};
  for (const field of SETTINGS_FIELDS) {
    if (req.body[field] !== undefined) body[field] = req.body[field];
  }
  const [existing] = await db.select().from(settingsTable).limit(1);
  if (!existing) {
    const [created] = await db.insert(settingsTable).values(body).returning();
    res.json(created);
    return;
  }
  const [updated] = await db.update(settingsTable).set(body).where(eq(settingsTable.id, existing.id)).returning();
  res.json(updated);
});

export default router;
