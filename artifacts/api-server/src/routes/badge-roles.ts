/**
 * Badge / Custom Role Management Routes
 *
 * All mutations are owner-only; GET list/detail is admin+owner.
 *
 * Routes
 *  GET    /admin/badge-roles               — list all custom roles
 *  POST   /admin/badge-roles               — create a new role
 *  GET    /admin/badge-roles/:id           — get single role + assigned users
 *  PUT    /admin/badge-roles/:id           — update role
 *  DELETE /admin/badge-roles/:id           — delete role
 *  POST   /admin/badge-roles/:id/assign    — assign role to a user
 *  DELETE /admin/badge-roles/:id/users/:userId — revoke role from a user
 *  GET    /admin/badge-roles/:id/users     — list users with this role
 *  GET    /users/me/custom-roles           — current user's custom roles
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { customRolesTable, userCustomRolesTable, usersTable } from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { authenticate, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

// ── Helper: parse upload_types string to array ───────────────────────────────
function parseUploadTypes(s: string | null | undefined): string[] {
  if (!s) return ["free"];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function serializeUploadTypes(arr: string[]): string {
  return arr.join(",");
}

// ── GET /admin/badge-roles ───────────────────────────────────────────────────
router.get(
  "/admin/badge-roles",
  authenticate,
  requireRole("admin", "owner"),
  async (req, res) => {
    try {
      const roles = await db
        .select()
        .from(customRolesTable)
        .orderBy(desc(customRolesTable.priority), asc(customRolesTable.name));

      const result = roles.map((r) => ({
        ...r,
        uploadTypes: parseUploadTypes(r.uploadTypes),
      }));
      res.json(result);
    } catch (err: any) {
      logger.error("GET /admin/badge-roles", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── POST /admin/badge-roles ──────────────────────────────────────────────────
router.post(
  "/admin/badge-roles",
  authenticate,
  requireRole("owner"),
  async (req, res) => {
    try {
      const {
        name, emoji, color, description, isActive, priority,
        permDashboard, permUploadVideo, permMyVideo, permLeaderboard, permCreatorDashboard,
        uploadTypes, creatorSharePercent,
      } = req.body as any;

      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const creatorPct = Math.min(100, Math.max(0, Number(creatorSharePercent ?? 50)));
      const platformPct = 100 - creatorPct;

      const [role] = await db.insert(customRolesTable).values({
        name: name.trim(),
        emoji: emoji ?? null,
        color: color ?? "#6366f1",
        description: description ?? null,
        isActive: isActive !== false,
        priority: Number(priority ?? 0),
        permDashboard: Boolean(permDashboard),
        permUploadVideo: Boolean(permUploadVideo),
        permMyVideo: Boolean(permMyVideo),
        permLeaderboard: permLeaderboard !== false,
        permCreatorDashboard: Boolean(permCreatorDashboard),
        uploadTypes: serializeUploadTypes(Array.isArray(uploadTypes) ? uploadTypes : ["free"]),
        creatorSharePercent: creatorPct,
        platformSharePercent: platformPct,
        createdBy: req.user!.userId,
      }).returning();

      res.status(201).json({ ...role, uploadTypes: parseUploadTypes(role.uploadTypes) });
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        res.status(409).json({ error: "Role name already exists" });
        return;
      }
      logger.error("POST /admin/badge-roles", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /admin/badge-roles/:id ───────────────────────────────────────────────
router.get(
  "/admin/badge-roles/:id",
  authenticate,
  requireRole("admin", "owner"),
  async (req, res) => {
    try {
      const [role] = await db
        .select()
        .from(customRolesTable)
        .where(eq(customRolesTable.id, req.params.id))
        .limit(1);

      if (!role) { res.status(404).json({ error: "Role not found" }); return; }

      // Count assigned users
      const assignments = await db
        .select({ userId: userCustomRolesTable.userId })
        .from(userCustomRolesTable)
        .where(eq(userCustomRolesTable.roleId, role.id));

      res.json({
        ...role,
        uploadTypes: parseUploadTypes(role.uploadTypes),
        assignedUserCount: assignments.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ── PUT /admin/badge-roles/:id ───────────────────────────────────────────────
router.put(
  "/admin/badge-roles/:id",
  authenticate,
  requireRole("owner"),
  async (req, res) => {
    try {
      const {
        name, emoji, color, description, isActive, priority,
        permDashboard, permUploadVideo, permMyVideo, permLeaderboard, permCreatorDashboard,
        uploadTypes, creatorSharePercent,
      } = req.body as any;

      const creatorPct = Math.min(100, Math.max(0, Number(creatorSharePercent ?? 50)));

      const [updated] = await db
        .update(customRolesTable)
        .set({
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(emoji !== undefined ? { emoji } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
          ...(priority !== undefined ? { priority: Number(priority) } : {}),
          ...(permDashboard !== undefined ? { permDashboard: Boolean(permDashboard) } : {}),
          ...(permUploadVideo !== undefined ? { permUploadVideo: Boolean(permUploadVideo) } : {}),
          ...(permMyVideo !== undefined ? { permMyVideo: Boolean(permMyVideo) } : {}),
          ...(permLeaderboard !== undefined ? { permLeaderboard: Boolean(permLeaderboard) } : {}),
          ...(permCreatorDashboard !== undefined ? { permCreatorDashboard: Boolean(permCreatorDashboard) } : {}),
          ...(uploadTypes !== undefined ? { uploadTypes: serializeUploadTypes(uploadTypes) } : {}),
          ...(creatorSharePercent !== undefined ? {
            creatorSharePercent: creatorPct,
            platformSharePercent: 100 - creatorPct,
          } : {}),
          updatedAt: new Date(),
        })
        .where(eq(customRolesTable.id, req.params.id))
        .returning();

      if (!updated) { res.status(404).json({ error: "Role not found" }); return; }
      res.json({ ...updated, uploadTypes: parseUploadTypes(updated.uploadTypes) });
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        res.status(409).json({ error: "Role name already exists" });
        return;
      }
      logger.error("PUT /admin/badge-roles/:id", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── DELETE /admin/badge-roles/:id ────────────────────────────────────────────
router.delete(
  "/admin/badge-roles/:id",
  authenticate,
  requireRole("owner"),
  async (req, res) => {
    try {
      await db.delete(customRolesTable).where(eq(customRolesTable.id, req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /admin/badge-roles/:id/users ─────────────────────────────────────────
router.get(
  "/admin/badge-roles/:id/users",
  authenticate,
  requireRole("admin", "owner"),
  async (req, res) => {
    try {
      const rows = await db
        .select({
          assignmentId: userCustomRolesTable.id,
          assignedAt:   userCustomRolesTable.assignedAt,
          userId:   usersTable.id,
          username: usersTable.username,
          displayName: usersTable.displayName,
          avatar:   usersTable.avatar,
          role:     usersTable.role,
        })
        .from(userCustomRolesTable)
        .innerJoin(usersTable, eq(userCustomRolesTable.userId, usersTable.id))
        .where(eq(userCustomRolesTable.roleId, req.params.id))
        .orderBy(desc(userCustomRolesTable.assignedAt));

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ── POST /admin/badge-roles/:id/assign ───────────────────────────────────────
router.post(
  "/admin/badge-roles/:id/assign",
  authenticate,
  requireRole("owner"),
  async (req, res) => {
    try {
      const { userId } = req.body as { userId: string };
      if (!userId) { res.status(400).json({ error: "userId is required" }); return; }

      const [user] = await db.select({ id: usersTable.id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }

      // Idempotent: skip if already assigned
      const [existing] = await db.select({ id: userCustomRolesTable.id })
        .from(userCustomRolesTable)
        .where(and(
          eq(userCustomRolesTable.userId, userId),
          eq(userCustomRolesTable.roleId, req.params.id),
        )).limit(1);

      if (existing) { res.json({ ok: true, alreadyAssigned: true }); return; }

      const [assignment] = await db.insert(userCustomRolesTable).values({
        userId,
        roleId: req.params.id,
        assignedBy: req.user!.userId,
      }).returning();

      res.status(201).json(assignment);
    } catch (err: any) {
      logger.error("POST /admin/badge-roles/:id/assign", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── DELETE /admin/badge-roles/:id/users/:userId ───────────────────────────────
router.delete(
  "/admin/badge-roles/:id/users/:userId",
  authenticate,
  requireRole("owner"),
  async (req, res) => {
    try {
      await db.delete(userCustomRolesTable).where(
        and(
          eq(userCustomRolesTable.roleId, req.params.id),
          eq(userCustomRolesTable.userId, req.params.userId),
        ),
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /users/me/custom-roles ────────────────────────────────────────────────
// Returns active custom roles for the authenticated user (used by frontend gates).
router.get(
  "/users/me/custom-roles",
  authenticate,
  async (req, res) => {
    try {
      const rows = await db
        .select({ role: customRolesTable })
        .from(userCustomRolesTable)
        .innerJoin(customRolesTable, eq(userCustomRolesTable.roleId, customRolesTable.id))
        .where(
          and(
            eq(userCustomRolesTable.userId, req.user!.userId),
            eq(customRolesTable.isActive, true),
          ),
        )
        .orderBy(desc(customRolesTable.priority));

      const result = rows.map((r) => ({
        ...r.role,
        uploadTypes: parseUploadTypes(r.role.uploadTypes),
      }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

export default router;
