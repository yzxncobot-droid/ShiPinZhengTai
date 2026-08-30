/**
 * MiniProfileCard — compact popup showing a user's level, EXP progress,
 * badge showcase, and achievement count. Opens when a badge/avatar/username
 * is clicked in chat, comments, video, or leaderboard.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { usePublicGamification } from "@/lib/gamification-api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from "lucide-react";

interface MiniProfileCardProps {
  userId: string;
  username?: string;
  avatar?: string | null;
  onClose: () => void;
}

export function MiniProfileCard({ userId, username, avatar, onClose }: MiniProfileCardProps) {
  const { data: gamification, isLoading } = usePublicGamification(userId);
  const [, navigate] = useLocation();

  return (
    <div
      className="absolute z-50 top-full left-0 mt-1 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
        </div>
      ) : (
        <>
          {/* Header with gradient */}
          <div
            className="px-4 py-3 bg-gradient-to-br from-purple-500 to-pink-500 relative"
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border-2 border-white shrink-0">
                <AvatarImage src={avatar || ""} />
                <AvatarFallback className="bg-white/30 text-white font-bold">
                  {username?.charAt(0)?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-bold text-white text-sm truncate">{username || "User"}</p>
                {gamification?.levelBadge && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-xs">{gamification.levelBadge.icon}</span>
                    <span className="text-[10px] text-white/90 font-semibold">
                      {gamification.levelBadge.name} · Lv.{gamification?.level ?? 1}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* EXP Progress */}
          {gamification?.level != null && gamification?.nextLevelExp != null && (
            <div className="px-4 py-2.5 border-b border-slate-50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase">EXP</span>
                <span className="text-[10px] font-bold text-slate-600">
                  {gamification.currentLevelExp ?? 0} / {gamification.nextLevelExp}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, ((gamification.currentLevelExp ?? 0) / (gamification.nextLevelExp || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Badge showcase */}
          {gamification?.displayBadges && gamification.displayBadges.length > 0 && (
            <div className="px-4 py-2.5 border-b border-slate-50">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Badge</p>
              <div className="flex gap-1.5 flex-wrap">
                {gamification.displayBadges.map((badge: any, i: number) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold"
                    style={{ backgroundColor: `${badge.color}15`, color: badge.color }}
                  >
                    {badge.icon} {badge.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="px-4 py-2.5 flex items-center gap-4 border-b border-slate-50">
            {gamification?.achievementCount != null && (
              <div className="flex items-center gap-1">
                <span className="text-sm">🏆</span>
                <span className="text-xs font-bold text-slate-700">{gamification.achievementCount}</span>
                <span className="text-[9px] text-slate-400">Achievement</span>
              </div>
            )}
            {gamification?.videosWatched != null && (
              <div className="flex items-center gap-1">
                <span className="text-sm">🎬</span>
                <span className="text-xs font-bold text-slate-700">{gamification.videosWatched}</span>
                <span className="text-[9px] text-slate-400">Video</span>
              </div>
            )}
          </div>

          {/* View profile button */}
          <button
            onClick={() => {
              onClose();
              navigate(`/user/${username || ""}`);
            }}
            className="w-full py-2.5 text-xs font-bold text-purple-600 hover:bg-purple-50 transition-colors"
          >
            Lihat Profil
          </button>
        </>
      )}
    </div>
  );
}
