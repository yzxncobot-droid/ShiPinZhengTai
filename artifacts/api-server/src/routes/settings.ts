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

router.patch("/settings", authenticate, requireRole("owner"), async (req, res) => {
  const { siteName, siteDescription, logo, favicon, banner, qrisImage, whatsappLink, chatLogo, faq, footerText } = req.body;
  const [existing] = await db.select().from(settingsTable).limit(1);
  if (!existing) {
    const [created] = await db.insert(settingsTable).values({ siteName, siteDescription, logo, favicon, banner, qrisImage, whatsappLink, chatLogo, faq, footerText }).returning();
    res.json(created);
    return;
  }
  const [updated] = await db.update(settingsTable).set({
    siteName: siteName ?? existing.siteName,
    siteDescription: siteDescription ?? existing.siteDescription,
    logo: logo ?? existing.logo,
    favicon: favicon ?? existing.favicon,
    banner: banner ?? existing.banner,
    qrisImage: qrisImage ?? existing.qrisImage,
    whatsappLink: whatsappLink ?? existing.whatsappLink,
    chatLogo: chatLogo ?? existing.chatLogo,
    faq: faq ?? existing.faq,
    footerText: footerText ?? existing.footerText,
  }).where(eq(settingsTable.id, existing.id)).returning();
  res.json(updated);
});

export default router;
