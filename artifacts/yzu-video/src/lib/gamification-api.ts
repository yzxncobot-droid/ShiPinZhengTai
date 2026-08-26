/**
 * Gamification API client — fetches level, EXP, achievements, badges,
 * statistics, and privacy settings from the backend.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const TOKEN_KEY = "funplus_token";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LevelBadgeInfo {
  name: string;
  icon: string;
  color: string;
  minLevel: number;
}

export interface DisplayBadge {
  type: "level" | "special" | "achievement";
  icon: string;
  name: string;
  color: string;
}

export interface UserBadgeInfo {
  userId: string;
  level: number;
  levelBadge: LevelBadgeInfo;
  displayBadges: DisplayBadge[];
}

export interface GamificationProfile {
  level: number;
  totalExp: number;
  currentLevelExp: number;
  nextLevelExp: number;
  expToday: number;
  lifetimeExp: number;
  streakDays: number;
  lastExpActivity: string | null;
  levelBadge: LevelBadgeInfo;
  statistics: {
    videosWatched: number;
    videosLiked: number;
    commentsPosted: number;
    messagesSent: number;
    groupsJoined: number;
    videosUploaded: number;
  };
  showcaseBadges: any[];
  specialBadges: any[];
  achievements: any[];
  achievementCount: number;
  privacy: {
    showLevel: boolean;
    showBadges: boolean;
    showAchievements: boolean;
    showTotalVideo: boolean;
    showChatCount: boolean;
    showActivityStats: boolean;
  };
}

export interface AchievementWithProgress {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "SPECIAL";
  requirementType: string;
  requirementValue: number;
  expReward: number;
  badgeReward: string | null;
  isHidden: boolean;
  isActive: boolean;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  progressPercent: number;
}

// ─── Hooks ─────────────────────────────────────────────────────────────────────

export function useGamificationProfile() {
  return useQuery({
    queryKey: ["gamification", "me"],
    queryFn: () => apiFetch<GamificationProfile>("/gamification/me"),
    staleTime: 30_000,
  });
}

export function useUserBadgeInfo(userId: string | undefined | null) {
  return useQuery({
    queryKey: ["gamification", "badge-info", userId],
    queryFn: () => apiFetch<UserBadgeInfo>(`/gamification/badge-info/${userId}`),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

export function usePublicGamification(userId: string | undefined | null) {
  return useQuery({
    queryKey: ["gamification", "public", userId],
    queryFn: () => apiFetch<any>(`/gamification/public/${userId}`),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

export function useAchievements() {
  return useQuery({
    queryKey: ["gamification", "achievements"],
    queryFn: () => apiFetch<{ achievements: AchievementWithProgress[]; totalCount: number; unlockedCount: number }>("/gamification/achievements"),
    staleTime: 60_000,
  });
}

export function useSpecialBadges() {
  return useQuery({
    queryKey: ["gamification", "badges"],
    queryFn: () => apiFetch<any[]>("/gamification/badges"),
    staleTime: 120_000,
  });
}

export function useShowcaseBadges() {
  return useQuery({
    queryKey: ["gamification", "showcase"],
    queryFn: () => apiFetch<any[]>("/gamification/showcase"),
    staleTime: 60_000,
  });
}

export function useUpdateShowcase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (badges: Array<{ badgeType: string; badgeRef: string | null }>) =>
      apiFetch("/gamification/showcase", {
        method: "PUT",
        body: JSON.stringify({ badges }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gamification", "showcase"] });
      qc.invalidateQueries({ queryKey: ["gamification", "me"] });
      qc.invalidateQueries({ queryKey: ["gamification", "badge-info"] });
    },
  });
}

export function usePrivacySettings() {
  return useQuery({
    queryKey: ["gamification", "privacy"],
    queryFn: () => apiFetch<any>("/gamification/privacy"),
    staleTime: 60_000,
  });
}

export function useUpdatePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: any) =>
      apiFetch("/gamification/privacy", {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gamification", "privacy"] });
    },
  });
}

export function useExpHistory(limit = 50) {
  return useQuery({
    queryKey: ["gamification", "exp-history", limit],
    queryFn: () => apiFetch<any[]>(`/gamification/exp-history?limit=${limit}`),
    staleTime: 30_000,
  });
}

export function useLevelInfo() {
  return useQuery({
    queryKey: ["gamification", "level-info"],
    queryFn: () => apiFetch<any>("/gamification/level-info"),
    staleTime: 30_000,
  });
}
