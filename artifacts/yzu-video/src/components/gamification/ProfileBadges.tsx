/**
 * ProfileBadges — visual badge system for the user profile page.
 * Displays the user's level badge, special badges, and earned achievements
 * in a cohesive white & purple theme with soft shadows.
 */

import { memo } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useGamificationProfile } from "@/lib/gamification-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Award, ChevronRight, Trophy } from "lucide-react";

function ProfileBadgesBase() {
  const { data: gamification, isLoading } = useGamificationProfile();

  if (isLoading || !gamification) {
    return (
      <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
        <Skeleton className="h-6 w-32 mb-4" />
        <div className="grid grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const { levelBadge, level, specialBadges, achievements, achievementCount, currentLevelExp, nextLevelExp } = gamification;
  const earnedAchievements = achievements.slice(0, 8);
  const expPercent = nextLevelExp > 0 ? Math.min(100, Math.floor((currentLevelExp / nextLevelExp) * 100)) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100"
      style={{ boxShadow: "0 2px 12px rgba(139, 92, 246, 0.06)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center shadow-sm">
            <Award className="h-4 w-4 text-white" />
          </div>
          <p className="text-xs font-extrabold text-slate-700">Badge & Pencapaian</p>
        </div>
        <Link href="/achievements" className="text-[10px] font-bold text-purple-500 hover:text-purple-600 flex items-center gap-0.5">
          Lihat Semua <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Level badge — prominent card */}
      <div
        className="flex items-center gap-3 mb-4 p-3 rounded-2xl bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-100"
        style={{ boxShadow: "0 2px 8px rgba(139, 92, 246, 0.08)" }}
      >
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
          style={{ backgroundColor: `${levelBadge.color}20` }}
        >
          {levelBadge.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{levelBadge.name}</p>
          <p className="text-xl font-extrabold text-slate-800">Level {level}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="h-1.5 flex-1 bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500"
                style={{ width: `${expPercent}%` }}
              />
            </div>
            <span className="text-[9px] font-bold text-slate-400 shrink-0">
              {currentLevelExp}/{nextLevelExp}
            </span>
          </div>
        </div>
      </div>

      {/* Special badges */}
      {specialBadges.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wide mb-2">Special Badge</p>
          <div className="grid grid-cols-4 gap-2">
            {specialBadges.slice(0, 8).map((badge: any, i: number) => (
              <motion.div
                key={badge.id || i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04, duration: 0.2 }}
                className="flex flex-col items-center gap-1 p-2 rounded-xl bg-white border border-slate-100"
                style={{ boxShadow: `0 2px 8px ${badge.color}12` }}
              >
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center text-lg"
                  style={{ backgroundColor: `${badge.color}15` }}
                >
                  {badge.icon}
                </div>
                <span className="text-[8px] font-bold text-slate-500 text-center truncate w-full">{badge.name}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Achievement badges */}
      {earnedAchievements.length > 0 && (
        <div>
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wide mb-2">
            Pencapaian ({achievementCount})
          </p>
          <div className="grid grid-cols-4 gap-2">
            {earnedAchievements.map((ach: any, i: number) => (
              <motion.div
                key={ach.achievement?.id || ach.id || i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04, duration: 0.2 }}
                className="flex flex-col items-center gap-1 p-2 rounded-xl bg-white border border-slate-100"
                style={{ boxShadow: "0 2px 8px rgba(139, 92, 246, 0.08)" }}
              >
                <div className="h-9 w-9 rounded-xl flex items-center justify-center text-lg bg-purple-50">
                  {ach.achievement?.icon || ach.icon || "🏆"}
                </div>
                <span className="text-[8px] font-bold text-slate-500 text-center truncate w-full">
                  {ach.achievement?.name || ach.name || "Achievement"}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {specialBadges.length === 0 && earnedAchievements.length === 0 && (
        <div className="text-center py-6">
          <Trophy className="h-8 w-8 text-slate-200 mx-auto mb-2" />
          <p className="text-xs text-slate-400 font-medium">
            Belum ada badge. Tonton video dan ikuti aktivitas untuk mendapatkan badge!
          </p>
        </div>
      )}
    </motion.div>
  );
}

export const ProfileBadges = memo(ProfileBadgesBase);
