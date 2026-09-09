/**
 * Frontend API helpers for the AutoUP feature.
 * Uses the same adminFetch pattern as the rest of the admin dashboard.
 */
import { adminFetch } from "./admin-api";

export interface AutoUpConfig {
  id: string;
  name: string;
  telegramSourceId: string;
  isPremium: boolean;
  price: number | null;
  description: string | null;
  enabled: boolean;
  createdBy: string | null;
  lastProcessedAt: string | null;
  processedCount: number;
  failedCount: number;
  lastProcessedMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  source?: {
    id: string;
    name: string;
    chatId: string;
    type: string;
    status: string;
    enabled: boolean;
  } | null;
}

export interface AutoUpStats {
  total: number;
  active: number;
  inactive: number;
  videosSucceeded: number;
  videosFailed: number;
}

export interface AutoUpListResponse {
  configs: AutoUpConfig[];
  stats: AutoUpStats;
}

export interface AutoUpProcessingLog {
  id: string;
  autoupConfigId: string;
  telegramSourceId: string;
  telegramChatId: string | null;
  telegramMessageId: string;
  title: string | null;
  thumbnail: string | null;
  status: "pending" | "processing" | "completed" | "failed" | "skipped";
  errorMessage: string | null;
  videoId: string | null;
  telegramVideoId: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface AutoUpSource {
  id: string;
  name: string;
  chatId: string;
  type: string;
  status: string;
  enabled: boolean;
  videoCount: number;
}

export const autoupApi = {
  list: () => adminFetch<AutoUpListResponse>("/admin/autoup"),
  create: (body: {
    name: string;
    telegramSourceId: string;
    isPremium: boolean;
    price?: number;
    description?: string;
    enabled?: boolean;
  }) => adminFetch<AutoUpConfig>("/admin/autoup", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{
    name: string;
    telegramSourceId: string;
    isPremium: boolean;
    price: number;
    description: string;
    enabled: boolean;
  }>) => adminFetch<AutoUpConfig>(`/admin/autoup/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  toggle: (id: string) => adminFetch<{ enabled: boolean }>(`/admin/autoup/${id}/toggle`, { method: "POST" }),
  delete: (id: string) => adminFetch<{ message: string }>(`/admin/autoup/${id}`, { method: "DELETE" }),
  logs: (id: string, status?: string) =>
    adminFetch<AutoUpProcessingLog[]>(`/admin/autoup/${id}/logs${status ? `?status=${status}` : ""}`),
  sources: () => adminFetch<AutoUpSource[]>("/admin/autoup/sources"),
};
