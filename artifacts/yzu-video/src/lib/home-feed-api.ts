import { adminFetch } from "./admin-api";

export type HomeFeedRewardType = "LIKE" | "COMMENT" | "NONE";

export interface HomeFeedReward {
  rewardType: HomeFeedRewardType;
  target: number;
  total: number;
  progress: number;
  isUnlocked: boolean;
}

export interface HomeFeedVideoItem {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
  thumbnail: string | null;
  status: string;
  isActive: boolean;
  sortOrder: number;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  reward: HomeFeedReward;
  createdAt: string;
}

export interface HomeFeedComment {
  id: string;
  videoId: string;
  userId: string;
  content: string;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null } | null;
}

export interface RewardClaimResult {
  unlocked: boolean;
  rewardType: HomeFeedRewardType;
  total: number;
  target: number;
  progress: number;
  rewardCode?: string;
}

/** Fetch the public home feed (active videos, ordered by sort_order). */
export function fetchHomeFeed(): Promise<HomeFeedVideoItem[]> {
  return adminFetch<HomeFeedVideoItem[]>("/home-feed");
}

/** Toggle like on a home feed video. Returns the new liked state. */
export function toggleHomeFeedLike(videoId: string): Promise<{ liked: boolean }> {
  return adminFetch<{ liked: boolean }>(`/home-feed/${videoId}/like`, { method: "POST" });
}

/** Fetch comments for a home feed video. */
export function fetchHomeFeedComments(videoId: string): Promise<HomeFeedComment[]> {
  return adminFetch<HomeFeedComment[]>(`/home-feed/${videoId}/comments`);
}

/** Post a comment on a home feed video. */
export function postHomeFeedComment(videoId: string, content: string): Promise<HomeFeedComment> {
  return adminFetch<HomeFeedComment>(`/home-feed/${videoId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

/**
 * Claim the reward for a home feed video.
 * The backend re-validates the target before returning the code.
 */
export function claimHomeFeedReward(videoId: string): Promise<RewardClaimResult> {
  return adminFetch<RewardClaimResult>(`/home-feed/${videoId}/reward`, { method: "POST" });
}
