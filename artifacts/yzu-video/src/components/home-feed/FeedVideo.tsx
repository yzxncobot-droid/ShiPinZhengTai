import { useRef, useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Star, Heart, MessageCircle, Volume2, VolumeX } from "lucide-react";
import type { HomeFeedVideoItem } from "@/lib/home-feed-api";
import { toggleHomeFeedLike } from "@/lib/home-feed-api";
import { useAuth } from "@/lib/auth";
import { RewardModal } from "./RewardModal";
import { CommentSheet } from "./CommentSheet";

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

interface FeedVideoProps {
  video: HomeFeedVideoItem;
  /** true when this slide is the currently centered one */
  isActive: boolean;
  /** true when this slide is close enough to preload (active ± 1) */
  preload: boolean;
  /** notify parent when like/comment counts change (for re-fetch) */
  onStatsChange?: () => void;
}

export function FeedVideo({ video, isActive, preload, onStatsChange }: FeedVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(video.isLiked);
  const [likeCount, setLikeCount] = useState(video.likeCount);
  const [commentCount, setCommentCount] = useState(video.commentCount);
  const [reward, setReward] = useState(video.reward);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

  // Sync from server data when the video identity or stats change
  useEffect(() => {
    setLiked(video.isLiked);
    setLikeCount(video.likeCount);
    setCommentCount(video.commentCount);
    setReward(video.reward);
  }, [video.id, video.isLiked, video.likeCount, video.commentCount, video.reward]);

  // Autoplay / pause based on active state
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isActive) {
      el.currentTime = 0;
      el.play().catch(() => {/* autoplay may be blocked until interaction */});
    } else {
      el.pause();
    }
  }, [isActive]);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const next = !muted;
    el.muted = next;
    setMuted(next);
    // Unmuted play requires user gesture — this click counts
    if (next && isActive) el.play().catch(() => {});
  }, [muted, isActive]);

  async function handleLike() {
    if (!user) { setLocation("/login"); return; }
    if (likeBusy) return;
    setLikeBusy(true);
    // Optimistic update
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => c + (wasLiked ? -1 : 1));
    try {
      const res = await toggleHomeFeedLike(video.id);
      setLiked(res.liked);
      // Recompute reward progress locally for LIKE-type rewards
      if (reward.rewardType === "LIKE") {
        const newTotal = res.liked ? likeCount + 1 : likeCount - 1;
        const target = reward.target;
        const progress = target > 0 ? Math.min(Math.round((newTotal / target) * 100), 100) : 0;
        setReward((r) => ({ ...r, total: newTotal, progress, isUnlocked: target > 0 && newTotal >= target }));
      }
      onStatsChange?.();
    } catch {
      // Revert on failure
      setLiked(wasLiked);
      setLikeCount((c) => c + (wasLiked ? 1 : -1));
    } finally {
      setLikeBusy(false);
    }
  }

  function handleRewardClick() {
    if (!user) { setLocation("/login"); return; }
    setRewardOpen(true);
  }

  function handleRewardClaimed() {
    // Reward unlocked — refresh stats from server
    onStatsChange?.();
  }

  function handleCommented() {
    setCommentCount((c) => c + 1);
    if (reward.rewardType === "COMMENT") {
      const newTotal = commentCount + 1;
      const target = reward.target;
      const progress = target > 0 ? Math.min(Math.round((newTotal / target) * 100), 100) : 0;
      setReward((r) => ({ ...r, total: newTotal, progress, isUnlocked: target > 0 && newTotal >= target }));
    }
    onStatsChange?.();
  }

  const showReward = reward.rewardType !== "NONE" && reward.target > 0;

  return (
    <section
      className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden bg-slate-100"
    >
      {/* Video / placeholder */}
      {preload ? (
        <video
          ref={videoRef}
          src={video.videoUrl}
          poster={video.thumbnail ?? undefined}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          loop
          muted={muted}
          preload={isActive ? "auto" : "metadata"}
        />
      ) : (
        <div
          className="absolute inset-0 h-full w-full bg-cover bg-center"
          style={{ backgroundImage: video.thumbnail ? `url(${video.thumbnail})` : undefined, backgroundColor: "#1a1030" }}
        />
      )}

      {/* Gradient overlay for readability (bottom) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      {/* Top gradient for header legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />

      {/* Mute toggle (top-left under header) */}
      <button
        onClick={toggleMute}
        className="absolute top-20 left-4 z-20 h-9 w-9 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white"
        aria-label={muted ? "Bunyikan" : "Bisukan"}
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      {/* ── Right action stack ── */}
      <div className="absolute right-3 bottom-32 z-20 flex flex-col items-center gap-5">
        {/* Reward */}
        {showReward && (
          <button onClick={handleRewardClick} className="flex flex-col items-center gap-1">
            <motion.div
              whileTap={{ scale: 0.85 }}
              className={`h-12 w-12 rounded-full flex items-center justify-center shadow-lg ${
                reward.isUnlocked
                  ? "bg-gradient-to-br from-yellow-400 to-orange-400"
                  : "bg-black/50 backdrop-blur"
              }`}
            >
              <Star
                className={`h-6 w-6 ${reward.isUnlocked ? "text-white" : "text-yellow-300"}`}
                fill="currentColor"
              />
            </motion.div>
            <span className="text-xs font-extrabold text-white drop-shadow">{reward.progress}%</span>
          </button>
        )}

        {/* Like */}
        <button onClick={handleLike} className="flex flex-col items-center gap-1">
          <motion.div whileTap={{ scale: 0.85 }} className="h-12 w-12 rounded-full bg-black/50 backdrop-blur flex items-center justify-center shadow-lg">
            <Heart
              className={`h-6 w-6 ${liked ? "text-red-500" : "text-white"}`}
              fill={liked ? "currentColor" : "none"}
            />
          </motion.div>
          <span className="text-xs font-extrabold text-white drop-shadow">{formatCount(likeCount)}</span>
        </button>

        {/* Comment */}
        <button onClick={() => setCommentOpen(true)} className="flex flex-col items-center gap-1">
          <motion.div whileTap={{ scale: 0.85 }} className="h-12 w-12 rounded-full bg-black/50 backdrop-blur flex items-center justify-center shadow-lg">
            <MessageCircle className="h-6 w-6 text-white" />
          </motion.div>
          <span className="text-xs font-extrabold text-white drop-shadow">{formatCount(commentCount)}</span>
        </button>
      </div>

      {/* ── Title & description (bottom-left) ── */}
      <div className="absolute left-4 right-20 bottom-28 z-20">
        <h2 className="text-lg font-extrabold text-white leading-tight drop-shadow line-clamp-2">
          {video.title}
        </h2>
        {video.description && (
          <p className="mt-1 text-sm text-white/85 line-clamp-2 drop-shadow">{video.description}</p>
        )}
      </div>

      {/* Reward modal */}
      <RewardModal
        open={rewardOpen}
        onClose={() => setRewardOpen(false)}
        videoId={video.id}
        reward={reward}
        onClaimed={handleRewardClaimed}
      />

      {/* Comment sheet */}
      <CommentSheet
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
        videoId={video.id}
        count={commentCount}
        onCommented={handleCommented}
      />
    </section>
  );
}
