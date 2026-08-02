import { useState, useEffect, useCallback, useRef } from "react";
import { adminFetch } from "@/lib/admin-api";
import { Loader2, Gift, Coins, Star, Ticket, Zap, Package, BadgeCheck, ChevronDown, ChevronUp, X } from "lucide-react";

interface Drop {
  id: string;
  title: string;
  description?: string;
  rewardType: string;
  rewardValue: string;
  rewardAmount?: number | null;
  maxWinners: number;
  currentClaims: number;
  startTime: string;
  endTime: string;
  buttonColor: string;
  claimed: boolean;
}

const REWARD_ICONS: Record<string, React.ElementType> = {
  wallet_balance: Coins,
  coins: Coins,
  premium_subscription: Star,
  premium_video: BadgeCheck,
  bundle: Package,
  coupon: Ticket,
  redeem_code: Ticket,
  xp: Zap,
  badge: BadgeCheck,
  custom: Gift,
};

const REWARD_LABELS: Record<string, string> = {
  wallet_balance: "Saldo Wallet",
  coins: "Koin",
  premium_subscription: "Hadiah Eksklusif",
  premium_video: "Video Eksklusif",
  bundle: "Bundle",
  coupon: "Kupon",
  redeem_code: "Kode Redeem",
  xp: "XP",
  badge: "Badge",
  custom: "Hadiah Spesial",
};

function formatReward(type: string, value: string, amount?: number | null): string {
  if (type === "wallet_balance" || type === "coins") {
    const n = amount ?? parseFloat(value);
    return isNaN(n) ? value : `${n.toLocaleString("id-ID")}`;
  }
  if (type === "premium_subscription") return `${value} hari Eksklusif`;
  return value;
}

function useCountdown(endTime: string) {
  const calc = () => Math.max(0, new Date(endTime).getTime() - Date.now());
  const [ms, setMs] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setMs(calc()), 1000);
    return () => clearInterval(id);
  }, [endTime]);
  const total = ms / 1000;
  const h  = Math.floor(total / 3600);
  const m  = Math.floor((total % 3600) / 60);
  const s  = Math.floor(total % 60);
  return { ms, h, m, s, expired: ms === 0 };
}

// Lightweight confetti burst (CSS)
function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  const colors = ["#f59e0b","#8b5cf6","#3b82f6","#ef4444","#10b981","#f97316"];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-full animate-bounce"
          style={{
            backgroundColor: colors[i % colors.length],
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 60}%`,
            animationDelay: `${Math.random() * 0.5}s`,
            animationDuration: `${0.5 + Math.random() * 0.5}s`,
            opacity: 0.8,
          }}
        />
      ))}
    </div>
  );
}

interface Props {
  userId?: string;
  roomId?: string;
  onClose?: () => void;
}

export function DropCard({ userId, roomId, onClose }: Props) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [successDrop, setSuccessDrop] = useState<{ id: string; details: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [activeDrop, setActiveDrop] = useState(0); // index into drops[]
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDrops = useCallback(async () => {
    try {
      const url = roomId ? `/drops/active?roomId=${encodeURIComponent(roomId)}` : "/drops/active";
      const data = await adminFetch<Drop[]>(url);
      setDrops(data);
    } catch {}
  }, [roomId]);

  useEffect(() => {
    fetchDrops();
    pollRef.current = setInterval(fetchDrops, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchDrops]);

  const drop = drops[activeDrop] ?? null;

  if (!drop) return null;

  const claim = async (id: string) => {
    if (!userId) { setError("Login untuk klaim drop"); return; }
    setClaiming(id);
    setError(null);
    try {
      const res = await adminFetch<{ success: boolean; rewardDetails: string; title: string }>(
        `/drops/${id}/claim`, { method: "POST" },
      );
      if (res.success) {
        setSuccessDrop({ id, details: res.rewardDetails });
        setDrops((prev) => prev.map((d) => d.id === id ? { ...d, claimed: true, currentClaims: d.currentClaims + 1 } : d));
        setTimeout(() => { setSuccessDrop(null); fetchDrops(); }, 4000);
      }
    } catch (err: any) {
      setError(err.message ?? "Klaim gagal");
    } finally {
      setClaiming(null);
    }
  };

  const RewardIcon = REWARD_ICONS[drop.rewardType] ?? Gift;
  const rewardLabel = REWARD_LABELS[drop.rewardType] ?? "Hadiah";
  const rewardDisplay = formatReward(drop.rewardType, drop.rewardValue, drop.rewardAmount);
  const progress = drop.maxWinners > 0 ? Math.min(1, drop.currentClaims / drop.maxWinners) : 0;
  const remaining = drop.maxWinners - drop.currentClaims;
  const isFull = remaining <= 0;

  return (
    <div className="mx-3 mb-2">
      {/* Header bar */}
      <div
        className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white px-3 py-1.5 rounded-t-2xl cursor-pointer"
        onClick={() => setMinimized((v) => !v)}
      >
        <span className="text-sm">🎉</span>
        <span className="flex-1 text-xs font-extrabold truncate">OWNER DROP — {drop.title}</span>
        {onClose && (
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {minimized ? <ChevronDown className="h-3.5 w-3.5 opacity-70" /> : <ChevronUp className="h-3.5 w-3.5 opacity-70" />}
      </div>

      {!minimized && (
        <div className="relative bg-white border border-purple-100 rounded-b-2xl shadow-lg shadow-purple-500/10 overflow-hidden">
          <Confetti active={!!successDrop && successDrop.id === drop.id} />

          {/* Glow ring */}
          <div className="absolute inset-0 rounded-b-2xl pointer-events-none ring-1 ring-inset ring-purple-200" />

          <div className="p-4">
            {/* Reward display */}
            <div className="flex items-center gap-3 mb-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-md shadow-purple-300/40 shrink-0">
                <RewardIcon className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 font-medium">{rewardLabel}</p>
                <p className="text-2xl font-black text-slate-800 leading-tight">{rewardDisplay}</p>
                {drop.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{drop.description}</p>
                )}
              </div>
            </div>

            {/* Progress */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>Tersisa <strong className="text-slate-700">{remaining}</strong> / {drop.maxWinners}</span>
                <CountdownDisplay endTime={drop.endTime} />
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-500 font-medium mb-2 text-center">{error}</p>
            )}

            {/* Success */}
            {successDrop?.id === drop.id && (
              <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5 mb-2 text-center">
                <p className="text-sm font-extrabold text-green-700">🎉 Berhasil diklaim!</p>
                <p className="text-xs text-green-600 mt-0.5">{successDrop.details}</p>
              </div>
            )}

            {/* Claim button */}
            {!drop.claimed && !successDrop ? (
              <button
                onClick={() => claim(drop.id)}
                disabled={!!claiming || isFull}
                className="w-full py-3 rounded-2xl text-sm font-extrabold text-white shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: isFull ? "#94a3b8" : `linear-gradient(135deg, ${drop.buttonColor}, ${drop.buttonColor}dd)` }}
              >
                {claiming === drop.id
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Mengklaim...</>
                  : isFull ? "Habis 🚫" : "🎁 Klaim Sekarang!"
                }
              </button>
            ) : (
              <div className="w-full py-3 rounded-2xl text-sm font-extrabold text-green-700 bg-green-50 border border-green-200 text-center">
                ✅ Sudah diklaim
              </div>
            )}

            {/* Multiple drops indicator */}
            {drops.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-2">
                {drops.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveDrop(i)}
                    className={`h-1.5 rounded-full transition-all ${i === activeDrop ? "w-4 bg-purple-500" : "w-1.5 bg-slate-200"}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CountdownDisplay({ endTime }: { endTime: string }) {
  const { h, m, s, expired } = useCountdown(endTime);
  if (expired) return <span className="text-red-500 font-bold">Waktu habis</span>;
  const parts = h > 0
    ? `${h}j ${m}m ${s}d`
    : `${m}m ${s}d`;
  return <span className="font-bold text-purple-600">⏱ {parts}</span>;
}
