import {
  pgTable, uuid, text, integer, boolean, timestamp,
  doublePrecision, pgEnum, index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { categoriesTable } from "./categories";

/** Legacy type enum – kept for API compat; derived from visibility on write. */
export const videoTypeEnum = pgEnum("video_type", ["free", "premium"]);

/**
 * Primary visibility control:
 *  - public       → free, visible everywhere
 *  - premium      → requires active subscription or individual purchase
 *  - hidden_bundle → never appears in any listing; accessible only via bundle purchase
 */
export const videoVisibilityEnum = pgEnum("video_visibility", ["public", "premium", "hidden_bundle"]);

export const videosTable = pgTable(
  "videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    thumbnail: text("thumbnail"),
    videoUrl: text("video_url").notNull(),
    /** @deprecated use visibility instead; kept for API compat */
    type: videoTypeEnum("type").notNull().default("free"),
    price: doublePrecision("price"),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    downloadable: boolean("downloadable").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    /**
     * Primary visibility flag. Supersedes type + bundleExclusive.
     * Use this for all filtering in queries.
     */
    visibility: videoVisibilityEnum("visibility").notNull().default("public"),
    /** @deprecated use visibility === "hidden_bundle" instead; kept for compat */
    bundleExclusive: boolean("bundle_exclusive").notNull().default(false),
    // CMS fields
    status: text("status").notNull().default("published"), // draft | published | hidden | scheduled
    tags: text("tags"),           // JSON array string
    duration: integer("duration"), // seconds
    scheduledAt: timestamp("scheduled_at"),
    /**
     * Where the video content lives:
     *  - "upload"        → file uploaded to Supabase storage; videoUrl = public CDN URL
     *  - "external_link" → YouTube / Vimeo / Drive / MP4 / M3U8 link
     */
    videoSourceType: text("video_source_type").notNull().default("upload"),
    /** Supabase storage path for uploaded files (e.g. videos/abc.mp4). Null for external links. */
    videoFilePath: text("video_file_path"),
    /**
     * Multi-storage metadata — set at upload time, stored for auditing & path resolution.
     *  uploaderType   → "creator" | "verified_creator" | "owner"
     *  thumbnailPath  → Supabase storage path for the thumbnail file
     *  storageFolder  → sub-folder used inside the bucket (e.g. "creator/videos")
     *  bucketName     → Supabase bucket name (always "yzx" currently)
     */
    uploaderType:  text("uploader_type"),
    thumbnailPath: text("thumbnail_path"),
    storageFolder: text("storage_folder"),
    bucketName:    text("bucket_name"),
    /**
     * Multi-storage provider tracking (set at upload time):
     *  - "supabase_creator"          → Supabase Project 1 (Creator badge)
     *  - "supabase_verified_creator" → Supabase Project 2 (Verified Creator badge)
     *  - "bunny_stream"              → Bunny Stream CDN   (Owner badge)
     *  - null                        → legacy single-Supabase upload
     */
    videoStorageProvider: text("video_storage_provider"),
    /** Bunny Stream video GUID — set when videoStorageProvider = "bunny_stream" */
    bunnyVideoId:    text("bunny_video_id"),
    /** Bunny Stream embed player URL — for display in an <iframe> */
    bunnyPlaybackUrl: text("bunny_playback_url"),
    /** Bunny Stream library ID — for constructing API calls and URLs */
    bunnyLibraryId:  text("bunny_library_id"),
    /**
     * High-level storage destination (set at upload time):
     *  - "PUBLIC" → Creator or Verified Creator upload → PUBLIC Supabase project
     *  - "OWNER"  → Owner/Admin upload → OWNER Supabase project
     *  - null     → legacy upload (pre-migration rows)
     */
    storageType: text("storage_type"),
    categoryId: uuid("category_id").references(() => categoriesTable.id, { onDelete: "set null" }),
    creatorId: uuid("creator_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    creatorIdx:   index("videos_creator_id_idx").on(t.creatorId),
    categoryIdx:  index("videos_category_id_idx").on(t.categoryId),
    visibilityIdx: index("videos_visibility_idx").on(t.visibility),
    statusIdx:    index("videos_status_idx").on(t.status),
    createdAtIdx: index("videos_created_at_idx").on(t.createdAt),
    deletedAtIdx: index("videos_deleted_at_idx").on(t.deletedAt),
  }),
);

export const insertVideoSchema = createInsertSchema(videosTable).omit({
  id: true, createdAt: true, updatedAt: true, views: true, likes: true, deletedAt: true,
});
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
export type VideoVisibility = "public" | "premium" | "hidden_bundle";

/** Derive the legacy type/bundleExclusive pair from a visibility value. */
export function visibilityToLegacy(visibility: VideoVisibility) {
  return {
    type: visibility === "public" ? ("free" as const) : ("premium" as const),
    bundleExclusive: visibility === "hidden_bundle",
  };
}

/** Derive visibility from legacy type + bundleExclusive fields. */
export function legacyToVisibility(type: "free" | "premium", bundleExclusive: boolean): VideoVisibility {
  if (bundleExclusive) return "hidden_bundle";
  if (type === "premium") return "premium";
  return "public";
}
