/**
 * Achievements page — lists all achievements with unlock status, progress,
 * rarity, and EXP reward. Includes showcase badge management.
 */

import { ProtectedRoute } from "@/lib/protected-route";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAchievements, useGamificationProfile, useSpecialBadges, useShowcaseBadges, useUpdateShowcase } from "@/lib/gamification-api";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Lock, Check, Star } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

const RARITY_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  COMMON: { bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200", label: "Common" },
  RARE: { bg: "bg-blue-100", text: "text-blue-600", border: "border-blue-200", label: "Rare" },
  EPIC: { bg: "bg-purple-100", text: "text-purple-600", border: "border-purple-200", label: "Epic" },
  LEGENDARY: { bg: "bg-amber-100", text: "text-amber-600", border: "border-amber-200", label: "Legendary" },
  SPECIAL: { bg: "bg-pink-100", text: "text-pink-600", border: "border-pink-200", label: "Special" },
};

export default function AchievementsPage() {
  const { data: achievementsData, isLoading } = useAchievements();
  const { data: gamification } = useGamificationProfile();
  const { data: specialBadges } = useSpecialBadges();
  const { data: showcase } = useShowcaseBadges();
  const updateShowcase = useUpdateShowcase();
  const { toast } = useToast();
  const [showShowcaseEditor, setShowShowcaseEditor] = useState(false);

  if (isLoading || !achievementsData) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="max-w-lg mx-auto px-4 py-6 space-y-3">
            <Skeleton className="h-16 rounded-2xl" />
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  const achievements = achievementsData.achievements;
  const unlocked = achievements.filter(a => a.unlocked);
  const locked = achievements.filter(a => !a.unlocked);
  const userSpecialBadges = gamification?.specialBadges ?? [];

  // Showcase management
  const showcaseSet = new Set((showcase ?? []).map((s: any) => `${s.badgeType}:${s.badgeRef ?? "level"}`));

  function toggleShowcase(badgeType: string, badgeRef: string | null) {
    const key = `${badgeType}:${badgeRef ?? "level"}`;
    const current = [...(showcase ?? [])];
    const idx = current.findIndex((s: any) => `${s.badgeType}:${s.badgeRef ?? "level"}` === key);

    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      if (current.length >= 5) {
        toast({ title: "Maksimal 5 badge showcase", variant: "destructive" });
        return;
      }
      current.push({ badgeType, badgeRef });
    }

    updateShowcase.mutate(current.map((s: any) => ({ badgeType: s.badgeType, badgeRef: s.badgeRef })), {
      onSuccess: () => toast({ title: "Showcase diperbarui!" }),
    });
  }

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="max-w-lg mx-auto pb-8">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <Link href="/profile" className="text-slate-400 hover:text-purple-600">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-heading font-extrabold text-slate-800">Achievement</h1>
            <span className="text-xs font-bold text-purple-500 ml-auto">
              {achievementsData.unlockedCount}/{achievementsData.totalCount}
            </span>
          </div>

          {/* Showcase badges section */}
          <div className="px-4 mt-2">
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide">Showcase Badges</p>
                <button
                  onClick={() => setShowShowcaseEditor(!showShowcaseEditor)}
                  className="text-[10px] font-bold text-purple-500 hover:text-purple-600"
                >
                  {showShowcaseEditor ? "Selesai" : "Edit"}
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(showcase ?? []).map((s: any, i: number) => {
                  let icon = "🏆", name = "Badge", color = "#8b5cf6";
                  if (s.badgeType === "level" && gamification?.levelBadge) {
                    icon = gamification.levelBadge.icon;
                    name = gamification.levelBadge.name;
                    color = gamification.levelBadge.color;
                  } else if (s.badgeType === "special") {
                    const badge = userSpecialBadges.find((b: any) => b.id === s.badgeRef);
                    if (badge) { icon = badge.icon; name = badge.name; color = badge.color; }
                  } else if (s.badgeType === "achievement") {
                    const ach = unlocked.find((a: any) => a.id === s.badgeRef);
                    if (ach) { icon = ach.icon; name = ach.name; }
                  }
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold"
                      style={{ backgroundColor: `${color}15`, color }}
                    >
                      {icon} {name}
                    </span>
                  );
                })}
                {(showcase ?? []).length === 0 && (
                  <span className="text-xs text-slate-400">Belum ada badge showcase. Klik Edit untuk memilih.</span>
                )}
              </div>

              {/* Showcase editor */}
              {showShowcaseEditor && (
                <div className="mt-3 pt-3 border-t border-slate-50 space-y-2">
                  {/* Level badge option */}
                  <button
                    onClick={() => toggleShowcase("level", null)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                      showcaseSet.has("level:null") ? "bg-purple-50 border border-purple-200" : "bg-slate-50 border border-slate-100"
                    }`}
                  >
                    <span className="text-lg">{gamification?.levelBadge?.icon}</span>
                    <span className="flex-1 text-left">{gamification?.levelBadge?.name} (Level Badge)</span>
                    {showcaseSet.has("level:null") && <Check className="h-3.5 w-3.5 text-purple-500" />}
                  </button>

                  {/* Special badges */}
                  {userSpecialBadges.map((badge: any) => (
                    <button
                      key={badge.id}
                      onClick={() => toggleShowcase("special", badge.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        showcaseSet.has(`special:${badge.id}`) ? "bg-purple-50 border border-purple-200" : "bg-slate-50 border border-slate-100"
                      }`}
                    >
                      <span className="text-lg">{badge.icon}</span>
                      <span className="flex-1 text-left">{badge.name}</span>
                      {showcaseSet.has(`special:${badge.id}`) && <Check className="h-3.5 w-3.5 text-purple-500" />}
                    </button>
                  ))}

                  {/* Unlocked achievements */}
                  {unlocked.map((ach) => (
                    <button
                      key={ach.id}
                      onClick={() => toggleShowcase("achievement", ach.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        showcaseSet.has(`achievement:${ach.id}`) ? "bg-purple-50 border border-purple-200" : "bg-slate-50 border border-slate-100"
                      }`}
                    >
                      <span className="text-lg">{ach.icon}</span>
                      <span className="flex-1 text-left">{ach.name}</span>
                      {showcaseSet.has(`achievement:${ach.id}`) && <Check className="h-3.5 w-3.5 text-purple-500" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Unlocked achievements */}
          {unlocked.length > 0 && (
            <div className="px-4 mt-3">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wide mb-2 px-1">Terbuka</p>
              <div className="space-y-2">
                {unlocked.map((ach, i) => {
                  const rarity = RARITY_STYLE[ach.rarity] ?? RARITY_STYLE.COMMON;
                  return (
                    <motion.div
                      key={ach.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex items-center gap-3"
                    >
                      <div className={`h-12 w-12 rounded-xl ${rarity.bg} flex items-center justify-center text-2xl shrink-0 border ${rarity.border}`}>
                        {ach.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-800 text-sm truncate">{ach.name}</p>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${rarity.bg} ${rarity.text} shrink-0`}>
                            {rarity.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">{ach.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {ach.expReward > 0 && <span className="text-[10px] font-bold text-purple-500">+{ach.expReward} EXP</span>}
                          {ach.unlockedAt && (
                            <span className="text-[9px] text-slate-400">
                              {new Date(ach.unlockedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Locked achievements */}
          {locked.length > 0 && (
            <div className="px-4 mt-3">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wide mb-2 px-1">Belum Terbuka</p>
              <div className="space-y-2">
                {locked.map((ach, i) => {
                  const rarity = RARITY_STYLE[ach.rarity] ?? RARITY_STYLE.COMMON;
                  return (
                    <motion.div
                      key={ach.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex items-center gap-3 opacity-70"
                    >
                      <div className={`h-12 w-12 rounded-xl bg-slate-100 flex items-center justify-center text-2xl shrink-0 border border-slate-200 grayscale`}>
                        {ach.isHidden ? <Lock className="h-5 w-5 text-slate-400" /> : ach.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-700 text-sm truncate">
                            {ach.isHidden ? "Achievement Tersembunyi" : ach.name}
                          </p>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${rarity.bg} ${rarity.text} shrink-0`}>
                            {rarity.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {ach.isHidden ? "Buka untuk melihat detail" : ach.description}
                        </p>
                        {!ach.isHidden && (
                          <div className="mt-1">
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-purple-400 to-pink-400 rounded-full"
                                style={{ width: `${ach.progressPercent}%` }}
                              />
                            </div>
                            <p className="text-[9px] text-slate-400 mt-0.5">
                              {ach.progress}/{ach.requirementValue} · {ach.progressPercent}%
                            </p>
                          </div>
                        )}
                      </div>
                      {ach.expReward > 0 && !ach.isHidden && (
                        <span className="text-[10px] font-bold text-purple-400 shrink-0">+{ach.expReward}</span>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
