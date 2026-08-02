import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch, fmtDateTime } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Gift,
  Ticket,
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Loader2,
  Sparkles,
  Star,
  Coins,
  Package,
  BadgeCheck,
  AlertTriangle,
  HeartHandshake,
  Megaphone,
  GamepadIcon,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RedeemResult {
  status: "success" | "error";
  message?: string;
  error?: string;
  reward?: {
    rewardType: string;
    rewardValue: number;
    rewardName: string;
    description?: string;
    details: string;
  };
}

interface HistoryItem {
  id: string;
  code: string;
  rewardName: string;
  rewardType: string;
  rewardValue: number;
  status: string;
  createdAt: string;
  claimedReward?: string;
}

// ── Reward type helpers ───────────────────────────────────────────────────────

const REWARD_ICONS: Record<string, React.ReactNode> = {
  coin: <Coins className="w-5 h-5 text-yellow-500" />,
  wallet_balance: <Coins className="w-5 h-5 text-green-500" />,
  bundle: <Package className="w-5 h-5 text-blue-500" />,
  premium_membership: <Star className="w-5 h-5 text-purple-500" />,
  video_unlock: <BadgeCheck className="w-5 h-5 text-pink-500" />,
  badge: <BadgeCheck className="w-5 h-5 text-orange-500" />,
  coupon: <Ticket className="w-5 h-5 text-teal-500" />,
  discount: <Ticket className="w-5 h-5 text-indigo-500" />,
  custom: <Gift className="w-5 h-5 text-violet-500" />,
};

const REWARD_LABELS: Record<string, string> = {
  coin: "Koin",
  wallet_balance: "Saldo Wallet",
  bundle: "Bundle",
  premium_membership: "Hadiah Eksklusif",
  video_unlock: "Video Unlock",
  badge: "Badge",
  coupon: "Kupon",
  discount: "Diskon",
  custom: "Hadiah",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  success: {
    label: "Berhasil",
    color: "bg-green-100 text-green-700 border-green-200",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  expired: {
    label: "Kedaluwarsa",
    color: "bg-slate-100 text-slate-500 border-slate-200",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  used: {
    label: "Sudah Dipakai",
    color: "bg-orange-100 text-orange-600 border-orange-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  not_found: {
    label: "Tidak Ditemukan",
    color: "bg-red-100 text-red-600 border-red-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  not_active: {
    label: "Belum Aktif",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  limit_reached: {
    label: "Habis",
    color: "bg-red-100 text-red-600 border-red-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  pending: {
    label: "Pending",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
};

// ── Confetti component ────────────────────────────────────────────────────────

function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  const pieces = Array.from({ length: 30 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      {pieces.map((_, i) => {
        const colors = ["bg-purple-400", "bg-pink-400", "bg-yellow-400", "bg-green-400", "bg-blue-400", "bg-orange-400"];
        const color = colors[i % colors.length];
        const left = `${Math.random() * 100}%`;
        const animDelay = `${Math.random() * 0.8}s`;
        const size = Math.random() > 0.5 ? "w-2 h-2" : "w-1.5 h-3";
        return (
          <div
            key={i}
            className={`absolute top-0 ${size} ${color} rounded-sm opacity-0 animate-[confettiDrop_1.5s_ease-in_forwards]`}
            style={{ left, animationDelay: animDelay }}
          />
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RedeemPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [code, setCode] = useState("");
  const [successResult, setSuccessResult] = useState<RedeemResult["reward"] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);
  const [confettiActive, setConfettiActive] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (user === null) setLocation("/login");
  }, [user]);

  const { data: history = [], isLoading: historyLoading } = useQuery<HistoryItem[]>({
    queryKey: ["redeem-history"],
    queryFn: () => adminFetch("/redeem/history"),
    enabled: !!user,
  });

  const redeemMutation = useMutation({
    mutationFn: (code: string) =>
      adminFetch("/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    onSuccess: (data: RedeemResult) => {
      if (data.reward) {
        setSuccessResult(data.reward);
        setShowSuccess(true);
        setConfettiActive(true);
        setCode("");
        qc.invalidateQueries({ queryKey: ["redeem-history"] });
        setTimeout(() => setConfettiActive(false), 2500);
      }
    },
    onError: (err: any) => {
      const msg =
        err?.message ||
        "Terjadi kesalahan. Coba lagi.";
      setErrorMsg(msg);
      setShowError(true);
    },
  });

  const handleRedeem = () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      toast.error("Masukkan kode redeem terlebih dahulu.");
      return;
    }
    redeemMutation.mutate(trimmed);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCode(text.trim().toUpperCase());
      inputRef.current?.focus();
    } catch {
      toast.error("Tidak bisa membaca clipboard.");
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50">
      {/* Inline confetti keyframes */}
      <style>{`
        @keyframes confettiDrop {
          0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(300px) rotate(720deg); opacity: 0; }
        }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setLocation("/")}
          className="p-2 rounded-xl hover:bg-purple-50 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h1 className="text-lg font-extrabold text-slate-800">Code Redeem</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Hero Card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-purple-600 via-violet-600 to-pink-600 p-6 shadow-xl shadow-purple-200">
          {/* Decorative blobs */}
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/10" />

          <div className="relative flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <h2 className="text-2xl font-extrabold text-white leading-tight">
                Tukarkan kode kamu 🎉
              </h2>
              <p className="text-purple-200 text-sm leading-relaxed">
                Masukkan kode redeem untuk mendapatkan hadiah menarik.
              </p>

              {/* Input row */}
              <div className="flex gap-2 mt-4">
                <div className="flex-1 relative">
                  <Input
                    ref={inputRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
                    placeholder="Masukkan kode redeem"
                    className="bg-white/20 backdrop-blur border-white/30 text-white placeholder:text-purple-200 font-mono tracking-widest text-sm rounded-xl focus-visible:ring-white/50 pr-16"
                    maxLength={32}
                  />
                  <button
                    onClick={handlePaste}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-purple-200 hover:text-white text-xs font-bold px-1"
                    title="Paste"
                  >
                    Paste
                  </button>
                </div>
                <Button
                  onClick={handleRedeem}
                  disabled={redeemMutation.isPending || !code.trim()}
                  className="rounded-xl bg-white text-purple-700 hover:bg-purple-50 font-extrabold shadow-lg disabled:opacity-60 px-5"
                >
                  {redeemMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Redeem"
                  )}
                </Button>
              </div>

              <p className="text-purple-300 text-xs mt-1">
                Kode redeem tidak peka huruf besar/kecil.
              </p>
            </div>

            {/* Gift illustration */}
            <div className="hidden sm:flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-white/20 backdrop-blur shrink-0">
              <Gift className="w-10 h-10 text-white" />
              <Sparkles className="w-4 h-4 text-yellow-300 mt-1" />
            </div>
          </div>
        </div>

        {/* How to get codes */}
        <div className="space-y-2">
          <h3 className="text-sm font-extrabold text-slate-500 uppercase tracking-wider px-1">
            Cara Mendapatkan Kode
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                icon: <GamepadIcon className="w-6 h-6 text-purple-500" />,
                title: "🎮 Ikuti Event",
                desc: "Berpartisipasi dalam event resmi FUN+.",
                bg: "from-purple-50 to-violet-50 border-purple-100",
              },
              {
                icon: <Gift className="w-6 h-6 text-pink-500" />,
                title: "🎁 Promo Spesial",
                desc: "Dapatkan kode dari promo.",
                bg: "from-pink-50 to-rose-50 border-pink-100",
              },
              {
                icon: <Megaphone className="w-6 h-6 text-blue-500" />,
                title: "📣 Media Sosial",
                desc: "Ikuti media sosial kami.",
                bg: "from-blue-50 to-sky-50 border-blue-100",
              },
            ].map((item) => (
              <div
                key={item.title}
                className={`rounded-2xl border bg-gradient-to-br ${item.bg} p-3 space-y-1.5`}
              >
                {item.icon}
                <p className="text-xs font-extrabold text-slate-700 leading-tight">
                  {item.title}
                </p>
                <p className="text-xs text-slate-500 leading-tight">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Redeem History */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold text-slate-500 uppercase tracking-wider">
              Riwayat Redeem
            </h3>
            {history.length > 0 && (
              <span className="text-xs text-purple-500 font-bold">
                {history.length} kode
              </span>
            )}
          </div>

          {historyLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-2xl" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-10 rounded-2xl bg-white border border-dashed border-slate-200">
              <Gift className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-400 text-sm font-medium">Belum ada riwayat redeem</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item) => {
                const sc = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedHistory(item)}
                    className="w-full text-left bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3 hover:border-purple-200 hover:shadow-sm transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center shrink-0">
                      {REWARD_ICONS[item.rewardType] ?? <Gift className="w-5 h-5 text-purple-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-slate-700 tracking-wider">
                          {item.code}
                        </span>
                        <Badge
                          className={`text-[10px] px-1.5 py-0.5 flex items-center gap-1 border ${sc.color}`}
                        >
                          {sc.icon} {sc.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 truncate">{item.rewardName}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-slate-400">{fmtDateTime(item.createdAt)}</p>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto mt-0.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Support card */}
        <div className="rounded-2xl bg-white border border-slate-100 p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
              <HeartHandshake className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-700">Butuh bantuan?</p>
              <p className="text-xs text-slate-400">Tim kami siap membantu</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl border-purple-200 text-purple-600 hover:bg-purple-50 font-bold shrink-0"
            onClick={() => setLocation("/chat")}
          >
            Hubungi Support
          </Button>
        </div>
      </div>

      {/* ── Success Dialog ── */}
      <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
        <DialogContent className="max-w-sm rounded-3xl border-0 shadow-2xl overflow-hidden p-0">
          <div className="relative bg-gradient-to-br from-purple-600 to-pink-600 p-6 text-center">
            <Confetti active={confettiActive} />
            <div className="relative w-20 h-20 mx-auto mb-4 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
              <Gift className="w-10 h-10 text-white" />
              <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-yellow-300" />
            </div>
            <h2 className="text-2xl font-extrabold text-white">Redeem Berhasil 🎉</h2>
            <p className="text-purple-200 text-sm mt-1">{successResult?.details}</p>
          </div>

          <div className="p-6 space-y-4 bg-white">
            <div className="rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-100 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Hadiah</span>
                <span className="text-sm font-extrabold text-slate-800">
                  {successResult?.rewardName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Tipe</span>
                <div className="flex items-center gap-1.5">
                  {REWARD_ICONS[successResult?.rewardType ?? ""] ?? <Gift className="w-4 h-4" />}
                  <span className="text-sm font-bold text-slate-700">
                    {REWARD_LABELS[successResult?.rewardType ?? ""] ?? successResult?.rewardType}
                  </span>
                </div>
              </div>
              {successResult?.description && (
                <div className="pt-1 border-t border-purple-100">
                  <p className="text-xs text-slate-500">{successResult.description}</p>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-xl border-slate-200 font-bold"
                onClick={() => setShowSuccess(false)}
              >
                Tutup
              </Button>
              <Button
                className="flex-1 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-extrabold hover:opacity-90"
                onClick={() => {
                  setShowSuccess(false);
                  setLocation("/history");
                }}
              >
                Lihat Hadiah
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Error Dialog ── */}
      <Dialog open={showError} onOpenChange={setShowError}>
        <DialogContent className="max-w-sm rounded-3xl border-0 shadow-2xl overflow-hidden p-0">
          <div className="bg-gradient-to-br from-rose-500 to-orange-500 p-6 text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-xl font-extrabold text-white">Redeem Gagal</h2>
          </div>
          <div className="p-6 bg-white space-y-4 text-center">
            <p className="text-slate-700 font-medium">{errorMsg}</p>
            <Button
              className="w-full rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-extrabold hover:opacity-90"
              onClick={() => {
                setShowError(false);
                inputRef.current?.focus();
              }}
            >
              Coba Lagi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── History Detail Dialog ── */}
      <Dialog open={!!selectedHistory} onOpenChange={() => setSelectedHistory(null)}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold">Detail Redeem</DialogTitle>
          </DialogHeader>
          {selectedHistory && (() => {
            const sc = STATUS_CONFIG[selectedHistory.status] ?? STATUS_CONFIG.pending;
            let claimed: any = null;
            try { claimed = JSON.parse(selectedHistory.claimedReward ?? "{}"); } catch {}
            return (
              <div className="space-y-4">
                <div className="rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-100 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Kode</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-slate-800 tracking-wider">
                        {selectedHistory.code}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedHistory.code);
                          toast.success("Kode disalin!");
                        }}
                        className="text-slate-400 hover:text-purple-600"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Hadiah</span>
                    <span className="text-sm font-bold text-slate-700">{selectedHistory.rewardName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Status</span>
                    <Badge className={`text-xs flex items-center gap-1 border ${sc.color}`}>
                      {sc.icon} {sc.label}
                    </Badge>
                  </div>
                  {claimed?.details && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Detail</span>
                      <span className="text-xs font-medium text-slate-700">{claimed.details}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Tanggal</span>
                    <span className="text-xs text-slate-600">{fmtDateTime(selectedHistory.createdAt)}</span>
                  </div>
                </div>
                <Button
                  className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-extrabold hover:opacity-90"
                  onClick={() => setSelectedHistory(null)}
                >
                  Tutup
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
