import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import {
  useCreateAutomaticTopup,
  getGetMeQueryKey,
  getListMyTopupsQueryKey,
} from "@workspace/api-client-react";
import type { AutomaticTopup } from "@workspace/api-client-react";
import {
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  Shield,
  Sparkles,
  X,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const MIN_TOPUP = 100;
const MAX_TOPUP = 1_000_000;
const POLL_INTERVAL_MS = 4_000;

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

function isPaidStatus(status: string | undefined): boolean {
  return status === "paid" || status === "confirmed";
}

/**
 * TemanQRIS payment overlay.
 *
 * The hosted TemanQRIS payment page (https://temanqris.com/p/{link_code}) sets
 * `X-Frame-Options: SAMEORIGIN`, so it cannot be embedded in an iframe. It is
 * opened in a popup window instead, while this modal stays as the in-page
 * status overlay. The wallet is NEVER credited from the frontend — only the
 * server-side webhook may credit the balance. This modal only polls the
 * backend status endpoint to update the UI.
 */
function PaymentModal({
  open,
  onClose,
  topup,
  checking,
  onCheck,
  onOpenPayment,
}: {
  open: boolean;
  onClose: () => void;
  topup: AutomaticTopup | null;
  checking: boolean;
  onCheck: () => void;
  onOpenPayment: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            className="fixed inset-0 z-[100] flex items-end justify-center pointer-events-none sm:items-center sm:px-4"
          >
            <div className="pointer-events-auto w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-sm sm:rounded-3xl">
              <div className="flex items-center justify-between bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20">
                    <QrCode className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold">Top Up QRIS</h3>
                    <p className="text-xs text-white/75">
                      {topup ? `Rp ${topup.amount.toLocaleString("id-ID")}` : "Menyiapkan..."}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20" aria-label="Tutup">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                {!topup ? (
                  <div className="py-10 text-center">
                    <Loader2 className="mx-auto mb-3 h-9 w-9 animate-spin text-violet-600" />
                    <p className="text-sm font-extrabold text-slate-700">Membuat pembayaran QRIS...</p>
                    <p className="mt-1 text-xs text-slate-400">Mohon tunggu sebentar</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 text-center">
                      <QrCode className="mx-auto mb-2 h-9 w-9 text-violet-500" />
                      <p className="text-sm font-extrabold text-slate-700">Selesaikan Pembayaran</p>
                      <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                        Jendela pembayaran QRIS telah dibuka. Selesaikan pembayaran di sana, lalu tekan tombol di bawah.
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={onOpenPayment}
                      className="h-11 w-full rounded-2xl gap-1.5 text-xs font-extrabold"
                    >
                      <ExternalLink className="h-4 w-4" /> Buka Ulang Pembayaran
                    </Button>

                    <Button
                      type="button"
                      onClick={onCheck}
                      disabled={checking}
                      className="h-11 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-xs font-extrabold text-white"
                    >
                      {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Saya Sudah Bayar
                    </Button>

                    <div className="flex items-start gap-2.5 rounded-2xl bg-slate-50 px-4 py-3">
                      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                      <p className="text-[11px] font-medium leading-snug text-slate-500">
                        Saldo bertambah otomatis setelah pembayaran terverifikasi oleh sistem. Jangan menutup jendela sebelum pembayaran selesai.
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
  const queryClient = useQueryClient();
  const createTopup = useCreateAutomaticTopup();

  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [activeTopup, setActiveTopup] = useState<AutomaticTopup | null>(null);
  const [checking, setChecking] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const refreshAfterPaid = () => {
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "");
    setAmount(digits);
    if (amountError) setAmountError(null);
  };

  const openPopup = (url: string) => {
    const w = 420;
    const h = 720;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    popupRef.current = window.open(url, "temanqris-pay", `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  };

  const startTopup = () => {
    const amt = parseInt(amount, 10);
    if (!Number.isInteger(amt) || amt < MIN_TOPUP || amt > MAX_TOPUP) {
      setAmountError(`Nominal minimal Rp ${MIN_TOPUP.toLocaleString("id-ID")} dan maksimal Rp ${MAX_TOPUP.toLocaleString("id-ID")}.`);
      return;
    }
    setAmountError(null);

    // Open the popup synchronously so popup blockers don't interfere, then
    // navigate it to the hosted payment URL once the backend returns it.
    const popup = window.open("", "temanqris-pay", "width=420,height=720");
    popupRef.current = popup;

    setWidgetOpen(true);
    setActiveTopup(null);
    createTopup.mutate(
      { data: { amount: amt } },
      {
        onSuccess: (created: AutomaticTopup) => {
          setActiveTopup(created);
          if (popup && created.paymentLink) {
            popup.location.href = created.paymentLink;
          } else if (!created.paymentLink) {
            popup?.close();
          }
        },
        onError: (error: any) => {
          popup?.close();
          setWidgetOpen(false);
          toast({
            title: "Top Up gagal",
            description: error?.message ?? "Top Up sementara tidak tersedia. Silakan coba lagi.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const closeWidget = () => {
    setWidgetOpen(false);
    if (activeTopup && isPaidStatus(activeTopup.status)) {
      setActiveTopup(null);
    }
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
      if (isPaidStatus(result.status)) {
        toast({ title: "Top up berhasil!", description: "Saldo kamu sudah bertambah otomatis." });
        refreshAfterPaid();
        setWidgetOpen(false);
        popupRef.current?.close();
      } else if (result.status === "expired" || result.status === "failed") {
        toast({ title: "Pembayaran gagal", description: "Silakan coba lagi.", variant: "destructive" });
      } else if (result.status === "awaiting_confirmation") {
        toast({ title: "Pembayaran sedang diverifikasi", description: "Saldo akan diperbarui setelah pembayaran dikonfirmasi." });
      } else {
        toast({ title: "Belum ada pembayaran", description: "Pembayaran belum terdeteksi. Coba lagi beberapa saat." });
      }
    } catch (error: any) {
      toast({ title: "Gagal memeriksa pembayaran", description: error?.message ?? "Silakan coba lagi.", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  // Poll the backend status while the payment overlay is open. The backend is
  // the single source of truth — it only reports "paid" after the TemanQRIS
  // webhook credits the wallet.
  useEffect(() => {
    if (!widgetOpen || !activeTopup?.id || !token) return;
    if (isPaidStatus(activeTopup.status)) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/topup/${encodeURIComponent(activeTopup.id)}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await response.json();
        if (cancelled || !response.ok) return;
        setActiveTopup(result);
        if (isPaidStatus(result.status)) {
          toast({ title: "Top up berhasil!", description: "Saldo kamu sudah bertambah otomatis." });
          refreshAfterPaid();
          setWidgetOpen(false);
          popupRef.current?.close();
        }
      } catch {
        // Retry on next interval if the network is temporarily unavailable.
      }
    };

    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [widgetOpen, activeTopup?.id, activeTopup?.status, token]);

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

        <section className="mx-auto mb-7 max-w-5xl px-4 md:px-8">
          <div className="relative overflow-hidden rounded-[30px] bg-gradient-to-r from-violet-600 via-fuchsia-500 to-blue-500 p-6 shadow-[0_18px_45px_rgba(109,82,214,0.22)] md:p-8">
            <div className="pointer-events-none absolute right-8 top-[-40px] h-32 w-32 rounded-full border-[16px] border-white/10" />
            <div className="relative z-10 text-white">
              <h2 className="text-2xl font-extrabold">Top Up Wallet</h2>
              <p className="mt-1 max-w-sm text-sm font-medium text-white/80">Tekan tombol di bawah ini untuk menambah saldo wallet kamu.</p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-extrabold text-white/60">Rp</span>
                  <input
                    data-testid="input-topup-amount"
                    inputMode="numeric"
                    value={amount ? Number(amount).toLocaleString("id-ID") : ""}
                    onChange={handleAmountChange}
                    placeholder="0"
                    className="h-12 w-full rounded-2xl border border-white/20 bg-white/15 pl-11 pr-4 text-lg font-extrabold text-white outline-none placeholder:text-white/40 focus:border-white/40 focus:bg-white/25"
                  />
                </div>
                <Button
                  data-testid="button-topup"
                  type="button"
                  onClick={startTopup}
                  disabled={createTopup.isPending}
                  className="h-12 rounded-2xl bg-white px-8 text-sm font-extrabold tracking-widest text-violet-700 shadow-lg hover:bg-violet-50 disabled:opacity-60 sm:w-auto"
                >
                  {createTopup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>TOP UP <ArrowUpRight className="ml-1 h-4 w-4" /></>}
                </Button>
              </div>
              {amountError && <p className="mt-2 text-xs font-bold text-red-200">{amountError}</p>}
            </div>
          </div>
        </section>

        <PaymentModal
          open={widgetOpen}
          onClose={closeWidget}
          topup={activeTopup}
          checking={checking}
          onCheck={checkPayment}
          onOpenPayment={() => activeTopup?.paymentLink && openPopup(activeTopup.paymentLink)}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}
