import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, ImageIcon, CheckCircle2, Clock, AlertCircle, ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, getListMyTopupsQueryKey } from "@workspace/api-client-react";
import { getToken } from "@/lib/admin-api";

type ManualState = "creating" | "qr" | "submitting" | "awaiting_review" | "error";

export function ManualTopupModal({
  open,
  amount,
  onClose,
}: {
  open: boolean;
  amount: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [state, setState] = useState<ManualState>("creating");
  const [topupId, setTopupId] = useState<string | null>(null);
  const [qrisImage, setQrisImage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  const reset = useCallback(() => {
    setState("creating");
    setTopupId(null);
    setQrisImage(null);
    setErrorMsg(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  // ── Create manual topup + fetch static QRIS from settings ────────────────
  useEffect(() => {
    if (!open || !amount) return;
    let cancelled = false;
    setState("creating");
    setErrorMsg(null);

    (async () => {
      try {
        const token = getToken();

        // Create the manual topup record
        const createRes = await fetch("/api/topup/manual", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ amount }),
        });
        const createData = await createRes.json();
        if (cancelled) return;
        if (!createRes.ok) {
          setErrorMsg(createData?.error ?? "Gagal membuat top up manual.");
          setState("error");
          return;
        }
        setTopupId(createData.id);

        // Fetch the static QRIS image from settings
        const settingsRes = await fetch("/api/settings", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const settingsData = await settingsRes.json();
        if (cancelled) return;
        setQrisImage(settingsData?.qrisImage ?? null);
        setState("qr");
      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err?.message ?? "Terjadi kesalahan sistem.");
        setState("error");
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, amount]);

  // ── "Saya Sudah Bayar" — marks topup as awaiting_manual_review ───────────
  // This does NOT credit the wallet. It only sets the status so the admin
  // knows to review the payment. creditVerifiedTopup() is called only when
  // the admin confirms.
  const handleMarkPaid = useCallback(async () => {
    if (!topupId || state === "submitting") return;
    setState("submitting");
    try {
      const token = getToken();
      const res = await fetch(`/api/topup/${topupId}/mark-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setState("awaiting_review");
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
        toast({
          title: "Konfirmasi Terkirim",
          description: "Pembayaran Anda sedang menunggu verifikasi admin.",
        });
      } else {
        setErrorMsg(data?.error ?? "Gagal mengirim konfirmasi.");
        setState("error");
      }
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Terjadi kesalahan sistem.");
      setState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topupId, state, queryClient, toast]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:px-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ── Header (emerald for manual) ──────────────────────────────── */}
            <div
              className="relative px-5 py-5 text-white"
              style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)" }}
            >
              <button
                onClick={handleClose}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30"
                aria-label="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20">
                  <span className="text-2xl">🧾</span>
                </div>
                <div>
                  <h2 className="text-lg font-extrabold leading-tight">Top Up Manual</h2>
                  <p className="text-xs font-medium text-white/80">QRIS · verifikasi admin</p>
                </div>
              </div>
            </div>

            {/* ── Body ────────────────────────────────────────────────────── */}
            {state === "creating" && (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-8">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
                <p className="mt-4 text-sm font-bold text-slate-500">Menyiapkan top up…</p>
              </div>
            )}

            {state === "error" && (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <X className="h-8 w-8 text-red-500" />
                </div>
                <h3 className="mt-4 text-lg font-extrabold text-slate-700">Gagal</h3>
                <p className="mt-2 max-w-xs text-sm font-medium text-slate-400">
                  {errorMsg ?? "Terjadi kesalahan. Hubungi admin."}
                </p>
                <button
                  onClick={handleClose}
                  className="mt-6 h-12 w-full rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)" }}
                >
                  Tutup
                </button>
              </div>
            )}

            {state === "awaiting_review" && (
              <div className="px-6 py-10 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-blue-50"
                >
                  <Clock className="h-10 w-10 text-blue-500" />
                </motion.div>
                <h3 className="text-xl font-extrabold" style={{ color: "#1E40AF" }}>
                  Menunggu Verifikasi Admin
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-sm font-medium text-slate-500">
                  Konfirmasi pembayaran Anda telah terkirim. Saldo sebesar{" "}
                  {fmtRp(amount)} akan ditambahkan setelah admin memverifikasi
                  pembayaran Anda.
                </p>
                <button
                  onClick={handleClose}
                  className="mt-7 h-12 w-full rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)" }}
                >
                  Selesai
                </button>
              </div>
            )}

            {(state === "qr" || state === "submitting") && (
              <div className="px-6 py-6">
                {/* Total */}
                <p className="text-center text-xs font-bold uppercase tracking-wider text-slate-400">
                  TOTAL BAYAR
                </p>
                <p className="mt-1 text-center text-3xl font-extrabold" style={{ color: "#059669" }}>
                  {fmtRp(amount)}
                </p>

                {/* Fee breakdown */}
                <div className="mt-3 rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Top Up</span>
                    <span className="font-bold text-slate-700">{fmtRp(amount)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Biaya layanan</span>
                    <span className="font-bold text-emerald-600">{fmtRp(0)}</span>
                  </div>
                  <div className="mt-2 border-t border-slate-200 pt-2">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span style={{ color: "#263238" }}>Total pembayaran</span>
                      <span style={{ color: "#059669" }}>{fmtRp(amount)}</span>
                    </div>
                  </div>
                </div>

                {/* QR code (static from settings) */}
                <div className="mt-5 flex justify-center">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    {qrisImage ? (
                      <img
                        src={qrisImage}
                        alt="QRIS"
                        className="h-48 w-48 object-contain"
                      />
                    ) : (
                      <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 text-center">
                        <ImageIcon className="h-10 w-10 text-slate-300" />
                        <p className="px-4 text-xs font-medium text-slate-400">
                          QRIS belum diatur oleh admin. Hubungi admin.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Instructions */}
                <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-emerald-50 px-4 py-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <p className="text-xs font-medium leading-snug text-emerald-700">
                    <span className="font-bold">Pembayaran manual.</span>{" "}
                    <span className="text-emerald-600">
                      Scan QRIS di atas, bayar sesuai nominal, lalu tekan "Saya
                      Sudah Bayar". Saldo akan ditambahkan setelah admin
                      memverifikasi pembayaran Anda.
                    </span>
                  </p>
                </div>

                {/* Saya Sudah Bayar button */}
                <button
                  onClick={handleMarkPaid}
                  disabled={state === "submitting"}
                  className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)" }}
                >
                  {state === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Mengirim Konfirmasi...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Saya Sudah Bayar
                    </>
                  )}
                </button>

                {/* Status indicator */}
                <div className="mt-4 flex items-center justify-center gap-2 text-xs font-medium text-slate-400">
                  <Clock className="h-3.5 w-3.5" />
                  Saldo masuk setelah pembayaran diverifikasi admin
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
