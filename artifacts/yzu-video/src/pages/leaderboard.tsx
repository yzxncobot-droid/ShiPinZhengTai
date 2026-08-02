import { useState, useEffect, useRef } from "react";
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
  Trophy, Crown, Medal, Star, Search, Bell, ChevronRight,
  ArrowLeft, RefreshCw, Flame, TrendingUp, Eye, Upload, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";

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
  { id: "all",      label: "Semua",        icon: <Trophy className="h-3.5 w-3.5" /> },
  { id: "viewer",   label: "Viewer",       icon: <Eye className="h-3.5 w-3.5" /> },
  { id: "uploader", label: "Uploader",     icon: <Upload className="h-3.5 w-3.5" /> },
  { id: "activity", label: "Top Aktivitas",icon: <Flame className="h-3.5 w-3.5" /> },
  { id: "badge",    label: "Badge",        icon: <Star className="h-3.5 w-3.5" /> },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "weekly",  label: "Mingguan" },
  { id: "monthly", label: "Bulanan" },
  { id: "alltime", label: "Semua Waktu" },
];

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti() {
  const colors = ["#a855f7","#ec4899","#f59e0b","#10b981","#3b82f6","#f97316"];
  const pieces = Array.from({ length: 40 }, (_, i) => i);
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
      {pieces.map((i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-sm"
          style={{
            left: `${Math.random() * 100}%`,
            backgroundColor: colors[i % colors.length],
          }}
          initial={{ y: -20, opacity: 1, rotate: 0 }}
          animate={{
            y: typeof window !== "undefined" ? window.innerHeight + 40 : 900,
            opacity: [1, 1, 0],
            rotate: Math.random() * 720 - 360,
            x: (Math.random() - 0.5) * 200,
          }}
          transition={{
            duration: 3 + Math.random() * 2,
            delay: Math.random() * 1.5,
            ease: "easeIn",
          }}
        />
      ))}
    </div>
  );
}

// ── Podium card ───────────────────────────────────────────────────────────────
function PodiumCard({ entry, pos, isCurrentUser }: { entry: LeaderboardEntry; pos: 1 | 2 | 3; isCurrentUser: boolean }) {
  const configs = {
    1: { height: "h-36 md:h-40", crown: "🥇", gradient: "from-yellow-400/30 to-amber-500/20", glow: "shadow-yellow-400/40", border: "border-yellow-400/60", crownSize: "text-4xl", order: "order-2" },
    2: { height: "h-28 md:h-32", crown: "🥈", gradient: "from-slate-300/30 to-slate-400/20", glow: "shadow-slate-300/40", border: "border-slate-300/60", crownSize: "text-3xl", order: "order-1" },
    3: { height: "h-24 md:h-28", crown: "🥉", gradient: "from-amber-700/30 to-orange-700/20", glow: "shadow-amber-700/40", border: "border-amber-600/60", crownSize: "text-3xl", order: "order-3" },
  };
  const c = configs[pos];

  return (
    <motion.div
      className={`flex flex-col items-center ${c.order}`}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: pos * 0.15, duration: 0.5 }}
    >
      {/* Crown + Avatar */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3 + pos * 0.5, repeat: Infinity, ease: "easeInOut" }}
        className="flex flex-col items-center mb-2"
      >
        <span className={c.crownSize}>{c.crown}</span>
        <div className="relative mt-1">
          <motion.div
            className={`rounded-full p-0.5 bg-gradient-to-br ${c.gradient} border ${c.border} shadow-xl ${c.glow}`}
            animate={pos === 1 ? { boxShadow: ["0 0 15px 2px rgba(250,204,21,0.3)", "0 0 30px 8px rgba(250,204,21,0.5)", "0 0 15px 2px rgba(250,204,21,0.3)"] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Avatar className={pos === 1 ? "h-16 w-16 md:h-20 md:w-20" : "h-14 w-14 md:h-16 md:w-16"}>
              <AvatarImage src={entry.avatar || ""} />
              <AvatarFallback className="bg-purple-100 text-purple-700 font-bold text-lg">
                {entry.username.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </motion.div>
          {isCurrentUser && (
            <div className="absolute -top-1 -right-1 h-4 w-4 bg-green-400 rounded-full border-2 border-white" />
          )}
        </div>
      </motion.div>

      {/* Info */}
      <p className={`font-extrabold truncate max-w-[80px] md:max-w-[100px] text-center text-sm ${pos === 1 ? "text-yellow-300" : "text-white/90"}`}>
        {entry.username}
      </p>
      <p className="text-white/60 text-xs">Lv.{entry.level}</p>
      <div className="flex items-center gap-1 mt-1">
        <Star className="h-3 w-3 text-yellow-400" />
        <span className="text-white font-bold text-xs">{entry.points.toLocaleString("id-ID")}</span>
      </div>

      {/* Podium base */}
      <div className={`w-20 md:w-24 ${c.height} mt-3 rounded-t-xl bg-gradient-to-b ${c.gradient} border-t border-x ${c.border} flex items-start justify-center pt-2`}>
        <span className="text-white/80 font-black text-2xl md:text-3xl">#{pos}</span>
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
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all hover:scale-[1.01] cursor-pointer ${
        isCurrentUser
          ? "bg-purple-500/10 border border-purple-400/30"
          : "bg-white/5 hover:bg-white/10 border border-white/5"
      }`}
    >
      {/* Rank number */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-black ${
        entry.rank <= 10 ? "bg-purple-500/30 text-purple-300" : "bg-white/10 text-white/60"
      }`}>
        {entry.rank}
      </div>

      {/* Avatar */}
      <div className="relative">
        <Avatar className="h-10 w-10">
          <AvatarImage src={entry.avatar || ""} />
          <AvatarFallback className="bg-purple-100 text-purple-700 font-bold text-sm">
            {entry.username.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {isCurrentUser && (
          <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-green-400 rounded-full border-2 border-[#1a0a2e]" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`font-bold truncate text-sm ${isCurrentUser ? "text-purple-300" : "text-white/90"}`}>
            {entry.username}
          </p>
          {isCurrentUser && <Badge className="text-[9px] bg-purple-500 text-white border-none px-1.5 py-0 h-4 shrink-0">Kamu</Badge>}
          {entry.rankBadge && entry.rank <= 10 && (
            <Badge className="text-[9px] bg-amber-500/20 text-amber-300 border-amber-500/30 px-1.5 py-0 h-4 hidden sm:flex shrink-0">
              {entry.rankBadge}
            </Badge>
          )}
        </div>
        <p className="text-white/40 text-xs">Level {entry.level}</p>
      </div>

      {/* Points */}
      <div className="text-right shrink-0">
        <div className="flex items-center gap-1 justify-end">
          <Star className="h-3 w-3 text-yellow-400" />
          <span className="font-bold text-sm text-white">{entry.points.toLocaleString("id-ID")}</span>
        </div>
      </div>

      <ChevronRight className="h-4 w-4 text-white/20 shrink-0" />
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function LeaderboardSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/5">
          <Skeleton className="w-8 h-8 rounded-full bg-white/10" />
          <Skeleton className="w-10 h-10 rounded-full bg-white/10" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32 rounded bg-white/10" />
            <Skeleton className="h-2.5 w-16 rounded bg-white/10" />
          </div>
          <Skeleton className="h-4 w-16 rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}

// ── Point system info ─────────────────────────────────────────────────────────
const POINT_TABLE = [
  { activity: "Menonton video sampai selesai", points: "+10" },
  { activity: "Like video", points: "+2" },
  { activity: "Komentar", points: "+5" },
  { activity: "Upload video", points: "+25" },
  { activity: "Video mendapat Like", points: "+3" },
  { activity: "Video ditonton orang lain", points: "+1" },
  { activity: "Mendapat Badge", points: "+100" },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [category, setCategory] = useState<Category>("all");
  const [period, setPeriod] = useState<Period>("weekly");
  const [showPointInfo, setShowPointInfo] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const { data: entries = [], isLoading, refetch } = useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard", category, period],
    queryFn: () => adminFetch(`/leaderboard?category=${category}&period=${period}`),
    refetchInterval: 10 * 60 * 1000, // 10 minutes
    staleTime: 5 * 60 * 1000,
  });

  // Show confetti if current user is in top 3
  useEffect(() => {
    if (!user || entries.length === 0) return;
    const userEntry = entries.find(e => e.userId === user.id);
    if (userEntry && userEntry.rank <= 3) {
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 5000);
      return () => clearTimeout(t);
    }
  }, [entries, user]);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const userEntry = user ? entries.find(e => e.userId === user.id) : null;

  return (
    <AppLayout>
      {/* Confetti for top-3 users */}
      {showConfetti && <Confetti />}

      {/* Point Info Modal */}
      <Dialog open={showPointInfo} onOpenChange={setShowPointInfo}>
        <DialogContent className="max-w-sm rounded-3xl bg-gradient-to-b from-[#2d1060] to-[#1a0a2e] border border-purple-500/30 text-white">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-black text-white flex items-center justify-center gap-2">
              <Star className="h-5 w-5 text-yellow-400" /> Sistem Poin
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {POINT_TABLE.map((row) => (
              <div key={row.activity} className="flex justify-between items-center py-2 border-b border-white/10">
                <span className="text-white/70 text-sm">{row.activity}</span>
                <span className="font-black text-purple-300 text-sm">{row.points}</span>
              </div>
            ))}
          </div>
          <Button onClick={() => setShowPointInfo(false)} className="w-full mt-2 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold">
            Tutup
          </Button>
        </DialogContent>
      </Dialog>

      {/* Dark background page */}
      <div className="min-h-screen bg-gradient-to-b from-[#0f0520] via-[#1a0a2e] to-[#0f0520]">
        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-[#0f0520]/90 backdrop-blur-xl border-b border-white/5 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-9 w-9 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-white font-black text-lg flex-1 text-center">Leaderboard</h1>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-9 w-9" onClick={() => setShowPointInfo(true)}>
                <Star className="h-4 w-4" />
              </Button>
              <Link href="/notifications">
                <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-9 w-9">
                  <Bell className="h-4 w-4" />
                </Button>
              </Link>
              {user && (
                <Avatar className="h-8 w-8 border border-purple-400/40">
                  <AvatarImage src={user.avatar || ""} />
                  <AvatarFallback className="bg-purple-600 text-white text-xs font-bold">{user.username.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 pb-20">
          {/* ── Hero Banner ── */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-3xl bg-gradient-to-r from-purple-700 via-violet-600 to-purple-800 p-5 relative overflow-hidden"
          >
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute -top-4 -right-4 w-32 h-32 bg-yellow-400/20 rounded-full blur-2xl" />
              <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-pink-500/20 rounded-full blur-2xl" />
            </div>
            <div className="relative">
              <p className="text-purple-200 text-xs font-semibold uppercase tracking-widest mb-1">FUN+ Leaderboard</p>
              <h2 className="text-white font-black text-lg md:text-xl leading-tight">
                Jadilah yang terbaik dan<br />menangkan badge eksklusif!
              </h2>
            </div>
          </motion.div>

          {/* ── Current user position ── */}
          <AnimatePresence>
            {userEntry && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="mt-4 rounded-2xl bg-purple-500/15 border border-purple-400/30 px-4 py-3 flex items-center gap-3"
              >
                <div className="h-8 w-8 rounded-full bg-purple-500/30 flex items-center justify-center text-xs font-black text-purple-300">
                  #{userEntry.rank}
                </div>
                <div className="flex-1">
                  <p className="text-white/80 text-sm font-bold">Posisi kamu saat ini</p>
                  <p className="text-purple-300 text-xs">{userEntry.points.toLocaleString("id-ID")} poin · Level {userEntry.level}</p>
                </div>
                {userEntry.rankBadge && (
                  <Badge className="bg-purple-500/30 text-purple-200 border-purple-400/40 text-xs">
                    {userEntry.rankBadge}
                  </Badge>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Category tabs ── */}
          <div className="mt-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 pb-1 min-w-max">
              {CATEGORIES.map((cat) => (
                <motion.button
                  key={cat.id}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setCategory(cat.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${
                    category === cat.id
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/30"
                      : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
                  }`}
                >
                  {cat.icon}
                  {cat.label}
                </motion.button>
              ))}
            </div>
          </div>

          {/* ── Period filter ── */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex gap-1.5 bg-white/5 p-1 rounded-2xl">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    period === p.id
                      ? "bg-white/15 text-white"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="text-white/40 hover:text-white hover:bg-white/10 rounded-full h-8 w-8 p-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* ── Top 3 Podium ── */}
          {isLoading ? (
            <div className="mt-6 flex justify-center gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <Skeleton className="w-16 h-16 rounded-full bg-white/10" />
                  <Skeleton className="w-16 h-3 rounded bg-white/10" />
                  <Skeleton className="w-20 h-24 rounded-t-xl bg-white/10" />
                </div>
              ))}
            </div>
          ) : top3.length >= 3 ? (
            <div className="mt-6 px-2">
              <div className="flex items-end justify-center gap-3 md:gap-6">
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
              <Trophy className="h-12 w-12 text-white/20 mx-auto mb-3" />
              <p className="text-white/40 font-medium">Belum ada data untuk periode ini.</p>
              <p className="text-white/25 text-sm mt-1">Mulai aktivitas untuk masuk leaderboard!</p>
            </motion.div>
          )}

          {/* ── Rankings from #4 ── */}
          {rest.length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-purple-400" />
                <h3 className="text-white/60 text-sm font-bold uppercase tracking-wider">Ranking Berikutnya</h3>
              </div>
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

          {/* ── Info section ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-8 rounded-3xl bg-white/5 border border-white/10 p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-yellow-400" />
              <h3 className="text-white font-black text-sm">Cara Dapat Poin</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {POINT_TABLE.map((row) => (
                <div key={row.activity} className="flex items-center justify-between gap-2 bg-white/5 rounded-xl px-3 py-2">
                  <span className="text-white/60 text-xs truncate">{row.activity}</span>
                  <span className="text-purple-300 font-black text-xs shrink-0">{row.points}</span>
                </div>
              ))}
            </div>
            <p className="text-white/30 text-xs mt-3 text-center">
              Leaderboard diperbarui otomatis setiap 10 menit
            </p>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
}
