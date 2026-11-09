import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Loader2,
  ImageIcon,
  Upload,
  CheckCircle2,
  AlertCircle,
  Download,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { getGetMeQueryKey, getListMyTopupsQueryKey } from "@workspace/api-client-react";
import { getToken } from "@/lib/admin-api";
import { Link } from "wouter";

const MIN_TOPUP = 100;
const MAX_TOPUP = 1_000_000;

const PAYMENT_METHODS = [
  { name: "BCA", bg: "bg-[#005faa] text-white" },
  { name: "Mandiri", bg: "bg-[#002855] text-amber-400" },
  { name: "BNI", bg: "bg-[#f15a24] text-white" },
  { name: "BRI", bg: "bg-[#00529c] text-white" },
  { name: "GoPay", bg: "bg-[#00aed6] text-white" },
  { name: "OVO", bg: "bg-[#4c3494] text-white" },
  { name: "DANA", bg: "bg-[#118eea] text-white" },
  { name: "ShopeePay", bg: "bg-[#ee4d2d] text-white" },
  { name: "LinkAja", bg: "bg-[#e31e24] text-white" },
];

export function ManualTopupModal({
  open,
  initialAmount,
  onClose,
}: {
  open: boolean;
  initialAmount?: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState<number>(initialAmount || 10_000);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  const { data: qrisData, isLoading: loadingQris } = useQuery({
    queryKey: ["settings-qris"],
    queryFn: async () => {
      const res = await fetch("/api/settings/qris");
      if (!res.ok) throw new Error("Gagal mengambil info QRIS");
      return res.json() as Promise<{ qrisImage: string | null; minTopup: number; maxTopup: number }>;
    },
    enabled: open,
  });

  const activeQrisImage = qrisData?.qrisImage ?? null;

  useEffect(() => {
    if (initialAmount) {
      setAmount(initialAmount);
    }
  }, [initialAmount]);

  const handleClose = () => {
    setProofFile(null);
    setProofPreview(null);
    setIsSubmitting(false);
    setSubmittedSuccess(false);
    setErrorMessage(null);
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Format Tidak Didukung",
        description: "Gunakan format JPG, JPEG, PNG, atau WEBP.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Terlalu Besar",
        description: "Ukuran bukti transfer maksimal 5MB.",
        variant: "destructive",
      });
      return;
    }

    setProofFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setProofPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setErrorMessage(null);
  };

  const handleDownloadQR = async () => {
    if (!activeQrisImage) return;
    try {
      const response = await fetch(activeQrisImage);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qris-kidzoo.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(activeQrisImage, "_blank");
    }
  };

  const handleSubmit = async () => {
    if (!amount || amount < MIN_TOPUP || amount > MAX_TOPUP) {
      setErrorMessage(`Nominal harus antara ${fmtRp(MIN_TOPUP)} dan ${fmtRp(MAX_TOPUP)}.`);
      return;
    }

    if (!proofFile) {
      setErrorMessage("Silakan upload bukti transfer terlebih dahulu.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const token = getToken();

      const formData = new FormData();
      formData.append("file", proofFile);

      const uploadRes = await fetch("/api/upload/payment-proof", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.url) {
        throw new Error(uploadData.message || "Gagal mengunggah foto bukti pembayaran.");
      }

      const submitRes = await fetch("/api/topup/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount,
          proofImageUrl: uploadData.url,
        }),
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(submitData.error || submitData.message || "Gagal membuat permintaan top up.");
      }

      setSubmittedSuccess(true);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey() });
      toast({
        title: "Top Up Berhasil Diajukan 🎉",
        description: "Menunggu verifikasi manual oleh Admin/Owner.",
      });
    } catch (err: any) {
      setErrorMessage(err.message || "Terjadi kesalahan saat memproses transaksi.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[460px] overflow-hidden rounded-3xl bg-[#0f172a] text-slate-100 shadow-2xl border border-slate-800 my-auto"
          >
            {/* ── Modal Header ── */}
            <div className="flex items-center justify-between border-b border-slate-800/80 px-6 py-4">
              <h2 className="text-lg font-bold text-white tracking-tight">Pembayaran QRIS</h2>
              <button
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
                aria-label="Tutup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* ── Modal Content ── */}
            <div className="max-h-[82vh] overflow-y-auto px-6 py-5 space-y-4">
              {submittedSuccess ? (
                <div className="py-8 text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  >
                    <CheckCircle2 className="h-10 w-10" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-white">
                    Permintaan Top Up Terkirim!
                  </h3>
                  <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 text-left space-y-2 text-xs text-slate-300">
                    <p className="font-bold flex items-center gap-1.5 text-amber-400 text-sm">
                      <Info className="h-4 w-4" /> Status: Menunggu Verifikasi Admin
                    </p>
                    <p className="leading-relaxed">
                      Bukti transfer sebesar <strong className="text-white">{fmtRp(amount)}</strong> berhasil dikirim.
                      Admin akan segera memverifikasi transaksi Anda. Saldo wallet akan bertambah otomatis setelah disetujui.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2.5 pt-3">
                    <Link href="/history">
                      <button
                        onClick={handleClose}
                        className="h-12 w-full rounded-2xl text-sm font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 transition shadow-lg shadow-cyan-500/20"
                      >
                        Lihat Riwayat Top Up
                      </button>
                    </Link>
                    <button
                      onClick={handleClose}
                      className="h-11 w-full rounded-2xl border border-slate-700 text-sm font-medium text-slate-300 hover:bg-slate-800/80 transition"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Total Pembayaran Banner */}
                  <div className="rounded-2xl bg-[#1e293b]/70 border border-slate-800 p-4 text-center">
                    <p className="text-xs font-medium text-slate-400">Total Pembayaran</p>
                    <p className="text-3xl font-extrabold text-cyan-400 mt-1 tracking-tight">
                      {fmtRp(amount)}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Transfer sesuai nominal di atas
                    </p>
                  </div>

                  {/* QRIS White Card Container */}
                  <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-lg flex flex-col items-center">
                    {/* Header Banner inside QRIS */}
                    <div className="w-full flex items-center justify-between pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-1.5">
                        <span className="font-black italic text-xl tracking-tighter text-red-600">
                          QRIS
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">
                          QR Standar Pembayaran
                        </span>
                      </div>
                      <span className="font-black italic text-sm tracking-wider text-red-600 px-2 py-0.5 rounded border border-red-200">
                        GPN
                      </span>
                    </div>

                    <p className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-700">
                      KIDZOO
                    </p>

                    {/* QR Code Image */}
                    <div className="mt-2 flex items-center justify-center p-2 rounded-xl bg-white">
                      {loadingQris ? (
                        <div className="flex h-52 w-52 items-center justify-center">
                          <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
                        </div>
                      ) : activeQrisImage ? (
                        <img
                          src={activeQrisImage}
                          alt="QRIS Pembayaran"
                          className="h-52 w-52 object-contain"
                        />
                      ) : (
                        <div className="flex h-52 w-52 flex-col items-center justify-center p-4 text-slate-400 text-center border-2 border-dashed border-slate-200 rounded-xl">
                          <ImageIcon className="h-10 w-10 mb-2 opacity-40 text-slate-400" />
                          <p className="text-xs font-medium">QRIS belum diunggah oleh Owner</p>
                        </div>
                      )}
                    </div>

                    {/* Unduh QR Code Button */}
                    <button
                      type="button"
                      onClick={handleDownloadQR}
                      disabled={!activeQrisImage}
                      className="mt-3 flex items-center justify-center gap-2 w-full max-w-[200px] py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition active:scale-95 disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5 text-slate-600" />
                      <span>Unduh QR Code</span>
                    </button>
                  </div>

                  {/* Supported Payment Apps */}
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-center text-slate-400">
                      Mendukung pembayaran melalui:
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {PAYMENT_METHODS.map((pm) => (
                        <span
                          key={pm.name}
                          className={`rounded-lg px-2 py-1 text-[10px] font-extrabold tracking-wide ${pm.bg}`}
                        >
                          {pm.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Cara Pembayaran Accordion/List */}
                  <div className="rounded-2xl bg-[#1e293b]/70 border border-slate-800 p-4 text-xs space-y-2 text-slate-300">
                    <p className="font-bold text-white text-xs">Cara Pembayaran:</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-slate-300 leading-relaxed text-[11px]">
                      <li>Buka aplikasi mobile banking atau e-wallet</li>
                      <li>Scan QR Code di atas</li>
                      <li>Periksa nominal transfer sesuai tagihan</li>
                      <li>Selesaikan pembayaran &amp; upload bukti transfer</li>
                    </ol>
                  </div>

                  {/* Upload Bukti Transfer */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-white flex items-center gap-1">
                      Upload Bukti Transfer <span className="text-red-500">*</span>
                    </label>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/jpg"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {proofPreview ? (
                      <div className="relative rounded-2xl border border-slate-700 bg-slate-900/60 p-2 overflow-hidden">
                        <img
                          src={proofPreview}
                          alt="Bukti transfer"
                          className="h-40 w-full object-contain rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setProofFile(null);
                            setProofPreview(null);
                          }}
                          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black transition"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <p className="mt-1.5 text-center text-[10px] text-slate-400 truncate px-2">
                          {proofFile?.name}
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-700 bg-[#1e293b]/40 py-5 px-4 text-center hover:border-cyan-500/60 hover:bg-[#1e293b]/70 transition group cursor-pointer"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-400 group-hover:text-cyan-400 transition">
                          <Upload className="h-5 w-5" />
                        </div>
                        <p className="text-xs font-semibold text-slate-200 mt-1">
                          Klik atau seret bukti transfer ke sini
                        </p>
                        <p className="text-[10px] text-slate-400">
                          PNG, JPG, JPEG, WEBP (maks. 5MB)
                        </p>
                      </button>
                    )}
                  </div>

                  {errorMessage && (
                    <div className="flex items-center gap-2 rounded-xl bg-red-950/50 border border-red-800/80 p-3 text-xs text-red-300">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={isSubmitting}
                      className="h-11 flex-1 rounded-2xl border border-slate-700 bg-slate-800/60 text-xs font-bold text-slate-300 hover:bg-slate-800 transition disabled:opacity-50"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || !proofFile}
                      className="h-11 flex-[2] rounded-2xl text-xs font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 transition shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Mengirim...</span>
                        </>
                      ) : (
                        <span>Konfirmasi Pembayaran</span>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
