import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { getGetMeQueryKey, getListMyTopupsQueryKey } from "@workspace/api-client-react";
import {
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  QrCode,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";

// TemanQRIS embed widget. The merchant ID is safe to expose on the frontend
// (payments are processed by TemanQRIS' servers). `data-amount` is left unset so
// the user enters the nominal inside the widget bubble itself.
const TEMANQRIS_MERCHANT_ID = "MQECF85EABA6";

const TOPUP_STEPS = [
  { title: "Buka Widget Top Up", description: "Tekan tombol 'Top Up' di bawah untuk membuka widget QRIS.", Icon: ExternalLink },
  { title: "Masukkan Nominal", description: "Pilih nominal top up yang kamu inginkan di dalam widget QRIS.", Icon: Wallet },
  { title: "Scan Kode QRIS", description: "Buka aplikasi pembayaran yang kamu gunakan, lalu scan kode QRIS yang muncul.", Icon: QrCode },
  { title: "Konfirmasi Pembayaran", description: "Periksa kembali nominal dan detail pembayaran, lalu konfirmasi pembayaran di aplikasi kamu.", Icon: CheckCircle2 },
  { title: "Saldo Berhasil Ditambahkan", description: "Setelah pembayaran dikonfirmasi, saldo akan otomatis masuk ke akun kamu.", Icon: Wallet },
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

declare global {
  interface Window {
    temanqrisWidget?: {
      open: () => void;
      close: () => void;
      currentOrder?: { order_id?: string; amount?: number; link_code?: string } | null;
    };
  }
}

export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [widgetReady, setWidgetReady] = useState(false);
  const watchRef = useRef<number | null>(null);
  const registeredRef = useRef<string | null>(null);

  // Load the TemanQRIS widget script once.
  useEffect(() => {
    // Hide the widget's auto-rendered trigger button — we drive the widget from
    // our own "Top Up" button via window.temanqrisWidget.open().
    const style = document.createElement("style");
    style.textContent = ".temanqris-widget-btn { display: none !important; }";
    document.head.appendChild(style);

    if (document.querySelector("script[data-temanqris-widget]")) {
      setWidgetReady(!!window.temanqrisWidget);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://temanqris.com/widget.js";
    script.setAttribute("data-temanqris-widget", "true");
    script.setAttribute("data-merchant", TEMANQRIS_MERCHANT_ID);
    // data-amount intentionally omitted — the user inputs the amount in the widget.
    script.setAttribute("data-button-text", "Top Up");
    script.setAttribute("data-button-color", "#7c3aed");
    script.setAttribute("data-webhook", `${window.location.origin}/api/webhooks/temanqris`);
    script.async = true;
    script.onload = () => setWidgetReady(!!window.temanqrisWidget);
    script.onerror = () =>
      toast({ title: "Gagal memuat widget QRIS", description: "Periksa koneksi internet kamu.", variant: "destructive" });
    document.body.appendChild(script);

    return () => {
      if (watchRef.current) window.clearInterval(watchRef.current);
    };
  }, [toast]);

  const refreshAfterPaid = () => {
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
  };

  // After the widget generates a QRIS order, register it against this user so
  // the TemanQRIS webhook (or an admin) can credit the wallet.
  const registerOrder = async (orderId: string, amount: number) => {
    if (!token || registeredRef.current === orderId) return;
    registeredRef.current = orderId;
    try {
      await fetch("/api/topup/register-widget-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId, amount }),
      });
    } catch {
      // Non-fatal: the admin can still reconcile this order manually.
    }
  };

  const handleTopup = () => {
    if (!window.temanqrisWidget) {
      toast({ title: "Widget belum siap", description: "Mohon tunggu sebentar lalu coba lagi.", variant: "destructive" });
      return;
    }
    registeredRef.current = null;
    window.temanqrisWidget.open();

    // While the widget bubble is open: register the generated order once, and
    // refresh the balance so it updates after the webhook credits the wallet.
    if (watchRef.current) window.clearInterval(watchRef.current);
    let wasOpen = true;
    watchRef.current = window.setInterval(async () => {
      const active = !!document.querySelector(".temanqris-modal-overlay.active");
      if (!active && wasOpen) {
        wasOpen = false;
        if (watchRef.current) window.clearInterval(watchRef.current);
        watchRef.current = null;
        refreshAfterPaid();
        return;
      }
      const order = window.temanqrisWidget?.currentOrder;
      if (order?.order_id && order.amount) {
        await registerOrder(String(order.order_id), Number(order.amount));
      }
      refreshAfterPaid();
    }, 3000);
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="relative overflow-hidden bg-[#f7f5ff] px-5 pb-7 pt-8 md:px-8 md:pt-10">
          <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-pink-200/60" />
          <div className="pointer-events-none absolute bottom-0 left-1/2 h-20 w-20 rounded-full bg-blue-200/50" />
          <div className="relative mx-auto max-w-5xl">
            <div className="mb-5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-violet-500">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm">
                <QrCode className="h-4 w-4" />
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
              <p className="mt-1 max-w-sm text-sm font-medium text-white/80">Tekan tombol di bawah ini, masukkan nominal di widget QRIS, lalu selesaikan pembayaran.</p>
              <div className="mt-5">
                <Button
                  data-testid="button-topup"
                  type="button"
                  onClick={handleTopup}
                  disabled={!widgetReady}
                  className="h-12 w-full rounded-2xl bg-white px-8 text-sm font-extrabold tracking-widest text-violet-700 shadow-lg hover:bg-violet-50 disabled:opacity-60 sm:w-auto"
                >
                  {!widgetReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <>TOP UP <ArrowUpRight className="ml-1 h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </AppLayout>
    </ProtectedRoute>
  );
}
