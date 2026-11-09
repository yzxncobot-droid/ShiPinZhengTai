import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Loader2,
  ImageIcon,
  Clock,
  Upload,
  Camera,
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

const PRESETS = [1_000, 3_000, 5_000, 10_000, 20_000, 50_000];

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
  const [customAmountStr, setCustomAmountStr] = useState<string>(
    initialAmount ? String(initialAmount) : "10000",
  );
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
      setCustomAmountStr(String(initialAmount));
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

  const handlePresetSelect = (val: number) => {
    setAmount(val);
    setCustomAmountStr(String(val));
    setErrorMessage(null);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setCustomAmountStr(valStr);
    const num = Number(valStr);
    if (!Number.isNaN(num)) {
      setAmount(num);
    }
    setErrorMessage(null);
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

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File Terlalu Besar",
        description: "Ukuran bukti transfer maksimal 10MB.",
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

  const handleSubmit = async () => {
    if (!amount || amount < MIN_TOPUP || amount > MAX_TOPUP) {
      setErrorMessage(`Nominal harus antara ${fmtRp(MIN_TOPUP)} dan ${fmtRp(MAX_TOPUP)}.`);
      return;
    }

    if (!proofFile) {
      setErrorMessage("Bukti transfer wajib diunggah sebelum mengirim pembayaran.");
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
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:px-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ── Modal Header ── */}
            <div
              className="relative px-6 py-5 text-white"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #8b5cf6 100%)" }}
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
                  <span className="text-2xl">📱</span>
                </div>
                <div>
                  <h2 className="text-lg font-extrabold leading-tight">Top Up Saldo via QRIS</h2>
                  <p className="text-xs font-medium text-white/80">Scan QRIS · Upload Bukti · Verifikasi Manual</p>
                </div>
              </div>
            </div>

            {/* ── Modal Content ── */}
            <div className="max-h-[80vh] overflow-y-auto px-6 py-6 space-y-6">
              {submittedSuccess ? (
                <div className="py-6 text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
                  >
                    <CheckCircle2 className="h-12 w-12" />
                  </motion.div>
                  <h3 className="text-xl font-extrabold text-slate-800">
                    Permintaan Top Up Terkirim!
                  </h3>
                  <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-left space-y-1.5 text-xs text-amber-800">
                    <p className="font-bold flex items-center gap-1.5 text-sm">
                      <Clock className="h-4 w-4" /> Status: Menunggu Verifikasi Admin
                    </p>
                    <p className="leading-relaxed">
                      Bukti pembayaran sebesar <strong>{fmtRp(amount)}</strong> telah diterima.
                      Admin/Owner akan memeriksa mutasi pembayaran Anda. Saldo akan otomatis bertambah setelah disetujui.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2.5 pt-2">
                    <Link href="/history">
                      <button
                        onClick={handleClose}
                        className="h-12 w-full rounded-2xl text-sm font-extrabold text-white transition hover:opacity-90"
                        style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
                      >
                        Lihat Riwayat Top Up
                      </button>
                    </Link>
                    <button
                      onClick={handleClose}
                      className="h-11 w-full rounded-2xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
                    >
                      Selesai
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* 1. Nominal Section */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      1. Pilih atau Masukkan Nominal
                    </label>
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                      {PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handlePresetSelect(p)}
                          className={`rounded-xl border-2 py-2 px-1 text-xs font-extrabold transition ${
                            amount === p
                              ? "border-violet-600 bg-violet-50 text-violet-700 shadow-sm"
                              : "border-slate-100 bg-white text-slate-700 hover:border-slate-200"
                          }`}
                        >
                          {fmtRp(p)}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center gap-2 rounded-xl border-2 border-slate-100 bg-slate-50/50 p-2 pl-3 focus-within:border-violet-500 focus-within:bg-white transition">
                      <span className="text-xs font-bold text-slate-400">Rp</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={customAmountStr}
                        onChange={handleCustomChange}
                        placeholder="Masukkan nominal lain"
                        className="h-8 w-full bg-transparent text-sm font-extrabold outline-none text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Minimal {fmtRp(MIN_TOPUP)} — Maksimal {fmtRp(MAX_TOPUP)}
                    </p>
                  </div>

                  {/* 2. QRIS Code Section */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      2. Scan & Bayar via QRIS
                    </label>
                    <div className="mt-2.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 flex flex-col items-center text-center">
                      <div className="rounded-xl border bg-white p-3 shadow-sm">
                        {loadingQris ? (
                          <div className="flex h-44 w-44 items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                          </div>
                        ) : activeQrisImage ? (
                          <img
                            src={activeQrisImage}
                            alt="QRIS Pembayaran"
                            className="h-44 w-44 object-contain"
                          />
                        ) : (
                          <div className="flex h-44 w-44 flex-col items-center justify-center p-3 text-slate-400">
                            <ImageIcon className="h-10 w-10 mb-2 opacity-50" />
                            <p className="text-xs font-medium">QRIS belum diupload oleh Owner</p>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 text-xs text-slate-500 max-w-xs leading-relaxed">
                        Pindai QRIS di atas dengan aplikasi bank (BCA, Mandiri, BRI, BNI) atau e-wallet (GoPay, OVO, Dana, ShopeePay, LinkAja).
                      </div>

                      {activeQrisImage && (
                        <button
                          type="button"
                          onClick={() => window.open(activeQrisImage, "_blank")}
                          className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-violet-600 hover:text-violet-700"
                        >
                          <Download className="h-3.5 w-3.5" /> Buka / Unduh QRIS
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 3. Upload Bukti Pembayaran */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        3. Upload Bukti Transfer <span className="text-rose-500">*</span>
                      </label>
                      <span className="text-[10px] text-slate-400">JPG, PNG, WEBP (maks. 10MB)</span>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/jpg"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {proofPreview ? (
                      <div className="mt-2.5 relative rounded-2xl border border-slate-200 overflow-hidden bg-slate-900/5 p-2">
                        <img
                          src={proofPreview}
                          alt="Preview bukti transfer"
                          className="h-44 w-full object-contain rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setProofFile(null);
                            setProofPreview(null);
                          }}
                          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <p className="mt-1.5 text-center text-[11px] font-medium text-slate-600 truncate px-2">
                          {proofFile?.name}
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-2.5 flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-violet-400 hover:bg-violet-50/20 transition"
                      >
                        <Camera className="h-7 w-7 text-slate-400" />
                        <span className="text-xs font-bold text-slate-600">
                          Pilih Foto Bukti Pembayaran
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Klik untuk memilih dari galeri / kamera
                        </span>
                      </button>
                    )}
                  </div>

                  {errorMessage && (
                    <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-200/60 p-3 text-xs text-blue-800">
                    <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
                    <span>
                      Saldo tidak langsung bertambah setelah submit. Admin atau Owner akan memverifikasi bukti Anda secara manual.
                    </span>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={isSubmitting}
                      className="h-12 flex-1 rounded-2xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || !proofFile || amount < MIN_TOPUP}
                      className="h-12 flex-[2] rounded-2xl text-sm font-extrabold text-white flex items-center justify-center gap-2 shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Mengirim Permintaan...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          <span>Kirim Bukti Pembayaran</span>
                        </>
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
