import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  QrCode,
  Shield,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TemanQrisWidget } from "@/components/temanqris-widget";

const MERCHANT_ID = "MQECF85EABA6";
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 5 * 60 * 1_000;

const TOPUP_STEPS = [
  { title: "Buka Widget Top Up", description: "Tekan tombol 'Top Up' di bawah untuk membuka widget QRIS.", Icon: ExternalLink },
  { title: "Scan Kode QRIS", description: "Pilih aplikasi pembayaran yang kamu gunakan, lalu scan kode QRIS yang muncul pada widget.", Icon: QrCode },
  { title: "Masukkan Nominal", description: "Masukkan jumlah nominal top up yang ingin kamu bayarkan.", Icon: Wallet },
  { title: "Konfirmasi Pembayaran", description: "Periksa kembali nominal dan detail pembayaran, lalu konfirmasi pembayaran di aplikasi kamu.", Icon: CheckCircle2 },
  { title: "Saldo Berhasil Ditambahkan", description: "Setelah pembayaran berhasil, saldo akan otomatis masuk ke akun kamu.", Icon: Wallet },
];

const PAYMENT_METHODS = [
  { id: "qris", label: "QRIS", color: "#7C3AED" },
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

type Phase = "idle" | "preparing" | "ready" | "linking" | "polling" | "done";

function isFinalStatus(status: string): boolean {
  return ["paid", "confirmed", "failed", "expired", "cancelled", "denied"].includes(status);
}

function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "confirmed";
}

/**
 * Status overlay shown during the polling phase. Displays the current
 * transaction status with appropriate messaging. The backend is the single
 * source of truth — this UI only reflects what the server reports.
 */
function StatusOverlay({
  status,
  amount,
  onClose,
}: {
  status: string;
  amount?: number;
  onClose: () => void;
}) {
  const config = {
    pending: { icon: Loader2, spin: true, color: "text-violet-600", bg: "bg-violet-50", title: "Menyiapkan pembayaran...", desc: "Mohon tunggu sebentar." },
    awaiting_confirmation: { icon: Loader2, spin: true, color: "text-amber-600", bg: "bg-amber-50", title: "Pembayaran sedang diverifikasi...", desc: "Pembayaran kamu sedang diverifikasi oleh sistem. Saldo akan bertambah otomatis setelah konfirmasi." },
    paid: { icon: CheckCircle2, spin: false, color: "text-green-600", bg: "bg-green-50", title: "Top Up Berhasil!", desc: "Saldo wallet telah ditambahkan." },
    confirmed: { icon: CheckCircle2, spin: false, color: "text-green-600", bg: "bg-green-50", title: "Top Up Berhasil!", desc: "Saldo wallet telah ditambahkan." },
    failed: { icon: AlertCircle, spin: false, color: "text-red-600", bg: "bg-red-50", title: "Pembayaran Gagal", desc: "Silakan coba lagi." },
    expired: { icon: Clock, spin: false, color: "text-slate-600", bg: "bg-slate-100", title: "Pembayaran Kedaluwarsa", desc: "Waktu pembayaran telah habis. Silakan coba lagi." },
    cancelled: { icon: X, spin: false, color: "text-red-600", bg: "bg-red-50", title: "Pembayaran Dibatalkan", desc: "Pembayaran telah dibatalkan." },
    denied: { icon: X, spin: false, color: "text-red-600", bg: "bg-red-50", title: "Top Up Ditolak", desc: "Top up ditolak oleh admin." },
  };
  const c = config[status as keyof typeof config] ?? config.pending;
  const Icon = c.icon;
  const final = isFinalStatus(status);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:px-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 10 }}
          className="w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-sm sm:rounded-3xl"
        >
          <div className={`flex flex-col items-center px-6 py-10 text-center ${c.bg}`}>
            <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm`}>
              <Icon className={`h-8 w-8 ${c.color} ${c.spin ? "animate-spin" : ""}`} />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">{c.title}</h3>
            <p className="mt-1.5 text-sm font-medium text-slate-500">{c.desc}</p>
            {amount != null && amount > 0 && (
              <p className="mt-2 text-2xl font-extrabold text-slate-900">Rp {amount.toLocaleString("id-ID")}</p>
            )}
          </div>
          {final && (
            <div className="p-5">
              <button
                onClick={onClose}
                className="h-11 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-sm font-extrabold text-white"
              >
                Tutup
              </button>
            </div>
          )}
          {!final && (
            <div className="flex items-start gap-2.5 bg-slate-50 px-5 py-3">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
              <p className="text-[11px] font-medium leading-snug text-slate-500">
                Status diperbarui otomatis dari server. Jangan tutup jendela ini sebelum pembayaran selesai.
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>("idle");
  const [topupId, setTopupId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string>("pending");
  const [paymentAmount, setPaymentAmount] = useState<number | undefined>();
  const callbackHandled = useRef(false);

  // ── Process TemanQRIS callback params ────────────────────────────────────
  // Called when the payment popup redirects back to our URL with
  // ?local_id=...&order_id=...&amount=...&status=...
  // In popup mode: detect we're a popup, send postMessage to opener, close.
  // In redirect mode: process directly.
  const processCallback = useCallback(
    async (params: URLSearchParams) => {
      const localId = params.get("local_id");
      const orderId = params.get("order_id");
      const amount = params.get("amount");
      const status = params.get("status");

      if (!localId || !orderId) return false;

      // If we're in a popup, forward the callback to the opener and close.
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "temanqris-callback", localId, orderId, amount, status },
          window.location.origin,
        );
        window.close();
        return true;
      }

      // Redirect mode: process directly on this page.
      const amt = amount ? Number(amount) : undefined;
      setTopupId(localId);
      setPaymentAmount(amt);
      setPaymentStatus(status ?? "pending");
      setPhase("polling");

      // Link the local topup with the TemanQRIS order.
      try {
        await fetch(`/api/topup/${localId}/link`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ order_id: orderId, amount: amt ?? 0 }),
        });
      } catch {
        // The webhook may have already linked it. Polling will pick up the status.
      }

      // Clean the URL.
      window.history.replaceState({}, "", window.location.pathname);
      return true;
    },
    [token],
  );

  // On mount: check for callback params in the URL (popup redirect or main page redirect).
  useEffect(() => {
    if (callbackHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("order_id") && params.get("local_id")) {
      callbackHandled.current = true;
      void processCallback(params);
    }
  }, [processCallback]);

  // Listen for postMessage from the payment popup.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "temanqris-callback") return;
      const { localId, orderId, amount, status } = event.data;
      if (!localId || !orderId) return;

      setTopupId(localId);
      setPaymentAmount(amount ? Number(amount) : undefined);
      setPaymentStatus(status ?? "pending");
      setPhase("linking");

      // Link the local topup with the TemanQRIS order, then start polling.
      (async () => {
        try {
          await fetch(`/api/topup/${localId}/link`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ order_id: orderId, amount: amount ? Number(amount) : 0 }),
          });
        } catch {
          // Webhook may have already processed it.
        }
        setPhase("polling");
      })();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [token]);

  // ── Polling: check transaction status from the backend ───────────────────
  useEffect(() => {
    if (phase !== "polling" || !topupId || !token) return;

    let cancelled = false;
    const startTime = Date.now();

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startTime > MAX_POLL_MS) {
        setPaymentStatus("expired");
        setPhase("done");
        return;
      }

      try {
        const res = await fetch(`/api/topup/${encodeURIComponent(topupId)}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await res.json();
        if (cancelled || !res.ok) return;

        setPaymentStatus(result.status);
        if (result.amount != null && result.amount > 0) setPaymentAmount(result.amount);

        if (isPaidStatus(result.status)) {
          toast({ title: "Top Up Berhasil!", description: "Saldo wallet telah ditambahkan." });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          setPhase("done");
          return;
        }
        if (isFinalStatus(result.status)) {
          setPhase("done");
          return;
        }
      } catch {
        // Network error — retry on next interval.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, topupId, token, toast, queryClient]);

  // Refresh balance when window regains focus (user returns from popup).
  useEffect(() => {
    const handleFocus = () => queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient]);

  // ── Start top up: create local transaction, then show widget ──────────────
  const handleStartTopup = async () => {
    if (phase === "preparing") return;
    setPhase("preparing");
    try {
      const res = await fetch("/api/topup/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal membuat transaksi.");
      setTopupId(data.id);
      setPaymentStatus("pending");
      setPaymentAmount(undefined);
      setPhase("ready");
    } catch (err: any) {
      setPhase("idle");
      toast({
        title: "Gagal memulai top up",
        description: err?.message ?? "Silakan coba lagi.",
        variant: "destructive",
      });
    }
  };

  const handleCloseOverlay = () => {
    setPhase("idle");
    setTopupId(null);
    setPaymentStatus("pending");
    setPaymentAmount(undefined);
  };

  // Build the callback URL with the local topup ID so the popup redirect
  // includes it alongside TemanQRIS's own query params.
  const callbackUrl = topupId
    ? `${window.location.origin}/topup?local_id=${encodeURIComponent(topupId)}`
    : undefined;

  return (
    <ProtectedRoute>
      <AppLayout>
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
            <p data-testid="text-topup-description" className="mt-2 max-w-md text-sm font-medium leading-relaxed text-slate-500">Tekan tombol di bawah ini untuk menambah saldo wallet kamu.</p>
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

        {/* Top Up section — widget above payment options */}
        <section className="mx-auto mt-5 max-w-5xl px-4 md:px-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-[28px] border border-violet-100 bg-white p-6 shadow-[0_10px_35px_rgba(85,65,140,0.07)] md:p-7"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-violet-500">Top Up Sekarang</p>
                <h2 className="mt-1 text-xl font-extrabold text-slate-900">Top Up Wallet</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  {phase === "idle" && "Tekan tombol di bawah untuk memulai top up via QRIS."}
                  {phase === "preparing" && "Menyiapkan pembayaran..."}
                  {phase === "ready" && "Tekan tombol QRIS di bawah, lalu masukkan nominal dan bayar."}
                  {phase === "linking" && "Memproses pembayaran..."}
                  {phase === "polling" && "Menunggu konfirmasi pembayaran..."}
                  {phase === "done" && "Top up selesai."}
                </p>
              </div>
              <div className="rounded-2xl bg-violet-50 p-3 text-violet-600"><QrCode className="h-5 w-5" /></div>
            </div>

            {phase === "idle" && (
              <button
                data-testid="button-topup-start"
                onClick={handleStartTopup}
                className="h-12 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-sm font-extrabold tracking-widest text-white shadow-lg transition hover:opacity-90"
              >
                TOP UP SEKARANG
              </button>
            )}

            {phase === "preparing" && (
              <div className="flex h-12 items-center justify-center rounded-2xl bg-violet-50 text-sm font-bold text-violet-600">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Menyiapkan...
              </div>
            )}

            {(phase === "ready" || phase === "linking" || phase === "polling") && callbackUrl && (
              <>
                <TemanQrisWidget
                  merchantId={MERCHANT_ID}
                  userId={user?.id}
                  callbackUrl={callbackUrl}
                  buttonText="Bayar dengan QRIS"
                  buttonColor="#7C3AED"
                />
                {(phase === "linking" || phase === "polling") && (
                  <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-violet-50 py-3 text-xs font-bold text-violet-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {phase === "linking" ? "Memproses pembayaran..." : "Menunggu konfirmasi dari server..."}
                  </div>
                )}
              </>
            )}

            {phase === "done" && (
              <button
                onClick={handleCloseOverlay}
                className="h-12 w-full rounded-2xl border border-violet-200 bg-violet-50 text-sm font-extrabold text-violet-700 transition hover:bg-violet-100"
              >
                Top Up Lagi
              </button>
            )}
          </motion.div>
        </section>

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
                <div key={method.id} data-testid={`payment-method-${method.id}`} className="flex h-10 items-center justify-center rounded-xl border border-slate-100 bg-slate-50 px-1.5 opacity-80">
                  <span className="truncate text-center text-[9px] font-extrabold leading-tight sm:text-[10px]" style={{ color: method.color }}>{method.label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Status overlay during polling/linking phase */}
        {(phase === "polling" || phase === "linking") && (
          <StatusOverlay
            status={paymentStatus}
            amount={paymentAmount}
            onClose={handleCloseOverlay}
          />
        )}
      </AppLayout>
    </ProtectedRoute>
  );
}
