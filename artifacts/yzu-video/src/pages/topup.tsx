import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useCreateTopup, useGetSettings, useListMyTopups } from "@workspace/api-client-react";
import type { Topup } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  QrCode, UploadCloud, Loader2, CheckCircle2, X, AlertCircle,
  Download, RefreshCw,
  ShieldAlert, ChevronRight, Shield, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";

// ─── Constants ──────────────────────────────────────────────────────────────────
const PRESETS = [
  { amount: 1000,  label: "Rp 1.000"  },
  { amount: 5000,  label: "Rp 5.000"  },
  { amount: 10000, label: "Rp 10.000" },
  { amount: 15000, label: "Rp 15.000" },
  { amount: 25000, label: "Rp 25.000" },
  { amount: 50000, label: "Rp 50.000" },
];

const PAYMENT_METHODS = [
  { id: "qris",      label: "QRIS",      color: "#7C3AED", selectable: true  },
  { id: "gopay",     label: "GoPay",     color: "#00AED6", selectable: false },
  { id: "ovo",       label: "OVO",       color: "#4C3494", selectable: false },
  { id: "dana",      label: "DANA",      color: "#118EEA", selectable: false },
  { id: "shopeepay", label: "ShopeePay", color: "#EE4D2D", selectable: false },
  { id: "linkaja",   label: "LinkAja",   color: "#E82529", selectable: false },
  { id: "bca",       label: "BCA",       color: "#0066AE", selectable: false },
  { id: "bri",       label: "BRI",       color: "#00529C", selectable: false },
  { id: "mandiri",   label: "mandiri",   color: "#003087", selectable: false },
  { id: "bni",       label: "BNI",       color: "#F47920", selectable: false },
  { id: "bsi",       label: "BSI",       color: "#006233", selectable: false },
  { id: "cimb",      label: "CIMB",      color: "#C1392B", selectable: false },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const LS_KEY = "topup_rules_ack";

function shouldShowModal(sessionKey: string): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return true;
    const { ts, sk } = JSON.parse(raw) as { ts: number; sk: string };
    return sk !== sessionKey || Date.now() - ts > 24 * 60 * 60 * 1000;
  } catch { return true; }
}
function ackModal(sessionKey: string) {
  localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), sk: sessionKey }));
}

const RULES = [
  "Transfer amount MUST exactly match the selected top-up amount.",
  "Transactions with different amounts will be automatically rejected.",
  "Ensure your payment proof is clear and readable.",
  "Edited or fake screenshots will be rejected.",
  "Upload your proof after completing the transfer.",
];

// ─── Rules Modal ───────────────────────────────────────────────────────────────
function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-sm w-[95vw] rounded-3xl border-0 p-0 overflow-hidden shadow-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="bg-gradient-to-br from-purple-600 to-indigo-600 px-6 pt-6 pb-5 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-white font-extrabold text-lg">⚠️ Top Up Rules</h2>
          <p className="text-white/80 text-xs mt-1 font-medium">Read before making a payment</p>
        </div>
        <div className="bg-white px-5 pt-4 pb-2 space-y-2.5 max-h-[55vh] overflow-y-auto">
          <ol className="space-y-2.5">
            {RULES.map((rule, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-100 text-purple-600 font-extrabold text-xs flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-snug">{rule}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="bg-white px-5 pb-5 pt-3">
          <Button className="w-full h-12 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold" onClick={onClose}>
            I Understand <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schema ────────────────────────────────────────────────────────────────────
const topupSchema = z.object({
  amount: z.coerce.number().min(100, "Minimum Rp 100"),
  transferAmount: z.coerce.number().min(100, "Enter transfer amount"),
  paymentProof: z.string().min(1, "Payment proof is required"),
});

interface UploadErr { code: string; message: string }

interface AutomaticTopup {
  id: string;
  orderId: string;
  amount: number;
  status: string;
  qrCodeUrl?: string | null;
  qrisString?: string | null;
  expiredAt?: string | null;
  gateway?: string | null;
}

// ─── History Card ──────────────────────────────────────────────────────────────
function HistoryCard({ topup }: { topup: Topup }) {
  const statusConfig = {
    pending:   { label: "Pending",   bg: "bg-amber-50",  text: "text-amber-600",  dot: "bg-amber-500"  },
    confirmed: { label: "Approved",  bg: "bg-green-50",  text: "text-green-600",  dot: "bg-green-500"  },
    denied:    { label: "Rejected",  bg: "bg-red-50",    text: "text-red-600",    dot: "bg-red-500"    },
  };
  const cfg = statusConfig[topup.status as keyof typeof statusConfig] ?? statusConfig.pending;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-extrabold text-slate-800 text-base">
          Rp {topup.amount.toLocaleString("id-ID")}
        </span>
        <span className={`flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>
      <div className="space-y-1 text-[11px] text-slate-500 font-medium">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          <span>Created: {format(new Date(topup.createdAt), "dd MMM yyyy, HH:mm", { locale: localeId })}</span>
        </div>
        {topup.updatedAt && topup.status !== "pending" && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
            <span>Processed: {format(new Date(topup.updatedAt), "dd MMM yyyy, HH:mm", { locale: localeId })}</span>
          </div>
        )}
        {topup.paymentProof && (
          <a
            href={topup.paymentProof}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-purple-600 hover:underline mt-1"
          >
            <UploadCloud className="h-3 w-3 shrink-0" /> View proof
          </a>
        )}
      </div>
    </div>
  );
}

// ─── QRIS Payment Modal ─────────────────────────────────────────────────────────
function QRISModal({
  open, onClose, amount, settings, token,
  uploadState, setUploadState, uploadProgress, setUploadProgress,
  uploadError, setUploadError, fileInputRef, handleFileChange, resetProof,
  proofUrl, previewObjectUrl,
  onConfirm, isPending,
}: {
  open: boolean; onClose: () => void; amount: number;
  settings: any; token: string | null;
  uploadState: "idle"|"uploading"|"success"|"error";
  setUploadState: (s: any) => void;
  uploadProgress: number; setUploadProgress: (n: number) => void;
  uploadError: UploadErr | null; setUploadError: (e: UploadErr | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  resetProof: () => void;
  proofUrl: string;
  previewObjectUrl: string | null;
  onConfirm: () => void;
  isPending: boolean;
}) {
  // Prevent background scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="qris-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal sheet */}
          <motion.div
            key="qris-modal"
            initial={{ opacity: 0, scale: 0.93, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
          >
            <div
              className="relative w-full max-w-sm rounded-[24px] overflow-hidden shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Header ── */}
              <div className="relative bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-500 px-5 pt-5 pb-7 overflow-hidden">
                {/* Stars decoration */}
                <div className="absolute top-3 right-20 text-yellow-300 text-xl select-none pointer-events-none">★</div>
                <div className="absolute top-9 right-10 text-yellow-200 text-sm select-none pointer-events-none">★</div>
                {/* Kid illustration */}
                <div className="absolute -right-2 -bottom-2 text-[80px] select-none pointer-events-none opacity-80 leading-none">🧒</div>

                {/* Close button */}
                <button
                  onClick={onClose}
                  className="absolute top-3.5 right-3.5 h-8 w-8 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/35 transition-colors z-10"
                >
                  <X className="h-4 w-4 text-white" />
                </button>

                <div className="flex items-center gap-3 relative z-10 pr-10">
                  <div className="h-11 w-11 bg-white/25 rounded-2xl flex items-center justify-center shrink-0 shadow-inner">
                    <QrCode className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-extrabold text-xl leading-tight">Bayar QRIS</h3>
                    <p className="text-white/75 text-xs font-medium mt-0.5">QRIS hanya berlaku sekali</p>
                  </div>
                </div>
              </div>

              {/* ── Body ── */}
              <div className="bg-white max-h-[75vh] overflow-y-auto">
                <div className="px-5 pt-5 pb-6 space-y-4">

                  {/* Total Payment */}
                  <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100 rounded-2xl px-5 py-4 text-center">
                    <p className="text-[10px] font-extrabold text-purple-400 uppercase tracking-[0.18em] mb-1">Total Bayar</p>
                    <p className="text-3xl font-extrabold text-purple-700 tracking-tight">
                      Rp {amount.toLocaleString("id-ID")}
                    </p>
                  </div>

                  {/* QRIS Image */}
                  <div className="flex justify-center">
                    {settings?.qrisImage ? (
                      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-md shadow-slate-200/70">
                        <img src={settings.qrisImage} alt="QRIS" className="w-52 h-52 object-contain" />
                      </div>
                    ) : (
                      <div className="w-52 h-52 bg-slate-50 border border-slate-200 rounded-3xl flex flex-col items-center justify-center shadow-sm">
                        <QrCode className="h-16 w-16 text-slate-200 mb-2" />
                        <span className="text-xs font-bold text-slate-400">QRIS belum dikonfigurasi</span>
                      </div>
                    )}
                  </div>

                  {/* Upload Proof Section */}
                  <div>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                    />

                    {uploadState === "success" ? (
                      // Preview uploaded image
                      <div className="space-y-2">
                        <div className="relative rounded-2xl overflow-hidden border-2 border-green-300 shadow-sm">
                          <img
                            src={previewObjectUrl ?? proofUrl ?? ""}
                            alt="Bukti Transfer"
                            className="w-full max-h-48 object-contain bg-slate-50"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                          <div className="absolute top-2 right-2 flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="h-7 px-3 rounded-full bg-white/90 text-slate-700 text-xs font-bold shadow-sm hover:bg-white transition-colors"
                            >
                              Ganti
                            </button>
                            <button
                              type="button"
                              onClick={resetProof}
                              className="h-7 px-3 rounded-full bg-red-500/90 text-white text-xs font-bold shadow-sm hover:bg-red-500 transition-colors"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 px-1">
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          <span className="text-xs font-bold text-green-600">Bukti transfer berhasil diupload</span>
                        </div>
                      </div>
                    ) : uploadState === "uploading" ? (
                      // Upload progress
                      <div className="border-2 border-dashed border-purple-300 rounded-2xl bg-purple-50 px-5 py-7 flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                        <div className="w-full max-w-[180px]">
                          <Progress value={uploadProgress} className="h-2 rounded-full" />
                        </div>
                        <p className="text-xs font-bold text-purple-600">Mengupload... {uploadProgress}%</p>
                      </div>
                    ) : uploadState === "error" && uploadError ? (
                      // Error state
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-5 text-center">
                        <AlertCircle className="h-7 w-7 text-red-500 mx-auto mb-2" />
                        <p className="text-sm font-bold text-red-600 mb-3">{uploadError.message}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadState("idle");
                            setUploadError(null);
                            fileInputRef.current?.click();
                          }}
                          className="h-8 px-5 rounded-full bg-red-500 text-white text-xs font-extrabold hover:bg-red-600 transition-colors"
                        >
                          Coba Lagi
                        </button>
                      </div>
                    ) : (
                      // Idle upload area
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-purple-200 rounded-2xl bg-purple-50/40 px-5 py-7 cursor-pointer hover:bg-purple-50 hover:border-purple-400 transition-all group"
                      >
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="h-14 w-14 bg-purple-100 rounded-full flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                            <UploadCloud className="h-7 w-7 text-purple-600" />
                          </div>
                          <div>
                            <p className="text-sm font-extrabold text-slate-700">Upload Bukti Transfer</p>
                            <p className="text-xs text-slate-400 font-medium mt-0.5">Upload screenshot bukti transfer Anda</p>
                          </div>
                          <button
                            type="button"
                            className="h-9 px-6 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-purple-500/25 hover:shadow-lg hover:shadow-purple-500/35 transition-all"
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                          >
                            <UploadCloud className="h-3.5 w-3.5" /> Upload
                          </button>
                          <p className="text-[10px] text-slate-400 font-medium">JPG, JPEG, PNG, WEBP · Maks. 10 MB</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirm Button */}
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    disabled={isPending || uploadState !== "success"}
                    onClick={onConfirm}
                    className="w-full h-13 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    style={{ minHeight: 52 }}
                  >
                    {isPending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5" />
                    )}
                    Confirm
                  </motion.button>

                  {/* Bottom info card */}
                  <div className="flex items-start gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3.5">
                    <span className="text-lg shrink-0 mt-0.5">🛡</span>
                    <div>
                      <p className="text-xs font-extrabold text-slate-700">Menunggu persetujuan owner</p>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-snug">
                        Setelah pembayaran dikonfirmasi owner, saldo akan otomatis masuk ke akun Anda.
                      </p>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Automatic QRIS modal ─────────────────────────────────────────────────────
function AutomaticQrisModal({
  open, onClose, topup, isChecking, onCheck,
}: {
  open: boolean;
  onClose: () => void;
  topup: AutomaticTopup | null;
  isChecking: boolean;
  onCheck: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!open || !topup?.expiredAt) {
      setSecondsLeft(0);
      return;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(topup.expiredAt!).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [open, topup?.expiredAt]);

  useEffect(() => {
    if (topup?.status === "paid") onClose();
  }, [topup?.status, onClose]);

  const expired = secondsLeft === 0 || topup?.status === "expired";
  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <AnimatePresence>
      {open && topup && (
        <>
          <motion.div
            key="auto-qris-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            key="auto-qris-modal"
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
                  <button onClick={onClose} className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
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
                    disabled={isChecking || expired}
                    className="h-11 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Periksa Pembayaran
                  </button>
                </div>

                <p className="text-[11px] text-center text-slate-400 font-medium">
                  Setelah pembayaran terdeteksi, saldo akan bertambah otomatis. Jangan tutup halaman sebelum status berubah.
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────
export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: settings } = useGetSettings();
  const { data: topupHistory, isLoading: loadingHistory, refetch: refetchHistory } = useListMyTopups({ limit: 5 });
  const createTopup = useCreateTopup();

  const sessionKey = (token ?? "anon").slice(0, 10);
  const [showRules, setShowRules] = useState(false);
  const [qrisOpen, setQrisOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState("");

  useEffect(() => {
    if (shouldShowModal(sessionKey)) setShowRules(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [uploadState, setUploadState] = useState<"idle"|"uploading"|"success"|"error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<UploadErr | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof topupSchema>>({
    resolver: zodResolver(topupSchema),
    defaultValues: { amount: 10000, transferAmount: 10000, paymentProof: "" },
  });

  const selectedAmount = form.watch("amount");
  const proofUrl = form.watch("paymentProof");

  const openQrisModal = (amount: number) => {
    form.setValue("amount", amount, { shouldValidate: true });
    form.setValue("transferAmount", amount, { shouldValidate: true });
    setQrisOpen(true);
  };

  const setPreset = (preset: number) => {
    setCustomValue("");
    setCustomError("");
    openQrisModal(preset);
  };

  const applyCustom = () => {
    const v = Number(customValue.replace(/[^\d]/g, ""));
    if (!v || v < 100) {
      setCustomError("Minimum top up is Rp 100.");
      return;
    }
    if (v > 1000000) {
      setCustomError("Maximum top up is Rp 1.000.000.");
      return;
    }
    setCustomError("");
    openQrisModal(v);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploadProgress(0);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadState("error");
      setUploadError({ code: "FORMAT", message: "Unsupported format. Use JPG, PNG, or WEBP." });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadState("error");
      setUploadError({ code: "SIZE", message: "File too large. Maximum 10 MB." });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploadState("uploading");
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (ev) => {
      if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
    });
    // Revoke any previous object URL to avoid memory leaks
    setPreviewObjectUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    // Store preview URL before async upload
    const localPreview = URL.createObjectURL(file);
    setPreviewObjectUrl(localPreview);

    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          form.setValue("paymentProof", data.url, { shouldValidate: true });
          setUploadState("success");
          setUploadProgress(100);
          toast({ title: "✅ Bukti berhasil diupload!" });
        } else {
          setUploadState("error");
          setUploadError({ code: "SERVER", message: data.message || "Upload failed." });
        }
      } catch {
        setUploadState("error");
        setUploadError({ code: "PARSE", message: "Server error." });
      }
    });
    xhr.addEventListener("error", () => {
      setUploadState("error");
      setUploadError({ code: "NET", message: "Connection lost." });
    });
    xhr.open("POST", "/api/upload/payment-proof");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(fd);
  };

  const resetProof = () => {
    form.setValue("paymentProof", "", { shouldValidate: false });
    setUploadState("idle");
    setUploadProgress(0);
    setUploadError(null);
    setPreviewObjectUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeQrisModal = () => {
    setQrisOpen(false);
    resetProof();
  };

  const handleConfirm = () => {
    const values = form.getValues();
    createTopup.mutate(
      { data: { amount: values.amount, transferAmount: values.transferAmount, paymentProof: values.paymentProof } as any },
      {
        onSuccess: () => {
          toast({ title: "🚀 Pembayaran dikirim!", description: "Menunggu konfirmasi dari owner." });
          setQrisOpen(false);
          resetProof();
          form.reset({ amount: 10000, transferAmount: 10000, paymentProof: "" });
          refetchHistory();
        },
        onError: (err: any) => {
          toast({ title: "Gagal", description: err?.message || "Silakan coba lagi.", variant: "destructive" });
        },
      },
    );
  };

  const historyList: Topup[] = (topupHistory as any)?.data ?? [];

  return (
    <ProtectedRoute>
      <AppLayout>
        <Form {...form}>
          <form>
            <RulesModal open={showRules} onClose={() => { ackModal(sessionKey); setShowRules(false); }} />

            {/* ── Page header ── */}
            <div className="relative px-5 pt-6 pb-3 overflow-hidden bg-white">
              <div className="absolute top-5 right-28 text-yellow-400 text-xl select-none pointer-events-none">★</div>
              <div className="absolute top-12 right-14 text-yellow-300 text-sm select-none pointer-events-none animate-bounce">★</div>
              <div className="absolute top-4 right-44 text-yellow-200 text-xs select-none pointer-events-none">✦</div>
              <div className="absolute right-3 top-0 text-[72px] select-none pointer-events-none opacity-85 leading-none">🧒</div>

              <div className="max-w-[65%]">
                <h1 className="text-2xl font-extrabold text-slate-800 leading-tight">Top Up Balance</h1>
                <p className="text-xs text-slate-500 font-medium mt-1.5 leading-snug">
                  Top up your wallet instantly using QRIS.
                </p>
              </div>
            </div>

            {/* ── Current Balance card ── */}
            <div className="mx-4 mb-4">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-500 rounded-3xl p-5 shadow-xl overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-36 h-36 bg-white/5 rounded-full -translate-x-6 -translate-y-10" />
                <div className="absolute bottom-0 left-0 w-28 h-28 bg-white/5 rounded-full translate-x-2 translate-y-10" />
                <div className="relative z-10">
                  <p className="text-white/60 text-[10px] font-extrabold uppercase tracking-[0.15em] mb-1">Current Balance</p>
                  <p className="text-white font-extrabold text-3xl tracking-tight">
                    Rp {(user?.walletBalance ?? 0).toLocaleString("id-ID")}
                  </p>
                </div>
                <div className="absolute right-5 top-5 text-white/10 text-4xl select-none">◆</div>
              </motion.div>
            </div>

            {/* ── Preset amounts ── */}
            <div className="mx-4 mb-4 bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
              <p className="font-extrabold text-slate-800 text-sm mb-3">Select Amount</p>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {PRESETS.map((p, i) => (
                  <motion.button
                    key={p.amount}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setPreset(p.amount)}
                    className="relative flex flex-col items-center py-3.5 px-2 rounded-2xl font-extrabold text-sm border transition-all bg-slate-50 text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50 active:bg-purple-100"
                  >
                    <span className="text-xs font-extrabold text-slate-400">TOP UP</span>
                    <span className="text-sm font-extrabold mt-0.5 leading-tight">{p.label}</span>
                  </motion.button>
                ))}
              </div>

              {/* Custom amount */}
              <div className="border-t border-slate-100 pt-3.5">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">Custom Amount</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold pointer-events-none">Rp</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="Min: Rp 100"
                      value={customValue}
                      onChange={(e) => { setCustomValue(e.target.value); setCustomError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); } }}
                      className="pl-10 h-11 rounded-xl border-slate-200 bg-slate-50 text-sm font-bold focus-visible:ring-purple-500"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={applyCustom}
                    className="h-11 px-5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-sm gap-1 shrink-0"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Use
                  </Button>
                </div>
                {customError && (
                  <p className="text-xs text-red-500 font-medium mt-1.5 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {customError}
                  </p>
                )}
                <p className="text-[10px] text-slate-400 font-medium mt-1.5">Minimum: Rp 100 · Maximum: Rp 1.000.000</p>
              </div>
            </div>

            {/* ── Payment Methods ── */}
            <div className="mx-4 mb-4 bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1">Payment Methods</p>
              <p className="text-xs text-slate-500 font-medium mb-3">All payments processed via QRIS</p>
              <div className="grid grid-cols-4 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-center justify-center h-10 rounded-xl border px-2 transition-all ${
                      m.selectable
                        ? "border-purple-300 bg-purple-50 ring-1 ring-purple-400"
                        : "border-slate-100 bg-slate-50 opacity-70"
                    }`}
                  >
                    <span className="text-[10px] font-extrabold truncate leading-tight text-center" style={{ color: m.color }}>
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Top Up History ── */}
            <div className="mx-4 mb-8">
              <div className="flex items-center justify-between mb-3">
                <p className="font-extrabold text-slate-800 text-sm">Top Up History</p>
                <button
                  type="button"
                  onClick={() => setLocation("/history")}
                  className="text-[11px] font-bold text-purple-600 hover:text-purple-800"
                >
                  See all <ChevronRight className="h-3 w-3 inline" />
                </button>
              </div>

              {loadingHistory ? (
                <div className="space-y-2.5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 animate-pulse">
                      <div className="flex justify-between mb-2">
                        <div className="h-5 bg-slate-200 rounded w-24" />
                        <div className="h-5 bg-slate-200 rounded w-16" />
                      </div>
                      <div className="h-3 bg-slate-200 rounded w-40" />
                    </div>
                  ))}
                </div>
              ) : historyList.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
                  <div className="text-3xl mb-2">💳</div>
                  <p className="text-sm font-extrabold text-slate-600">No top-up history yet</p>
                  <p className="text-xs text-slate-400 font-medium mt-1">Your transactions will appear here</p>
                </div>
              ) : (
                <AnimatePresence>
                  <div className="space-y-2.5">
                    {historyList.map((topup, i) => (
                      <motion.div
                        key={topup.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <HistoryCard topup={topup} />
                      </motion.div>
                    ))}
                  </div>
                </AnimatePresence>
              )}
            </div>

            {/* ── QRIS Modal ── */}
            <QRISModal
              open={qrisOpen}
              onClose={closeQrisModal}
              amount={selectedAmount ?? 0}
              settings={settings}
              token={token}
              uploadState={uploadState}
              setUploadState={setUploadState}
              uploadProgress={uploadProgress}
              setUploadProgress={setUploadProgress}
              uploadError={uploadError}
              setUploadError={setUploadError}
              fileInputRef={fileInputRef as React.RefObject<HTMLInputElement>}
              handleFileChange={handleFileChange}
              resetProof={resetProof}
              proofUrl={proofUrl}
              previewObjectUrl={previewObjectUrl}
              onConfirm={handleConfirm}
              isPending={createTopup.isPending}
            />
          </form>
        </Form>
      </AppLayout>
    </ProtectedRoute>
  );
}
