import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, ImageIcon, ExternalLink, CheckCircle2, Clock, AlertCircle, XCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateAutomaticTopup } from "@workspace/api-client-react";
import { getGetMeQueryKey, getListMyTopupsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/admin-api";

type ModalState = "creating" | "qr" | "processing" | "paid" | "error";
type ConfirmState = "idle" | "checking" | "paid" | "awaiting_payment" | "verification_failed" | "system_error" | "verifying";

export function QrisTopupModal({
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
  const createTopup = useCreateAutomaticTopup();

  const [state, setState] = useState<ModalState>("creating");
  const [topupId, setTopupId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [serviceFee, setServiceFee] = useState<number>(0);
  const [totalAmount, setTotalAmount] = useState<number>(amount);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>("idle");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  const reset = useCallback(() => {
    setState("creating");
    setTopupId(null);
    setQrImage(null);
    setPaymentLink(null);
    setServiceFee(0);
    setTotalAmount(amount);
    setErrorMsg(null);
    setConfirmState("idle");
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  // ── Create QRIS payment when modal opens with an amount ─────────────────
  useEffect(() => {
    if (!open || !amount) return;
    let cancelled = false;
    setState("creating");
    setErrorMsg(null);

    createTopup.mutateAsync({ data: { amount } })
      .then((res: any) => {
        if (cancelled) return;
        setTopupId(res.id);
        setQrImage(res.qrCodeUrl ?? null);
        setPaymentLink(res.paymentLink ?? null);
        setServiceFee(res.serviceFee ?? 0);
        setTotalAmount(res.totalAmount ?? amount);
        setState("qr");
      })
      .catch((err: any) => {
        if (cancelled) return;
        setErrorMsg(err?.message ?? "Gagal membuat QRIS.");
        setState("error");
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, amount]);

  // ── Poll for payment status ──────────────────────────────────────────────
  useEffect(() => {
    if (!topupId || state !== "qr") return;
    let active = true;

    const poll = async () => {
      try {
        const token = getToken();
        const res = await fetch(`/api/topup/${topupId}/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!active) return;
        if (data.paid || data.status === "paid" || data.status === "confirmed") {
          setState("paid");
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
          toast({
            title: "Top Up Berhasil!",
            description: `Saldo bertambah ${fmtRp(amount)}.`,
          });
        }
      } catch {
        /* keep polling */
      }
    };

    // Initial check after a short delay, then every 3s
    pollingRef.current = setInterval(poll, 3000);

    return () => {
      active = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topupId, state]);

  // ── "Sudah Bayar" — user confirms they've paid; backend verifies ────────
  // The backend polls TemanQRIS getOrder() for up to ~12s. Error responses
  // are differentiated so the frontend shows the correct message instead of
  // always saying "belum terdeteksi".
  const handleConfirmPaid = useCallback(async () => {
    if (!topupId || confirmState === "checking") return;
    setConfirmState("checking");
    try {
      const token = getToken();
      const res = await fetch(`/api/topup/${topupId}/confirm-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));

      if (data.success && data.status === "paid") {
        setConfirmState("paid");
        setState("paid");
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
        toast({
          title: "Pembayaran Berhasil!",
          description: `Saldo Rp ${fmtRp(data.amount ?? amount)} telah ditambahkan.`,
        });
      } else if (data.status === "awaiting_payment") {
        // Distinguish "payment still pending" from "system/gateway error"
        if (data.errorType === "system_error") {
          setConfirmState("system_error");
          toast({
            title: "Terjadi kesalahan sistem",
            description: "Silakan coba lagi.",
            variant: "destructive",
          });
        } else {
          // Payment not yet detected — the background job will keep checking.
          setConfirmState("verifying");
          toast({
            title: "Pembayaran sedang diverifikasi",
            description: "Jika kamu sudah membayar, sistem akan terus memproses pembayaran setelah transaksi terkonfirmasi.",
          });
        }
      } else {
        // verification_failed (400) or unexpected non-2xx
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status >= 500) {
          setConfirmState("system_error");
          toast({
            title: "Terjadi kesalahan sistem",
            description: "Silakan coba lagi.",
            variant: "destructive",
          });
        } else {
          setConfirmState("verification_failed");
          toast({
            title: "Pembayaran gagal diverifikasi",
            description: "Pastikan pembayaran dilakukan menggunakan QRIS yang ditampilkan. Saldo belum ditambahkan.",
            variant: "destructive",
          });
        }
      }
    } catch {
      // Network error — don't say "belum dibayar"
      setConfirmState("system_error");
      toast({
        title: "Terjadi kesalahan sistem",
        description: "Silakan coba lagi.",
        variant: "destructive",
      });
    }
  }, [topupId, confirmState, amount, queryClient, toast]);

  // ── "Cek Lagi" — re-check payment status after "belum terdeteksi" ──────
  const handleCheckAgain = useCallback(async () => {
    if (!topupId || confirmState === "checking") return;
    setConfirmState("checking");
    try {
      const token = getToken();
      const res = await fetch(`/api/topup/${topupId}/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));

      if (data.paid || data.status === "paid" || data.status === "confirmed") {
        setConfirmState("paid");
        setState("paid");
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
        toast({
          title: "Pembayaran Berhasil!",
          description: `Saldo Rp ${fmtRp(amount)} telah ditambahkan.`,
        });
      } else if (res.status >= 500 || res.status === 404) {
        setConfirmState("system_error");
        toast({
          title: "Terjadi kesalahan sistem",
          description: "Silakan coba lagi.",
          variant: "destructive",
        });
      } else {
        setConfirmState("verifying");
        toast({
          title: "Pembayaran sedang diverifikasi",
          description: "Jika kamu sudah membayar, sistem akan terus memproses pembayaran setelah transaksi terkonfirmasi.",
        });
      }
    } catch {
      setConfirmState("system_error");
      toast({
        title: "Terjadi kesalahan sistem",
        description: "Silakan coba lagi.",
        variant: "destructive",
      });
    }
  }, [topupId, confirmState, amount, queryClient, toast]);

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
            {/* ── Header (purple) ─────────────────────────────────────────── */}
            <div
              className="relative px-5 py-5 text-white"
              style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
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
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <path d="M14 14h3v3M21 14v.01M17 21h4M21 17v4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-extrabold leading-tight">Bayar QRIS</h2>
                  <p className="text-xs font-medium text-white/80">QRIS · konfirmasi otomatis</p>
                </div>
              </div>
            </div>

            {/* ── Body ────────────────────────────────────────────────────── */}
            {state === "creating" && (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-8">
                <Loader2 className="h-10 w-10 animate-spin" style={{ color: "#7B4DFF" }} />
                <p className="mt-4 text-sm font-bold text-slate-500">Membuat QRIS…</p>
              </div>
            )}

            {state === "error" && (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <X className="h-8 w-8 text-red-500" />
                </div>
                <h3 className="mt-4 text-lg font-extrabold text-slate-700">Gagal membuat QRIS</h3>
                <p className="mt-2 max-w-xs text-sm font-medium text-slate-400">
                  {errorMsg ?? "Gateway QRIS belum dikonfigurasi. Hubungi admin."}
                </p>
                <button
                  onClick={handleClose}
                  className="mt-6 h-12 w-full rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
                >
                  Tutup
                </button>
              </div>
            )}

            {state === "paid" && (
              <div className="px-6 py-10 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-green-50"
                >
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                </motion.div>
                <h3 className="text-xl font-extrabold" style={{ color: "#4F2DAA" }}>
                  Top Up Berhasil!
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-sm font-medium text-slate-500">
                  Saldo sebesar {fmtRp(amount)} berhasil masuk ke akun Anda.
                </p>
                <button
                  onClick={handleClose}
                  className="mt-7 h-12 w-full rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
                >
                  Selesai
                </button>
              </div>
            )}

            {(state === "qr" || state === "processing") && (
              <div className="px-6 py-6">
                {/* Total */}
                <p className="text-center text-xs font-bold uppercase tracking-wider text-slate-400">
                  TOTAL BAYAR
                </p>
                <p className="mt-1 text-center text-3xl font-extrabold" style={{ color: "#4F2DAA" }}>
                  {fmtRp(totalAmount)}
                </p>

                {/* Fee breakdown */}
                {serviceFee > 0 && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Top Up</span>
                      <span className="font-bold text-slate-700">{fmtRp(amount)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Biaya layanan</span>
                      <span className="font-bold text-amber-600">{fmtRp(serviceFee)}</span>
                    </div>
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span style={{ color: "#263238" }}>Total pembayaran</span>
                        <span style={{ color: "#4F2DAA" }}>{fmtRp(totalAmount)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* QR code */}
                <div className="mt-5 flex justify-center">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    {qrImage ? (
                      <img
                        src={qrImage}
                        alt="QRIS"
                        className="h-48 w-48 object-contain"
                      />
                    ) : (
                      <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 text-center">
                        <ImageIcon className="h-10 w-10 text-slate-300" />
                        <p className="px-4 text-xs font-medium text-slate-400">
                          QR sedang dimuat…
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bayar Sekarang button (opens hosted payment page) */}
                {paymentLink && (
                  <a
                    href={paymentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90"
                    style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Bayar Sekarang
                  </a>
                )}

                {/* Sudah Bayar button — triggers backend verification */}
                <button
                  onClick={handleConfirmPaid}
                  disabled={confirmState === "checking"}
                  className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 text-sm font-extrabold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: "#7B4DFF",
                    color: "#7B4DFF",
                    background: "#F5F2FF",
                  }}
                >
                  {confirmState === "checking" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Memeriksa Pembayaran...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Sudah Bayar
                    </>
                  )}
                </button>

                {/* Inline result notification for "Sudah Bayar" */}
                {confirmState === "verifying" && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-amber-500" />
                    <div className="text-xs font-medium leading-snug">
                      <p className="font-bold text-amber-700">Pembayaran Sedang Diverifikasi</p>
                      <p className="text-amber-600">Jika kamu sudah membayar, sistem akan terus memproses pembayaran setelah transaksi terkonfirmasi.</p>
                    </div>
                  </div>
                )}
                {confirmState === "system_error" && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-red-50 px-4 py-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="text-xs font-medium leading-snug">
                      <p className="font-bold text-red-600">Terjadi Kesalahan Sistem</p>
                      <p className="text-red-500">Silakan coba lagi. Saldo belum ditambahkan.</p>
                    </div>
                  </div>
                )}
                {confirmState === "verification_failed" && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-red-50 px-4 py-3">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="text-xs font-medium leading-snug">
                      <p className="font-bold text-red-600">Pembayaran Gagal Diverifikasi</p>
                      <p className="text-red-500">Pastikan pembayaran dilakukan menggunakan QRIS yang ditampilkan. Saldo belum ditambahkan.</p>
                    </div>
                  </div>
                )}

                {/* "Cek Lagi" button — re-check payment after "belum terdeteksi" */}
                {confirmState === "verifying" && (
                  <button
                    onClick={handleCheckAgain}
                    className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border-2 text-sm font-bold transition active:scale-[0.98]"
                    style={{
                      borderColor: "#7B4DFF",
                      color: "#7B4DFF",
                      background: "#F5F2FF",
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Cek Lagi
                  </button>
                )}
                {confirmState === "system_error" && (
                  <button
                    onClick={handleConfirmPaid}
                    className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border-2 text-sm font-bold transition active:scale-[0.98]"
                    style={{
                      borderColor: "#7B4DFF",
                      color: "#7B4DFF",
                      background: "#F5F2FF",
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Coba Lagi
                  </button>
                )}

                {/* Status indicator */}
                <div className="mt-4 flex items-center justify-center gap-2 text-xs font-medium text-slate-400">
                  <Clock className="h-3.5 w-3.5 animate-pulse" />
                  Menunggu pembayaran — konfirmasi otomatis setelah bayar
                </div>

                {/* Footer info */}
                <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-[#F5F2FF] px-4 py-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  <p className="text-xs font-medium leading-snug" style={{ color: "#4F2DAA" }}>
                    <span className="font-bold">Pembayaran otomatis.</span>{" "}
                    <span className="text-slate-500">
                      Setelah pembayaran berhasil dikonfirmasi, saldo akan masuk otomatis. Tidak perlu upload bukti pembayaran.
                    </span>
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
