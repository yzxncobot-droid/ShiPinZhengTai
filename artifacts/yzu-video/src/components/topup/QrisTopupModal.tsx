import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, UploadCloud, Check, ShieldCheck, Loader2, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateTopup } from "@workspace/api-client-react";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/admin-api";

type ModalState = "qr" | "uploading" | "submitting" | "waiting";

export function QrisTopupModal({
  open,
  amount,
  qrisImage,
  onClose,
}: {
  open: boolean;
  amount: number;
  qrisImage?: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTopup = useCreateTopup();

  const [state, setState] = useState<ModalState>("qr");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setState("qr");
    setProofUrl(null);
    setProofName(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  // ── Upload proof screenshot ──────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setState("uploading");
    try {
      const token = getToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/payment-proof", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) throw new Error(data?.message ?? "Upload gagal.");
      setProofUrl(data.url);
      setProofName(file.name);
      setState("qr");
      toast({ title: "Bukti transfer terunggah" });
    } catch (err: any) {
      setState("qr");
      toast({
        title: "Upload gagal",
        description: err?.message ?? "Silakan coba lagi.",
        variant: "destructive",
      });
    }
  };

  // ── Confirm: create the pending top-up ───────────────────────────────────
  const handleConfirm = async () => {
    if (!proofUrl) return;
    setState("submitting");
    try {
      await createTopup.mutateAsync({
        data: { amount, paymentProof: proofUrl, transferAmount: amount },
      });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setState("waiting");
      toast({ title: "Top up dikirim", description: "Menunggu persetujuan owner." });
    } catch (err: any) {
      setState("qr");
      toast({
        title: "Gagal mengirim top up",
        description: err?.message ?? "Silakan coba lagi.",
        variant: "destructive",
      });
    }
  };

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
                  <p className="text-xs font-medium text-white/80">QRIS hanya berlaku sekali</p>
                </div>
              </div>
            </div>

            {/* ── Body ────────────────────────────────────────────────────── */}
            {state === "waiting" ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#F5F2FF]">
                  <ShieldCheck className="h-8 w-8" style={{ color: "#4F2DAA" }} />
                </div>
                <h3 className="text-lg font-extrabold" style={{ color: "#4F2DAA" }}>
                  Menunggu persetujuan owner
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-sm font-medium text-slate-500">
                  Setelah pembayaran dikonfirmasi owner, saldo akan otomatis masuk ke akun Anda.
                </p>
                <button
                  onClick={handleClose}
                  className="mt-7 h-12 w-full rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
                >
                  Selesai
                </button>
              </div>
            ) : (
              <div className="px-6 py-6">
                {/* Total */}
                <p className="text-center text-xs font-bold uppercase tracking-wider text-slate-400">
                  TOTAL BAYAR
                </p>
                <p className="mt-1 text-center text-3xl font-extrabold" style={{ color: "#4F2DAA" }}>
                  {fmtRp(amount)}
                </p>

                {/* QR code */}
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
                          QRIS belum dikonfigurasi. Owner dapat mengunggahnya di Pengaturan.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload section */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-5 flex w-full items-center gap-3 rounded-2xl border-2 border-dashed p-4 text-left transition hover:bg-[#F5F2FF]"
                  style={{ borderColor: "#7B4DFF" }}
                  disabled={state === "uploading"}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F5F2FF]">
                    {state === "uploading" ? (
                      <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#7B4DFF" }} />
                    ) : (
                      <UploadCloud className="h-5 w-5" style={{ color: "#7B4DFF" }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold" style={{ color: "#4F2DAA" }}>
                      Upload Bukti Transfer
                    </p>
                    <p className="truncate text-xs font-medium text-slate-400">
                      {proofName
                        ? state === "uploading"
                          ? "Mengunggah..."
                          : proofName
                        : "Upload screenshot bukti transfer Anda"}
                    </p>
                  </div>
                  {proofUrl && state !== "uploading" && (
                    <Check className="h-5 w-5 shrink-0 text-green-500" />
                  )}
                </button>

                {/* Confirm button */}
                <button
                  onClick={handleConfirm}
                  disabled={!proofUrl || state === "submitting"}
                  className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
                >
                  {state === "submitting" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Check className="h-5 w-5" />
                      Confirm
                    </>
                  )}
                </button>

                {/* Footer info */}
                <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-[#F5F2FF] px-4 py-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#4F2DAA" }} />
                  <p className="text-xs font-medium leading-snug" style={{ color: "#4F2DAA" }}>
                    <span className="font-bold">Menunggu persetujuan owner.</span>{" "}
                    <span className="text-slate-500">
                      Setelah pembayaran dikonfirmasi owner, saldo akan otomatis masuk ke akun Anda.
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
