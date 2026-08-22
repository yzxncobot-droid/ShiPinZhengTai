import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import {
  useCreateAutomaticTopup,
  useListMyTopups,
  getGetMeQueryKey,
  getListMyTopupsQueryKey,
} from "@workspace/api-client-react";
import type { AutomaticTopup, Topup } from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  X,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const DEFAULT_TOPUP_AMOUNT = 1000;

const TOPUP_STEPS = [
  { title: "Buka Widget Top Up", description: "Tekan tombol 'Top Up' di bawah untuk membuka widget QRIS.", Icon: ExternalLink },
  { title: "Scan Kode QRIS", description: "Pilih aplikasi pembayaran yang kamu gunakan, lalu scan kode QRIS yang muncul pada widget.", Icon: QrCode },
  { title: "Masukkan Nominal", description: "Masukkan jumlah nominal top up yang ingin kamu bayarkan.", Icon: Wallet },
  { title: "Konfirmasi Pembayaran", description: "Periksa kembali nominal dan detail pembayaran, lalu konfirmasi pembayaran di aplikasi kamu.", Icon: CheckCircle2 },
  { title: "Saldo Berhasil Ditambahkan", description: "Setelah pembayaran berhasil, saldo akan otomatis masuk ke akun kamu.", Icon: Wallet },
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
    awaiting_confirmation: { label: "Menunggu verifikasi", bg: "bg-blue-50", text: "text-blue-600", dot: "bg-blue-500" },
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
  onCheck,
}: {
  open: boolean;
  onClose: () => void;
  topup: AutomaticTopup | null;
  creating: boolean;
  checking: boolean;
  onCheck: () => void;
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

  const expired = !creating && (!secondsLeft || topup?.status === "expired");
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
                    {topup.paymentLink && !expired && (
                      <a
                        href={topup.paymentLink}
                        target="_blank"
                        rel="noreferrer"
                        className="h-10 rounded-xl border border-indigo-200 text-indigo-600 font-extrabold text-xs flex items-center justify-center hover:bg-indigo-50"
                      >
                        Buka halaman pembayaran
                      </a>
                    )}

                    <div className={`flex items-center justify-center gap-2 text-sm font-extrabold ${expired ? "text-red-500" : "text-amber-600"}`}>
                      <Clock className="h-4 w-4" />
                      {expired ? "QRIS telah kedaluwarsa" : `Menunggu pembayaran · ${minutes}:${seconds}`}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {topup.qrCodeUrl && !expired ? (
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
                      <button
                        onClick={onCheck}
                        disabled={checking || expired}
                        className="h-11 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                         Saya Sudah Bayar
                      </button>
                    </div>

                    <div className="flex items-start gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                      <Shield className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-slate-500 font-medium leading-snug">
                        Setelah pembayaran terdeteksi dan diverifikasi, saldo akan bertambah otomatis. Jangan bayar QRIS yang sudah kedaluwarsa.
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
  const [activeTopup, setActiveTopup] = useState<AutomaticTopup | null>(null);
  const [checking, setChecking] = useState(false);

  const sessionKey = (token ?? "anon").slice(0, 10);
  const historyList: Topup[] = useMemo(() => (topupHistory as any)?.data ?? [], [topupHistory]);
  const activePending = activeTopup && ["pending"].includes(activeTopup.status);

  useEffect(() => {
    if (shouldShowRules(sessionKey)) setShowRules(true);
  }, [sessionKey]);

  useEffect(() => {
    const topupId = new URLSearchParams(window.location.search).get("topup_id");
    if (!topupId || !token) return;
    let cancelled = false;
    void fetch(`/api/topup/${encodeURIComponent(topupId)}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Gagal memuat status top up.");
        if (cancelled) return;
        setActiveTopup(result);
        setQrisOpen(true);
        if (result.paid || result.status === "paid" || result.status === "confirmed") {
          refreshAfterPaid();
        }
      })
      .catch(() => {
        // The return URL is best-effort; the user can still open Top Up and
        // check the transaction manually if the session has expired.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const refreshAfterPaid = () => {
    queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey({ limit: 5 }) });
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const checkPayment = async () => {
    if (!activeTopup?.id || checking) return;
    setChecking(true);
    try {
      const latest = await fetch(`/api/topup/${activeTopup.id}/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const result = await latest.json();
      if (!latest.ok) throw new Error(result.error ?? result.message ?? "Gagal memeriksa pembayaran.");
      setActiveTopup(result);
      if (result.paid || result.status === "paid" || result.status === "confirmed") {
        toast({ title: "Top up berhasil!", description: "Saldo kamu sudah bertambah otomatis." });
        refreshAfterPaid();
        setQrisOpen(false);
      } else if (result.status === "expired") {
        toast({ title: "QRIS kedaluwarsa", description: "Buat transaksi baru untuk mencoba lagi.", variant: "destructive" });
      } else {
        toast({ title: "Belum ada pembayaran", description: "Pembayaran belum terdeteksi. Coba lagi beberapa saat." });
      }
    } catch (error: any) {
      toast({ title: "Gagal memeriksa pembayaran", description: error?.message ?? "Silakan coba lagi.", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!qrisOpen || !activeTopup?.id || !token) return;
    if (!["pending", "awaiting_confirmation"].includes(activeTopup.status)) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/topup/${encodeURIComponent(activeTopup.id)}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await response.json();
        if (cancelled || !response.ok) return;
        setActiveTopup(result);
        if (result.paid || result.status === "paid" || result.status === "confirmed") {
          toast({ title: "Top up berhasil!", description: "Saldo kamu sudah bertambah otomatis." });
          refreshAfterPaid();
          setQrisOpen(false);
        }
      } catch {
        // Retry on the next interval if the network is temporarily unavailable.
      }
    };

    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [qrisOpen, activeTopup?.id, activeTopup?.status, token]);

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

  const closeQris = () => {
    setQrisOpen(false);
    if (activeTopup?.status === "paid" || activeTopup?.status === "expired" || activeTopup?.status === "failed") {
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

        <div className="relative overflow-hidden bg-[#f7f5ff] px-5 pb-7 pt-8 md:px-8 md:pt-10">
          <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-pink-200/60" />
          <div className="pointer-events-none absolute bottom-0 left-1/2 h-20 w-20 rounded-full bg-blue-200/50" />
          <div className="relative mx-auto max-w-5xl">
            <div className="mb-5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-violet-500">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm">
                <Sparkles className="h-4 w-4" />
              </span>
              FUN+ Wallet
            </div>
            <h1 data-testid="text-topup-heading" className="max-w-md text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">Top Up Wallet</h1>
            <p data-testid="text-topup-description" className="mt-2 max-w-md text-sm font-medium leading-relaxed text-slate-500">Tekan tombol di bawah ini untuk melakukan top up.</p>
          </div>
        </div>

        <div className="relative mx-auto -mt-2 max-w-5xl px-4 md:px-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-violet-600 via-purple-600 to-blue-500 p-6 shadow-[0_18px_45px_rgba(109,82,214,0.24)] md:p-7"
          >
            <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full border-[18px] border-white/10" />
            <div className="absolute -bottom-12 left-20 h-28 w-28 rounded-full bg-pink-400/20" />
            <div className="relative z-10">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/65">CURRENT BALANCE</p>
              <p data-testid="text-current-balance" className="mt-1 text-3xl font-extrabold tracking-tight text-white md:text-4xl">Rp {(user?.walletBalance ?? 0).toLocaleString("id-ID")}</p>
              <p className="mt-3 text-xs font-semibold text-white/70">Saldo aman untuk menikmati lebih banyak cerita.</p>
            </div>
          </motion.div>
        </div>

        <div className="mx-auto grid max-w-5xl gap-5 px-4 py-5 md:grid-cols-[1.15fr_.85fr] md:px-8">
          <section className="rounded-[28px] border border-violet-100 bg-white p-5 shadow-[0_10px_35px_rgba(85,65,140,0.07)] md:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-violet-500">Mudah & aman</p>
                <h2 className="mt-1 text-xl font-extrabold text-slate-900">Tata Cara Top Up</h2>
              </div>
              <div className="rounded-2xl bg-violet-50 p-3 text-violet-600"><QrCode className="h-5 w-5" /></div>
            </div>
            <div className="space-y-4">
              {TOPUP_STEPS.map(({ title, description, Icon }, index) => (
                <div key={title} className={`flex gap-3 ${index < TOPUP_STEPS.length - 1 ? "border-b border-slate-100 pb-4" : ""}`} data-testid={`step-topup-${index + 1}`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-extrabold text-white">{index + 1}</span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0"><h3 className="text-sm font-extrabold text-slate-800">{title}</h3><p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500">{description}</p></div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-[0_10px_35px_rgba(85,65,140,0.07)] md:p-6">
            <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Pilihan pembayaran</p>
            <h2 className="text-base font-extrabold text-slate-900">METODE PEMBAYARAN</h2>
            <p className="mb-4 mt-1 text-xs font-medium text-slate-500">Semua pembayaran diproses melalui QRIS</p>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((method) => (
                <div key={method.id} data-testid={`payment-method-${method.id}`} className={`flex h-10 items-center justify-center rounded-xl border px-1.5 transition-all ${method.selectable ? "border-violet-300 bg-violet-50 ring-1 ring-violet-400" : "border-slate-100 bg-slate-50 opacity-70"}`}>
                  <span className="truncate text-center text-[9px] font-extrabold leading-tight sm:text-[10px]" style={{ color: method.color }}>{method.label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mx-auto mb-7 max-w-5xl px-4 md:px-8">
          <div className="relative overflow-hidden rounded-[30px] bg-gradient-to-r from-violet-600 via-fuchsia-500 to-blue-500 p-6 shadow-[0_18px_45px_rgba(109,82,214,0.22)] md:flex md:items-center md:justify-between md:p-8">
            <div className="pointer-events-none absolute right-8 top-[-40px] h-32 w-32 rounded-full border-[16px] border-white/10" />
            <div className="relative z-10 text-white">
              <h2 className="text-2xl font-extrabold">Top Up Wallet</h2>
              <p className="mt-1 max-w-sm text-sm font-medium text-white/80">Tekan tombol di bawah ini untuk melakukan top up.</p>
            </div>
            <Button data-testid="button-topup" type="button" onClick={() => startTopup(DEFAULT_TOPUP_AMOUNT)} disabled={createTopup.isPending} className="relative z-10 mt-5 h-12 w-full rounded-2xl bg-white px-6 text-sm font-extrabold tracking-widest text-violet-700 shadow-lg hover:bg-violet-50 md:mt-0 md:w-auto">
              TOP UP <ArrowUpRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>

        <div className="mx-auto mb-8 max-w-5xl px-4 md:px-8">
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
            <div className="rounded-2xl border border-dashed border-violet-200 bg-white p-7 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-500">
                <Clock className="h-5 w-5" />
              </div>
              <p className="text-sm font-extrabold text-slate-700">Belum ada riwayat top up</p>
              <p className="mt-1 text-xs font-medium text-slate-400">Transaksi kamu akan muncul di sini.</p>
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
          onCheck={checkPayment}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}