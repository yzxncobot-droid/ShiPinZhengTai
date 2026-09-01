/**
 * Frontend API helpers for the Telegram Video Storage module.
 * Uses the same adminFetch pattern as the rest of the admin dashboard.
 */
import { getToken } from "./admin-api";

export interface TelegramSource {
  id: string;
  name: string;
  chatId: string;
  type: "GROUP" | "CHANNEL";
  description: string | null;
  enabled: boolean;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR" | "SYNCING" | "UNKNOWN";
  lastConnectionCheck: string | null;
  lastSyncAt: string | null;
  videoCount: number;
  errorMessage: string | null;
  lastSyncedMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramVideo {
  id: string;
  telegramSourceId: string;
  title: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  telegramDate: string | null;
  isPremium: boolean;
  price: number | null;
  sourceName?: string;
  hasAccess?: boolean;
}

export interface TelegramHealth {
  sources: {
    total: number;
    connected: number;
    disconnected: number;
    error: number;
    syncing: number;
  };
  totalVideos: number;
  components: {
    telegramApi: string;
    database: string;
    indexer: string;
    streaming: string;
  };
}

export interface SyncResult {
  message: string;
  syncType: string;
  newVideos?: number;
  updatedVideos?: number;
  skippedVideos?: number;
  errorsCount?: number;
  totalVideos?: number;
}

async function tgFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Error ${res.status}`);
  return data as T;
}

// ── Admin source management ──────────────────────────────────────────────────

export const tgApi = {
  listSources: () => tgFetch<TelegramSource[]>("/admin/telegram/sources"),
  createSource: (body: Partial<TelegramSource>) =>
    tgFetch<TelegramSource>("/admin/telegram/sources", { method: "POST", body: JSON.stringify(body) }),
  updateSource: (id: string, body: Partial<TelegramSource>) =>
    tgFetch<TelegramSource>(`/admin/telegram/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSource: (id: string) =>
    tgFetch<{ message: string }>(`/admin/telegram/sources/${id}`, { method: "DELETE" }),
  testConnection: (id: string) =>
    tgFetch<{ success: boolean; title?: string; type?: string; errorMessage?: string }>(
      `/admin/telegram/sources/${id}/test`, { method: "POST" },
    ),
  syncSource: (id: string, wait = false) =>
    tgFetch<SyncResult>(`/admin/telegram/sources/${id}/sync${wait ? "?wait=true" : ""}`, { method: "POST" }),
  getLogs: (id: string) =>
    tgFetch<any[]>(`/admin/telegram/sources/${id}/logs`),
  getHealth: () => tgFetch<TelegramHealth>("/admin/telegram/health"),

  // ── Public video catalog ──────────────────────────────────────────────────
  listVideos: (params?: { page?: number; limit?: number; sourceId?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.sourceId) qs.set("sourceId", params.sourceId);
    if (params?.search) qs.set("search", params.search);
    return tgFetch<{ data: TelegramVideo[]; total: number; page: number; limit: number }>(
      `/telegram-videos?${qs}`,
    );
  },
  listVideoSources: () =>
    tgFetch<{ id: string; name: string; type: string; videoCount: number }[]>("/telegram-videos/sources"),
  getVideo: (id: string) => tgFetch<TelegramVideo>(`/telegram-videos/${id}`),
  streamUrl: (id: string) => `/api/telegram-videos/${id}/stream`,
  updateVideo: (id: string, body: { isPremium?: boolean; price?: number }) =>
    tgFetch<TelegramVideo>(`/admin/telegram/videos/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
};

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
