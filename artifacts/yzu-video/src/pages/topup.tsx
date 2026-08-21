import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import {
  useCreateAutomaticTopup,
  useGetAutomaticTopupStatus,
  useListMyTopups,
  getGetMeQueryKey,
  getListMyTopupsQueryKey,
} from "@workspace/api-client-react";
import type { AutomaticTopup, Topup } from "@workspace/api-client-react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Info,
  Loader2,
  QrCode,
  RefreshCw,
  Shield,
  ShieldAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const PRESETS = [
  { amount: 1000, label: "Rp 1.000" },
  { amount: 5000, label: "Rp 5.000" },
  { amount: 10000, label: "Rp 10.000" },
  { amount: 15000, label: "Rp 15.000" },
  { amount: 25000, label: "Rp 25.000" },
  { amount: 50000, label: "Rp 50.000" },
];

const PAYMENT_METHODS = [
  { id: "qris", label: "QRIS", color: "#7C3AED", selectable: true },
  { id: "gopay", label: "GoPay", color: "#00AED6" },
  { id: "ovo", label: "OVO", color: "#4C3494" },
  { id: "dana", label: "DANA", color: "#118EEA" },
  { id: "shopeepay", label: "ShopeePay", color: "#EE4D2D" },
  { id: "linkaja", label: "LinkAja", color: "#E82529" },
  { id: "bca", label: "BCA", color: "#0066AE" },
  { id: "bri", label: "BRI", color: "#00529C" },
  { id: "mandiri", label: "mandiri", color: "#003087" },
  { id: "bni", label: "BNI", color: "#F47920" },
  { id: "bsi", label: "BSI", color: "#006233" },
  { id: "cimb", label: "CIMB", color: "#C1392B" },
];

const LS_KEY = "topup_rules_ack";
const POLL_INTERVAL_MS = 4_000;

function shouldShowRules(sessionKey: string): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return true;
    const { ts, sk } = JSON.parse(raw) as { ts: number; sk: string };
    return sk !== sessionKey || Date.now() - ts > 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

const RULES = [
  "QRIS yang muncul dibuat khusus untuk nominal dan transaksi ini.",
  "Bayar sesuai nominal yang tertera agar pembayaran dapat terdeteksi.",
  "QRIS hanya berlaku selama countdown masih berjalan.",
  "Saldo bertambah otomatis setelah pembayaran terverifikasi.",
  "Download QRIS bukan bukti pembayaran dan tidak membuat transaksi baru.",
];

function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        className="max-w-sm w-[95vw] rounded-3xl border-0 p-0 overflow-hidden shadow-2xl"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="bg-gradient-to-br from-purple-600 to-indigo-600 px-6 pt-6 pb-5 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-white font-extrabold text-lg">Aturan Pembayaran QRIS</h2>
          <p className="text-white/80 text-xs mt-1 font-medium">Baca sebelum melakukan top up</p>
        </div>
        <div className="bg-white px-5 pt-4 pb-2 space-y-2.5 max-h-[55vh] overflow-y-auto">
          <ol className="space-y-2.5">
            {RULES.map((rule, index) => (
              <li key={rule} className="flex gap-3 text-sm text-slate-700">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-100 text-purple-600 font-extrabold text-xs flex items-center justify-center mt-0.5">
                  {index + 1}
                </span>
                <span className="leading-snug">{rule}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="bg-white px-5 pb-5 pt-3">
          <Button
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold"
            onClick={onClose}
          >
            Saya Mengerti <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function statusDetails(status: string) {
  return {
    pending: { label: "Menunggu", bg: "bg-amber-50", text: "text-amber-600", dot: "bg-amber-500" },
    confirmed: { label: "Berhasil", bg: "bg-green-50", text: "text-green-600", dot: "bg-green-500" },
    paid: { label: "Berhasil", bg: "bg-green-50", text: "text-green-600", dot: "bg-green-500" },
    denied: { label: "Ditolak", bg: "bg-red-50", text: "text-red-600", dot: "bg-red-500" },
    expired: { label: "Kedaluwarsa", bg: "bg-slate-100", text: "text-slate-500", dot: "bg-slate-400" },
    failed: { label: "Gagal", bg: "bg-red-50", text: "text-red-600", dot: "bg-red-500" },
    cancelled: { label: "Dibatalkan", bg: "bg-slate-100", text: "text-slate-500", dot: "bg-slate-400" },
  }[status] ?? { label: status, bg: "bg-slate-100", text: "text-slate-500", dot: "bg-slate-400" };
}

function HistoryCard({ topup }: { topup: Topup }) {
  const status = statusDetails(topup.status);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2 gap-3">
        <span className="font-extrabold text-slate-800 text-base">
          Rp {topup.amount.toLocaleString("id-ID")}
        </span>
        <span className={`flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-1 rounded-full ${status.bg} ${status.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>
      <div className="space-y-1 text-[11px] text-slate-500 font-medium">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{format(new Date(topup.createdAt), "dd MMM yyyy, HH:mm", { locale: localeId })}</span>
        </div>
        {topup.orderId && (
          <div className="flex items-center gap-1.5">
            <QrCode className="h-3 w-3 shrink-0" />
            <span className="truncate">Order: {topup.orderId}</span>
          </div>
        )}
        {topup.paidAt && (
          <div className="flex items-center gap-1.5 text-green-600">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span>Dibayar: {format(new Date(topup.paidAt), "dd MMM yyyy, HH:mm", { locale: localeId })}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 shrink-0 text-center font-bold">•</span>
          <span>{topup.gateway ? `${topup.paymentMethod?.toUpperCase() ?? "QRIS"} · ${topup.gateway}` : "QRIS"}</span>
        </div>
      </div>
    </div>
  );
}

function AutomaticQrisModal({
  open,
  onClose,
  topup,
  creating,
  checking,
  canceling,
  onCheck,
  onCancel,
}: {
  open: boolean;
  onClose: () => void;
  topup: AutomaticTopup | null;
  creating: boolean;
  checking: boolean;
  canceling: boolean;
  onCheck: () => void;
  onCancel: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!open || !topup?.expiredAt) {
      setSecondsLeft(0);
      return;
    }
    const update = () => {
      setSecondsLeft(Math.max(0, Math.ceil((new Date(topup.expiredAt!).getTime() - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [open, topup?.expiredAt]);

  const cancelled = !creating && topup?.status === "cancelled";
  const expired = !creating && (!secondsLeft || topup?.status === "expired");
  const awaiting = topup?.status === "awaiting_confirmation";
  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="qris-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            key="qris-modal"
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
          >
            <div className="w-full max-w-sm rounded-[26px] overflow-hidden bg-white shadow-2xl pointer-events-auto">
              <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-500 px-5 py-5 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-2xl bg-white/20 flex items-center justify-center">
                      <QrCode className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-xl">Bayar QRIS</h3>
                      <p className="text-xs text-white/75">QRIS dinamis untuk transaksi ini</p>
                    </div>
                  </div>
                  <button onClick={onClose} className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center" aria-label="Tutup">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {creating || !topup ? (
                  <div className="py-14 text-center">
                    <Loader2 className="h-10 w-10 text-purple-600 animate-spin mx-auto mb-3" />
                    <p className="text-sm font-extrabold text-slate-700">Membuat QRIS dinamis...</p>
                    <p className="text-xs text-slate-400 mt-1">Mohon tunggu sebentar</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl bg-purple-50 border border-purple-100 px-4 py-3 text-center">
                      <p className="text-[10px] font-extrabold text-purple-400 uppercase tracking-widest">Total Bayar</p>
                      <p className="text-3xl font-extrabold text-purple-700">Rp {topup.amount.toLocaleString("id-ID")}</p>
                      <p className="text-[10px] text-slate-400 mt-1">Order ID: {topup.orderId}</p>
                    </div>

                    <div className="flex justify-center">
                      {topup.qrCodeUrl ? (
                        <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-md">
                          <img src={topup.qrCodeUrl} alt={`QRIS ${topup.orderId}`} className="w-52 h-52 object-contain" />
                        </div>
                      ) : (
                        <div className="w-52 h-52 rounded-3xl bg-slate-50 border border-slate-200 flex flex-col gap-2 items-center justify-center text-center px-5">
                          <AlertCircle className="h-8 w-8 text-amber-400" />
                          <span className="text-xs font-bold text-slate-500">QRIS belum tersedia</span>
                        </div>
                      )}
                    </div>

                    <div className={`flex items-center justify-center gap-2 text-sm font-extrabold ${cancelled ? "text-slate-500" : expired ? "text-red-500" : awaiting ? "text-blue-600" : "text-amber-600"}`}>
                      <Clock className="h-4 w-4" />
                      {cancelled ? "Pembayaran dibatalkan" : expired ? "Waktu habis — pembayaran dibatalkan" : awaiting ? "Menunggu verifikasi penjual" : `Menunggu pembayaran · ${minutes}:${seconds}`}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {topup.qrCodeUrl && !expired && !cancelled ? (
                        <a
                          href={topup.qrCodeUrl}
                          download={`QRIS-${topup.orderId}.png`}
                          target="_blank"
                          rel="noreferrer"
                          className="h-11 rounded-xl border border-purple-200 text-purple-600 font-extrabold text-xs flex items-center justify-center gap-1.5 hover:bg-purple-50"
                        >
                          <Download className="h-4 w-4" /> Download QRIS
                        </a>
                      ) : (
                        <button disabled className="h-11 rounded-xl border border-slate-200 text-slate-300 font-extrabold text-xs flex items-center justify-center gap-1.5">
                          <Download className="h-4 w-4" /> Download QRIS
                        </button>
                      )}
                      {awaiting ? (
                        <button
                          disabled
                          className="h-11 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 font-extrabold text-xs flex items-center justify-center gap-1.5"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" /> Menunggu Verifikasi
                        </button>
                      ) : (
                        <button
                          onClick={onCheck}
                          disabled={checking || expired || cancelled || topup.status !== "pending"}
                          className="h-11 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Saya Sudah Bayar
                        </button>
                      )}
                    </div>

                    {topup.status === "pending" && !cancelled && (
                      <button
                        onClick={onCancel}
                        disabled={canceling}
                        className="w-full h-10 rounded-xl border border-red-200 text-red-600 font-extrabold text-xs flex items-center justify-center gap-1.5 hover:bg-red-50 disabled:opacity-50"
                      >
                        {canceling ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        Batalkan Pembayaran
                      </button>
                    )}

                    <div className="flex items-start gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                      <Shield className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-slate-500 font-medium leading-snug">
                        {awaiting
                          ? "Pembayaran sedang diverifikasi penjual. Saldo bertambah otomatis setelah diverifikasi. Jangan bayar lagi ke QRIS yang sama."
                          : "Setelah pembayaran terdeteksi dan diverifikasi, saldo akan bertambah otomatis. Jangan bayar QRIS yang sudah kedaluwarsa."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: topupHistory, isLoading: loadingHistory } = useListMyTopups({ limit: 5 });
  const createTopup = useCreateAutomaticTopup();
  const [showRules, setShowRules] = useState(false);
  const [qrisOpen, setQrisOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState("");
  const [activeTopup, setActiveTopup] = useState<AutomaticTopup | null>(null);
  const [checking, setChecking] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const sessionKey = (token ?? "anon").slice(0, 10);
  const historyList: Topup[] = useMemo(() => (topupHistory as any)?.data ?? [], [topupHistory]);
  const activePending = activeTopup && ["pending", "awaiting_confirmation"].includes(activeTopup.status);

  useEffect(() => {
    if (shouldShowRules(sessionKey)) setShowRules(true);
  }, [sessionKey]);

  const refreshAfterPaid = () => {
    queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey({ limit: 5 }) });
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const cancelTopup = async () => {
    if (!activeTopup?.id || canceling) return;
    setCanceling(true);
    try {
      const latest = await fetch(`/api/topup/${activeTopup.id}/cancel`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const result = await latest.json();
      if (!latest.ok) throw new Error(result.error ?? result.message ?? "Gagal membatalkan pembayaran.");
      setActiveTopup(result);
      toast({ title: "Pembayaran dibatalkan", description: "Transaksi dibatalkan dan QRIS dinonaktifkan." });
      refreshAfterPaid();
    } catch (error: any) {
      toast({ title: "Gagal membatalkan", description: error?.message ?? "Silakan coba lagi.", variant: "destructive" });
    } finally {
      setCanceling(false);
    }
  };

  const checkPayment = async () => {
    if (!activeTopup?.id || checking) return;
    setChecking(true);
    try {
      // "Saya Sudah Bayar" — customer signals payment. This NEVER credits the
      // wallet; it moves the order to awaiting_confirmation so the merchant
      // verifies the funds arrived (Verify Order), then the wallet is credited.
      const latest = await fetch(`/api/topup/${activeTopup.id}/mark-paid`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const result = await latest.json();
      if (!latest.ok) throw new Error(result.error ?? result.message ?? "Gagal memeriksa pembayaran.");
      setActiveTopup(result);
      if (result.paid || result.status === "paid" || result.status === "confirmed") {
        toast({ title: "Top up berhasil!", description: "Saldo kamu sudah bertambah otomatis." });
        refreshAfterPaid();
        setQrisOpen(false);
      } else if (result.status === "awaiting_confirmation") {
        toast({ title: "Menunggu verifikasi", description: "Pembayaran diterima. Penjual akan memverifikasi dan saldo bertambah otomatis." });
      } else if (result.status === "cancelled") {
        toast({ title: "Pembayaran dibatalkan", description: "Transaksi dibatalkan. Buat baru untuk top up lagi.", variant: "destructive" });
      } else if (result.status === "denied") {
        toast({ title: "Pembayaran ditolak", description: "Penjual menolak pembayaran ini. Hubungi admin bila perlu.", variant: "destructive" });
      } else if (result.status === "expired") {
        toast({ title: "QRIS kedaluwarsa", description: "Buat transaksi baru untuk mencoba lagi.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Gagal memeriksa pembayaran", description: error?.message ?? "Silakan coba lagi.", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!qrisOpen || !activeTopup?.id || activeTopup.status !== "awaiting_confirmation") return;
    // Once the customer marked "Sudah Bayar", poll the gateway status so the
    // wallet update from the merchant's Verify Order is reflected live. This
    // only READS — it never mints balance (the status route is read-only).
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/topup/${activeTopup.id}/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const d = await r.json();
        if (cancelled) return;
        if (d.paid || d.status === "paid" || d.status === "confirmed") {
          setActiveTopup(d);
          toast({ title: "Top up berhasil!", description: "Pembayaran terverifikasi. Saldo bertambah otomatis." });
          refreshAfterPaid();
          setQrisOpen(false);
        } else if (d.status === "denied" || d.status === "cancelled") {
          setActiveTopup(d);
          refreshAfterPaid();
        } else {
          setActiveTopup(d);
        }
      } catch {}
    };
    poll();
    const t = window.setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrisOpen, activeTopup?.id, activeTopup?.status]);

  const startTopup = (amount: number) => {
    if (activePending) {
      toast({ title: "Selesaikan transaksi sebelumnya", description: "Periksa pembayaran QRIS yang masih aktif terlebih dahulu.", variant: "destructive" });
      setQrisOpen(true);
      return;
    }
    setQrisOpen(true);
    setActiveTopup(null);
    createTopup.mutate(
      { data: { amount } },
      {
        onSuccess: (created: AutomaticTopup) => setActiveTopup(created),
        onError: (error: any) => {
          setQrisOpen(false);
          toast({
            title: "QRIS gagal dibuat",
            description: error?.message ?? "Gateway pembayaran belum siap. Silakan coba lagi.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const applyCustom = () => {
    const amount = Number(customValue.replace(/[^\d]/g, ""));
    if (!Number.isInteger(amount) || amount < 100) {
      setCustomError("Minimum top up adalah Rp 100.");
      return;
    }
    if (amount > 1_000_000) {
      setCustomError("Maximum top up adalah Rp 1.000.000.");
      return;
    }
    setCustomError("");
    startTopup(amount);
  };

  const closeQris = () => {
    setQrisOpen(false);
    if (activeTopup?.status === "paid" || activeTopup?.status === "expired" || activeTopup?.status === "failed" || activeTopup?.status === "cancelled") {
      setActiveTopup(null);
    }
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <RulesModal
          open={showRules}
          onClose={() => {
            localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), sk: sessionKey }));
            setShowRules(false);
          }}
        />

        <div className="relative px-5 pt-6 pb-3 overflow-hidden bg-white">
          <div className="absolute top-5 right-28 text-yellow-400 text-xl select-none pointer-events-none">★</div>
          <div className="absolute top-12 right-14 text-yellow-300 text-sm select-none pointer-events-none animate-bounce">★</div>
          <div className="absolute top-4 right-44 text-yellow-200 text-xs select-none pointer-events-none">✦</div>
          <div className="absolute right-3 top-0 text-[72px] select-none pointer-events-none opacity-85 leading-none">🧒</div>
          <div className="max-w-[65%]">
            <h1 className="text-2xl font-extrabold text-slate-800 leading-tight">Top Up Balance</h1>
            <p className="text-xs text-slate-500 font-medium mt-1.5 leading-snug">Top up your wallet instantly using QRIS.</p>
          </div>
        </div>

        <div className="mx-4 mb-4">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-500 rounded-3xl p-5 shadow-xl overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-36 h-36 bg-white/5 rounded-full -translate-x-6 -translate-y-10" />
            <div className="absolute bottom-0 left-0 w-28 h-28 bg-white/5 rounded-full translate-x-2 translate-y-10" />
            <div className="relative z-10">
              <p className="text-white/60 text-[10px] font-extrabold uppercase tracking-[0.15em] mb-1">Current Balance</p>
              <p className="text-white font-extrabold text-3xl tracking-tight">Rp {(user?.walletBalance ?? 0).toLocaleString("id-ID")}</p>
            </div>
            <div className="absolute right-5 top-5 text-white/10 text-4xl select-none">◆</div>
          </motion.div>
        </div>

        <div className="mx-4 mb-4 bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
          <p className="font-extrabold text-slate-800 text-sm mb-3">Select Amount</p>
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            {PRESETS.map((preset, index) => (
              <motion.button
                key={preset.amount}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => startTopup(preset.amount)}
                disabled={createTopup.isPending}
                className="relative flex flex-col items-center py-3.5 px-2 rounded-2xl font-extrabold text-sm border transition-all bg-slate-50 text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50 active:bg-purple-100 disabled:opacity-50"
              >
                <span className="text-xs font-extrabold text-slate-400">TOP UP</span>
                <span className="text-sm font-extrabold mt-0.5 leading-tight">{preset.label}</span>
              </motion.button>
            ))}
          </div>
          <div className="border-t border-slate-100 pt-3.5">
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">Custom Amount</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold pointer-events-none">Rp</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Min: Rp 100"
                  value={customValue}
                  onChange={(event) => { setCustomValue(event.target.value); setCustomError(""); }}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyCustom(); } }}
                  className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50 text-sm font-bold focus-visible:ring-purple-500"
                />
              </div>
              <Button type="button" onClick={applyCustom} disabled={createTopup.isPending} className="h-11 px-5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-sm gap-1 shrink-0">
                <CheckCircle2 className="h-4 w-4" /> Use
              </Button>
            </div>
            {customError && (
              <p className="text-xs text-red-500 font-medium mt-1.5 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {customError}
              </p>
            )}
            <p className="text-[10px] text-slate-400 font-medium mt-1.5">Minimum: Rp 100 · Maximum: Rp 1.000.000</p>
          </div>
        </div>

        <div className="mx-4 mb-4 bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1">Payment Methods</p>
          <p className="text-xs text-slate-500 font-medium mb-3">All payments processed via QRIS</p>
          <div className="grid grid-cols-4 gap-2">
            {PAYMENT_METHODS.map((method) => (
              <div key={method.id} className={`flex items-center justify-center h-10 rounded-xl border px-2 transition-all ${method.selectable ? "border-purple-300 bg-purple-50 ring-1 ring-purple-400" : "border-slate-100 bg-slate-50 opacity-70"}`}>
                <span className="text-[10px] font-extrabold truncate leading-tight text-center" style={{ color: method.color }}>{method.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-4 mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="font-extrabold text-slate-800 text-sm">Top Up History</p>
            <button type="button" onClick={() => setLocation("/history")} className="text-[11px] font-bold text-purple-600 hover:text-purple-800">
              See all <ChevronRight className="h-3 w-3 inline" />
            </button>
          </div>
          {loadingHistory ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map((item) => <div key={item} className="bg-white rounded-2xl border border-slate-100 p-4 animate-pulse h-20" />)}
            </div>
          ) : historyList.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
              <div className="text-3xl mb-2">💳</div>
              <p className="text-sm font-extrabold text-slate-600">No top-up history yet</p>
              <p className="text-xs text-slate-400 font-medium mt-1">Your transactions will appear here</p>
            </div>
          ) : (
            <AnimatePresence>
              <div className="space-y-2.5">
                {historyList.map((topup, index) => (
                  <motion.div key={topup.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                    <HistoryCard topup={topup} />
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </div>

        <AutomaticQrisModal
          open={qrisOpen}
          onClose={closeQris}
          topup={activeTopup}
          creating={createTopup.isPending}
          checking={checking}
          canceling={canceling}
          onCheck={checkPayment}
          onCancel={cancelTopup}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}