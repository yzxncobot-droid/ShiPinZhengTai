/**
 * Statistics page — shows total EXP, current level, next level progress,
 * achievements count, video stats, engagement stats, community stats, and
 * streak. Includes a simple bar chart for weekly EXP activity.
 */

import { ProtectedRoute } from "@/lib/protected-route";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGamificationProfile, useExpHistory } from "@/lib/gamification-api";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import {
  TrendingUp, Award, Video, Heart, MessageCircle, Users,
  Flame, Zap, BarChart3, Trophy, Upload, ChevronLeft,
} from "lucide-react";
import { Link } from "wouter";

function StatBox({ icon: Icon, label, value, color, delay }: {
  icon: React.ElementType; label: string; value: string | number; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col items-center gap-2"
    >
      <div className={`h-10 w-10 rounded-xl ${color} flex items-center justify-center shadow-sm`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <p className="font-extrabold text-slate-800 text-lg">{value}</p>
      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide text-center">{label}</p>
    </motion.div>
  );
}

export default function StatisticsPage() {
  const { data: gamification, isLoading } = useGamificationProfile();
  const { data: expHistory } = useExpHistory(30);

  if (isLoading || !gamification) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
            <Skeleton className="h-32 rounded-3xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  const stats = gamification.statistics;
  const expPercent = gamification.nextLevelExp > 0
    ? Math.min(100, Math.floor((gamification.currentLevelExp / gamification.nextLevelExp) * 100))
    : 0;
  const expToNext = gamification.nextLevelExp - gamification.currentLevelExp;

  // Build weekly EXP chart data from exp_history
  const last7Days: { day: string; exp: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000);
    const dayLabel = date.toLocaleDateString("id-ID", { weekday: "short" });
    const dayStart = date.toISOString().slice(0, 10);
    const dayExp = (expHistory ?? [])
      .filter((t: any) => new Date(t.createdAt).toISOString().slice(0, 10) === dayStart)
      .reduce((sum: number, t: any) => sum + t.amount, 0);
    last7Days.push({ day: dayLabel, exp: dayExp });
  }
  const maxExp = Math.max(...last7Days.map(d => d.exp), 10);

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="max-w-lg mx-auto pb-8">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <Link href="/profile" className="text-slate-400 hover:text-purple-600">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-heading font-extrabold text-slate-800">Statistik Saya</h1>
          </div>

          {/* Level & EXP card */}
          <div className="px-4 mt-2">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-5 shadow-lg border border-slate-100"
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center text-2xl shadow-md"
                  style={{ backgroundColor: `${gamification.levelBadge.color}20` }}
                >
                  {gamification.levelBadge.icon}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{gamification.levelBadge.name}</p>
                  <p className="text-2xl font-extrabold text-slate-800">Level {gamification.level}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Total EXP</p>
                  <p className="text-lg font-extrabold text-purple-600">{gamification.lifetimeExp.toLocaleString()}</p>
                </div>
              </div>

              {/* EXP progress bar */}
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-slate-600">
                    {gamification.currentLevelExp} / {gamification.nextLevelExp} EXP
                  </span>
                  <span className="text-[10px] font-bold text-purple-500">{expToNext} EXP lagi</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${expPercent}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 text-center">
                  {expToNext} EXP lagi menuju Level {gamification.level + 1}
                </p>
              </div>

              {/* Streak */}
              <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-slate-50">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-bold text-slate-700">{gamification.streakDays} Hari Streak</span>
                <span className="text-[10px] text-slate-400">· EXP hari ini: {gamification.expToday}</span>
              </div>
            </motion.div>
          </div>

          {/* Weekly EXP chart */}
          <div className="px-4 mt-3">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100"
            >
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-4 w-4 text-purple-500" />
                <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide">EXP 7 Hari Terakhir</p>
              </div>
              <div className="flex items-end justify-between gap-2 h-32">
                {last7Days.map((d, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 flex-1">
                    <div className="w-full flex items-end justify-center h-full">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${(d.exp / maxExp) * 100}%` }}
                        transition={{ delay: i * 0.05, duration: 0.5 }}
                        className="w-7 rounded-t-lg bg-gradient-to-t from-purple-500 to-pink-400 min-h-[4px]"
                        title={`${d.exp} EXP`}
                      />
                    </div>
                    <span className="text-[9px] font-bold text-slate-400">{d.day}</span>
                    <span className="text-[8px] text-slate-300">{d.exp}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Achievements summary */}
          <div className="px-4 mt-3">
            <Link href="/achievements">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 cursor-pointer hover:border-purple-100 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
                      <Trophy className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide">Achievements</p>
                      <p className="text-lg font-extrabold text-slate-800">{gamification.achievementCount} terbuka</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-purple-500">Lihat Semua →</span>
                </div>
              </motion.div>
            </Link>
          </div>

          {/* Stats grid */}
          <div className="px-4 mt-3">
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wide mb-2 px-1">Video</p>
            <div className="grid grid-cols-2 gap-3">
              <StatBox icon={Video} label="Video Ditonton" value={stats.videosWatched} color="bg-purple-500" delay={0.2} />
              <StatBox icon={Upload} label="Video Di-upload" value={stats.videosUploaded} color="bg-blue-500" delay={0.25} />
            </div>
          </div>

          <div className="px-4 mt-3">
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wide mb-2 px-1">Engagement</p>
            <div className="grid grid-cols-2 gap-3">
              <StatBox icon={Heart} label="Like Diberikan" value={stats.videosLiked} color="bg-pink-500" delay={0.3} />
              <StatBox icon={MessageCircle} label="Komentar" value={stats.commentsPosted} color="bg-orange-500" delay={0.35} />
              <StatBox icon={MessageCircle} label="Pesan Terkirim" value={stats.messagesSent} color="bg-cyan-500" delay={0.4} />
              <StatBox icon={Users} label="Grup Diikuti" value={stats.groupsJoined} color="bg-emerald-500" delay={0.45} />
            </div>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
