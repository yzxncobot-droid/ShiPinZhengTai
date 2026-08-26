/**
 * Leaderboard page — light-themed redesign with podium, category tabs,
 * time filter, and rankings list. Accessible to all users (no auth required).
 */

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trophy, Star, ChevronRight, ArrowLeft, Eye, Upload, Flame, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string | null;
  verificationBadge: string | null;
  points: number;
  level: number;
  rankBadge: string | null;
}

type Category = "all" | "viewer" | "uploader" | "activity" | "badge";
type Period = "weekly" | "monthly" | "alltime";

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode }[] = [
  { id: "all",      label: "Semua",         icon: <Trophy className="h-3.5 w-3.5" /> },
  { id: "viewer",   label: "Viewer",        icon: <Eye className="h-3.5 w-3.5" /> },
  { id: "uploader", label: "Uploader",      icon: <Upload className="h-3.5 w-3.5" /> },
  { id: "activity", label: "Top Aktivitas", icon: <Flame className="h-3.5 w-3.5" /> },
  { id: "badge",    label: "Badge",         icon: <Star className="h-3.5 w-3.5" /> },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "weekly",  label: "Mingguan" },
  { id: "monthly", label: "Bulanan" },
  { id: "alltime", label: "Semua Waktu" },
];

const POINT_TABLE = [
  { activity: "Menonton video sampai selesai", points: "+10" },
  { activity: "Like video", points: "+2" },
  { activity: "Komentar", points: "+5" },
  { activity: "Upload video", points: "+25" },
  { activity: "Video mendapat Like", points: "+3" },
  { activity: "Video ditonton orang lain", points: "+1" },
  { activity: "Mendapat Badge", points: "+100" },
];

// ── Podium config ─────────────────────────────────────────────────────────────
const PODIUM_CONFIG = {
  1: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    medal: "🥇",
    medalSize: "text-3xl",
    avatarSize: "h-16 w-16",
    cardHeight: "pt-5 pb-4",
    order: "order-2",
    label: "text-amber-700",
  },
  2: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    medal: "🥈",
    medalSize: "text-2xl",
    avatarSize: "h-14 w-14",
    cardHeight: "pt-4 pb-3",
    order: "order-1",
    label: "text-blue-700",
  },
  3: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    medal: "🥉",
    medalSize: "text-2xl",
    avatarSize: "h-14 w-14",
    cardHeight: "pt-4 pb-3",
    order: "order-3",
    label: "text-orange-700",
  },
} as const;

// ── Podium card ───────────────────────────────────────────────────────────────
function PodiumCard({ entry, pos, isCurrentUser }: { entry: LeaderboardEntry; pos: 1 | 2 | 3; isCurrentUser: boolean }) {
  const c = PODIUM_CONFIG[pos];

  return (
    <motion.div
      className={`flex flex-col items-center ${c.order} flex-1 max-w-[120px]`}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: pos * 0.15, duration: 0.4 }}
    >
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 2.5 + pos * 0.3, repeat: Infinity, ease: "easeInOut" }}
        className="flex flex-col items-center"
      >
        <span className={c.medalSize}>{c.medal}</span>
        <div className="relative mt-1">
          <div className={`rounded-full p-0.5 bg-gradient-to-br from-purple-400 to-pink-400 shadow-md`}>
            <Avatar className={c.avatarSize}>
              <AvatarImage src={entry.avatar || ""} />
              <AvatarFallback className="bg-purple-100 text-purple-700 font-bold">
                {entry.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          {isCurrentUser && (
            <div className="absolute -top-1 -right-1 h-4 w-4 bg-green-400 rounded-full border-2 border-white" />
          )}
        </div>
      </motion.div>

      <div className={`mt-2 rounded-2xl ${c.bg} border ${c.border} ${c.cardHeight} px-2 w-full flex flex-col items-center gap-1`}>
        <p className="font-extrabold text-slate-800 text-xs text-center truncate max-w-full">{entry.username}</p>
        <div className="flex items-center gap-0.5">
          <Star className="h-3 w-3 text-amber-400" fill="currentColor" />
          <span className="font-bold text-slate-700 text-xs">{entry.points.toLocaleString("id-ID")}</span>
        </div>
        <span className={`text-[10px] font-bold ${c.label}`}>Level {entry.level}</span>
      </div>
    </motion.div>
  );
}

// ── Rank row ──────────────────────────────────────────────────────────────────
function RankRow({ entry, isCurrentUser, index }: { entry: LeaderboardEntry; isCurrentUser: boolean; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all hover:scale-[1.01] cursor-pointer ${
        isCurrentUser
          ? "bg-purple-50 border border-purple-200"
          : "bg-white border border-slate-100 hover:border-purple-100 hover:shadow-sm"
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-black ${
        entry.rank <= 10 ? "bg-purple-100 text-purple-600" : "bg-slate-100 text-slate-500"
      }`}>
        {entry.rank}
      </div>

      <div className="relative">
        <Avatar className="h-10 w-10">
          <AvatarImage src={entry.avatar || ""} />
          <AvatarFallback className="bg-purple-100 text-purple-700 font-bold text-sm">
            {entry.username.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {isCurrentUser && (
          <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-green-400 rounded-full border-2 border-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`font-bold truncate text-sm ${isCurrentUser ? "text-purple-700" : "text-slate-800"}`}>
            {entry.username}
          </p>
          {isCurrentUser && <Badge className="text-[9px] bg-purple-500 text-white border-none px-1.5 py-0 h-4 shrink-0">Kamu</Badge>}
        </div>
        <p className="text-slate-400 text-xs">Level {entry.level}</p>
      </div>

      <div className="text-right shrink-0">
        <div className="flex items-center gap-1 justify-end">
          <Star className="h-3 w-3 text-amber-400" fill="currentColor" />
          <span className="font-bold text-sm text-slate-700">{entry.points.toLocaleString("id-ID")}</span>
        </div>
      </div>

      <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function LeaderboardSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border border-slate-100">
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32 rounded" />
            <Skeleton className="h-2.5 w-16 rounded" />
          </div>
          <Skeleton className="h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [category, setCategory] = useState<Category>("all");
  const [period, setPeriod] = useState<Period>("weekly");
  const [showPointInfo, setShowPointInfo] = useState(false);

  const { data: entries = [], isLoading, refetch } = useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard", category, period],
    queryFn: () => adminFetch(`/leaderboard?category=${category}&period=${period}`),
    refetchInterval: 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const userEntry = user ? entries.find(e => e.userId === user.id) : null;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 pb-8">
        {/* ── Header ── */}
        <div className="flex items-center gap-3 pt-4 pb-2">
          <button onClick={() => setLocation("/")} className="text-slate-400 hover:text-purple-600 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-extrabold text-slate-800">Leaderboard</h1>
        </div>

        {/* ── Category tabs ── */}
        <div className="mt-2 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 pb-1 min-w-max">
            {CATEGORIES.map((cat) => (
              <motion.button
                key={cat.id}
                whileTap={{ scale: 0.95 }}
                onClick={() => setCategory(cat.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${
                  category === cat.id
                    ? "bg-purple-600 text-white shadow-md shadow-purple-500/20"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {cat.icon}
                {cat.label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* ── Banner ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded-3xl bg-gradient-to-r from-purple-500 to-violet-700 p-5 relative overflow-hidden"
        >
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -top-4 -right-4 w-32 h-32 bg-yellow-400/20 rounded-full blur-2xl" />
            <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-pink-500/20 rounded-full blur-2xl" />
          </div>
          <div className="relative flex items-center justify-between">
            <div className="flex-1">
              <h2 className="text-white font-extrabold text-lg leading-tight">
                Jadilah yang terbaik
              </h2>
              <p className="text-white/80 text-sm mt-0.5">dan memenangkan badge eksklusif!</p>
              <button
                onClick={() => setShowPointInfo(true)}
                className="mt-3 bg-white text-purple-700 text-xs font-bold px-4 py-1.5 rounded-full shadow-sm hover:shadow-md transition-shadow"
              >
                Lihat Hadiah →
              </button>
            </div>
            <div className="text-5xl ml-3 shrink-0">🏆</div>
          </div>
        </motion.div>

        {/* ── Time filter ── */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  period === p.id
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-400">Update setiap 10 menit</span>
        </div>

        {/* ── Current user position ── */}
        <AnimatePresence>
          {userEntry && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="mt-4 rounded-2xl bg-purple-50 border border-purple-200 px-4 py-3 flex items-center gap-3"
            >
              <div className="h-8 w-8 rounded-full bg-purple-500 flex items-center justify-center text-xs font-black text-white">
                #{userEntry.rank}
              </div>
              <div className="flex-1">
                <p className="text-slate-700 text-sm font-bold">Posisi kamu saat ini</p>
                <p className="text-purple-600 text-xs">{userEntry.points.toLocaleString("id-ID")} poin · Level {userEntry.level}</p>
              </div>
              {userEntry.rankBadge && (
                <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-xs">
                  {userEntry.rankBadge}
                </Badge>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Top 3 Podium ── */}
        {isLoading ? (
          <div className="mt-6 flex justify-center gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex flex-col items-center gap-2 flex-1 max-w-[120px]">
                <Skeleton className="w-16 h-16 rounded-full" />
                <Skeleton className="w-full h-20 rounded-2xl" />
              </div>
            ))}
          </div>
        ) : top3.length >= 3 ? (
          <div className="mt-6">
            <div className="flex items-end justify-center gap-3">
              <PodiumCard entry={top3[1]} pos={2} isCurrentUser={user?.id === top3[1]?.userId} />
              <PodiumCard entry={top3[0]} pos={1} isCurrentUser={user?.id === top3[0]?.userId} />
              <PodiumCard entry={top3[2]} pos={3} isCurrentUser={user?.id === top3[2]?.userId} />
            </div>
          </div>
        ) : top3.length > 0 ? (
          <div className="mt-4 space-y-2">
            {top3.map((entry, i) => (
              <RankRow key={entry.userId} entry={entry} isCurrentUser={user?.id === entry.userId} index={i} />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-12 text-center"
          >
            <Trophy className="h-12 w-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">Belum ada data untuk periode ini.</p>
            <p className="text-slate-300 text-sm mt-1">Mulai aktivitas untuk masuk leaderboard!</p>
          </motion.div>
        )}

        {/* ── Rankings from #4 ── */}
        {rest.length > 0 && (
          <div className="mt-6 space-y-2">
            {isLoading ? (
              <LeaderboardSkeleton />
            ) : (
              rest.map((entry, i) => (
                <RankRow
                  key={entry.userId}
                  entry={entry}
                  isCurrentUser={user?.id === entry.userId}
                  index={i}
                />
              ))
            )}
          </div>
        )}

        {/* ── Point info section ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8 rounded-3xl bg-white border border-slate-100 p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-amber-400" />
            <h3 className="text-slate-800 font-extrabold text-sm">Cara Dapat Poin</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {POINT_TABLE.map((row) => (
              <div key={row.activity} className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2">
                <span className="text-slate-500 text-xs truncate">{row.activity}</span>
                <span className="text-purple-600 font-bold text-xs shrink-0">{row.points}</span>
              </div>
            ))}
          </div>
          <p className="text-slate-300 text-xs mt-3 text-center">
            Leaderboard diperbarui otomatis setiap 10 menit
          </p>
        </motion.div>
      </div>

      {/* ── Point Info Modal ── */}
      <Dialog open={showPointInfo} onOpenChange={setShowPointInfo}>
        <DialogContent className="max-w-sm rounded-3xl bg-white border border-slate-100">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-extrabold text-slate-800 flex items-center justify-center gap-2">
              <Star className="h-5 w-5 text-amber-400" fill="currentColor" /> Sistem Poin
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {POINT_TABLE.map((row) => (
              <div key={row.activity} className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-slate-600 text-sm">{row.activity}</span>
                <span className="font-bold text-purple-600 text-sm">{row.points}</span>
              </div>
            ))}
          </div>
          <Button onClick={() => setShowPointInfo(false)} className="w-full mt-2 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold">
            Tutup
          </Button>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
