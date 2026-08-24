import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, ImageIcon, CheckCircle2, Clock, ShieldCheck, Upload, Camera,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, getListMyTopupsQueryKey } from "@workspace/api-client-react";
import { getToken } from "@/lib/admin-api";

type ManualState = "creating" | "qr" | "uploading" | "submitting" | "awaiting_review" | "error";

/**
 * Manual top-up modal — static QRIS + proof upload + admin approval.
 *
 * The user scans a static QRIS image (from settings), pays, uploads a proof
 * screenshot, and submits. The payment stays "pending" until an admin
 * confirms it via the dashboard. The wallet is only credited by
 * creditVerifiedTopup() on the backend — never by this modal.
 */
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
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  const reset = useCallback(() => {
    setState("creating");
    setTopupId(null);
    setQrisImage(null);
    setErrorMsg(null);
    setProofPreview(null);
    setProofFile(null);
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
        setQrisImage(createData.manualQrisImageUrl ?? null);
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

  // ── Handle proof file selection ──────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate image type
    if (!file.type.startsWith("image/")) {
      toast({ title: "File harus berupa gambar", variant: "destructive" });
      return;
    }
    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Ukuran file maksimal 10MB", variant: "destructive" });
      return;
    }

    setProofFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setProofPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  // ── Upload proof + submit ─────────────────────────────────────────────────
  const handleSubmitProof = useCallback(async () => {
    if (!topupId || !proofFile || state === "submitting") return;
    setState("submitting");
    try {
      const token = getToken();

      // Step 1: upload the proof image via the payment-proof endpoint
      setState("uploading");
      const formData = new FormData();
      formData.append("file", proofFile);
      const uploadRes = await fetch("/api/upload/payment-proof", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.url) {
        setErrorMsg(uploadData?.message ?? "Gagal mengupload bukti pembayaran.");
        setState("error");
        return;
      }

      // Step 2: attach the proof URL to the topup
      setState("submitting");
      const linkRes = await fetch(`/api/topup/${topupId}/upload-proof`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ proofImageUrl: uploadData.url }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) {
        setErrorMsg(linkData?.error ?? "Gagal mengirim bukti pembayaran.");
        setState("error");
        return;
      }

      setState("awaiting_review");
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
      toast({
        title: "Bukti Pembayaran Terkirim",
        description: "Pembayaran sedang diperiksa oleh admin.",
      });
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Terjadi kesalahan sistem.");
      setState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topupId, proofFile, state, queryClient, toast]);

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
                  Pembayaran Sedang Diperiksa
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-sm font-medium text-slate-500">
                  Bukti pembayaran Anda telah terkirim. Saldo sebesar{" "}
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

            {(state === "qr" || state === "uploading" || state === "submitting") && (
              <div className="max-h-[80vh] overflow-y-auto px-6 py-6">
                {/* Total */}
                <p className="text-center text-xs font-bold uppercase tracking-wider text-slate-400">
                  TOTAL BAYAR
                </p>
                <p className="mt-1 text-center text-3xl font-extrabold" style={{ color: "#059669" }}>
                  {fmtRp(amount)}
                </p>

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
                          QRIS manual belum tersedia.
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
                      Scan QRIS di atas, bayar sesuai nominal, lalu upload bukti
                      pembayaran. Saldo akan ditambahkan setelah admin
                      memverifikasi pembayaran Anda.
                    </span>
                  </p>
                </div>

                {/* ── Upload proof ─────────────────────────────────────────── */}
                <div className="mt-5">
                  <p className="text-sm font-extrabold" style={{ color: "#263238" }}>
                    Upload Bukti Pembayaran
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {proofPreview ? (
                    <div className="mt-3 relative">
                      <img
                        src={proofPreview}
                        alt="Bukti pembayaran"
                        className="w-full max-h-48 object-contain rounded-2xl border border-slate-200"
                      />
                      <button
                        onClick={() => { setProofFile(null); setProofPreview(null); }}
                        className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3 flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 transition hover:border-emerald-300 hover:bg-emerald-50/50"
                    >
                      <Camera className="h-8 w-8 text-slate-400" />
                      <p className="text-xs font-medium text-slate-500">
                        Pilih foto bukti pembayaran
                      </p>
                      <p className="text-[10px] text-slate-400">JPG, PNG, WEBP · maks 10MB</p>
                    </button>
                  )}
                </div>

                {/* Submit button */}
                <button
                  onClick={handleSubmitProof}
                  disabled={!proofFile || state === "submitting" || state === "uploading"}
                  className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)" }}
                >
                  {state === "uploading" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Mengupload Bukti...
                    </>
                  ) : state === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Mengirim Pembayaran...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Kirim Pembayaran
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
