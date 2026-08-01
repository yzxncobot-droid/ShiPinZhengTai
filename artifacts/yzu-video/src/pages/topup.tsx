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
  ShieldAlert, ChevronRight, Shield, Clock, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { format, formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

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
const PAYMENT_TIMEOUT_SECS = 15 * 60;

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

function formatCountdown(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

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
}).superRefine((data, ctx) => {
  if (data.transferAmount && data.amount && data.transferAmount !== data.amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferAmount"],
      message: "Transfer amount must exactly match the top-up amount.",
    });
  }
});

interface UploadErr { code: string; message: string }

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

// ─── QRIS Payment Dialog ────────────────────────────────────────────────────────
function QRISDialog({
  open, onClose, amount, settings, token, form,
  uploadState, setUploadState, uploadProgress, setUploadProgress,
  uploadError, setUploadError, fileInputRef, handleFileChange, resetProof,
  onConfirm, isPending,
}: {
  open: boolean; onClose: () => void; amount: number;
  settings: any; token: string | null; form: any;
  uploadState: "idle"|"uploading"|"success"|"error";
  setUploadState: (s: any) => void;
  uploadProgress: number; setUploadProgress: (n: number) => void;
  uploadError: UploadErr | null; setUploadError: (e: UploadErr | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  resetProof: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const proofUrl = form.watch("paymentProof");
  const [countdown, setCountdown] = useState(PAYMENT_TIMEOUT_SECS);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setCountdown(PAYMENT_TIMEOUT_SECS);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [open]);

  const isLowTime = countdown < 3 * 60;

  const copyAmount = () => {
    navigator.clipboard.writeText(String(amount)).then(() => toast({ title: "Amount copied!" }));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm w-[95vw] rounded-3xl border-0 p-0 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-purple-600 to-indigo-600 px-5 pt-5 pb-8 overflow-hidden">
          <div className="absolute top-2 right-16 text-yellow-300 text-xl select-none pointer-events-none">★</div>
          <div className="absolute top-8 right-8 text-yellow-200 text-sm select-none pointer-events-none">★</div>
          <div className="absolute -right-4 -bottom-4 text-[80px] select-none pointer-events-none opacity-60">🧒</div>

          <div className="flex items-start gap-3 relative z-10">
            <div className="h-11 w-11 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
              <QrCode className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-extrabold text-lg leading-tight">Pay with QRIS</h3>
              <p className="text-white/70 text-xs font-medium mt-0.5">This QRIS is valid for one payment only.</p>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors shrink-0"
            >
              <X className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="bg-white px-5 pb-6 pt-4 space-y-4 max-h-[72vh] overflow-y-auto">
          {/* Countdown */}
          <div className={`flex items-center justify-between rounded-2xl px-4 py-3 border ${isLowTime ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="flex items-center gap-2">
              <Clock className={`h-4 w-4 ${isLowTime ? "text-red-500" : "text-amber-500"}`} />
              <span className={`text-xs font-bold ${isLowTime ? "text-red-700" : "text-amber-700"}`}>
                Payment Expiration
              </span>
            </div>
            <span className={`text-xl font-extrabold tabular-nums ${isLowTime ? "text-red-600" : "text-amber-600"}`}>
              {countdown === 0 ? "EXPIRED" : formatCountdown(countdown)}
            </span>
          </div>

          {/* Total payment */}
          <div className="bg-purple-50 border border-purple-100 rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-extrabold text-purple-400 uppercase tracking-widest mb-0.5">Total Payment</p>
              <p className="text-2xl font-extrabold text-purple-700">Rp {amount.toLocaleString("id-ID")}</p>
            </div>
            <button
              type="button"
              onClick={copyAmount}
              className="flex items-center gap-1.5 bg-white border border-purple-200 text-purple-600 text-xs font-bold px-3 py-2 rounded-xl hover:bg-purple-50 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            {settings?.qrisImage ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
                <img src={settings.qrisImage} alt="QRIS" className="w-48 h-48 object-contain" />
              </div>
            ) : (
              <div className="w-48 h-48 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center shadow-sm">
                <QrCode className="h-16 w-16 text-slate-200 mb-2" />
                <span className="text-xs font-bold text-slate-400">QRIS not configured</span>
              </div>
            )}
          </div>

          {/* Transfer amount warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 font-medium leading-snug">
              Transfer exactly <strong>Rp {amount.toLocaleString("id-ID")}</strong> — different amounts are automatically rejected.
            </p>
          </div>

          {/* Transfer amount field */}
          <FormField control={form.control} name="transferAmount" render={({ field }) => (
            <div>
              <label className="text-xs font-extrabold text-slate-700 mb-1.5 block">
                Amount you transferred <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-sm">Rp</span>
                <Input
                  type="number"
                  className={`pl-12 h-12 rounded-2xl font-extrabold bg-slate-50 border-2 focus-visible:ring-0 ${
                    field.value && Number(field.value) !== amount ? "border-red-400 bg-red-50" :
                    field.value && Number(field.value) === amount ? "border-green-400 bg-green-50" :
                    "border-slate-200"
                  }`}
                  placeholder={amount.toLocaleString("id-ID")}
                  {...field}
                />
                {field.value && Number(field.value) === amount && (
                  <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-green-500" />
                )}
                {field.value && Number(field.value) !== amount && (
                  <AlertCircle className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
                )}
              </div>
              <FormMessage />
            </div>
          )} />

          {/* Upload proof */}
          <div>
            <label className="text-xs font-extrabold text-slate-700 mb-1.5 block">Upload Payment Proof</label>
            <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

            {uploadState === "success" && proofUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-green-200 h-32">
                <img src={proofUrl} alt="Proof" className="w-full h-full object-contain bg-slate-50" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2">
                  <Button type="button" size="sm" className="h-8 rounded-full bg-white text-slate-800 text-xs font-bold" onClick={() => fileInputRef.current?.click()}>Replace</Button>
                  <Button type="button" size="sm" className="h-8 rounded-full bg-red-500 text-white text-xs font-bold" onClick={resetProof}>Remove</Button>
                </div>
              </div>
            ) : uploadState === "uploading" ? (
              <div className="h-32 rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50 flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                <Progress value={uploadProgress} className="w-40 h-1.5" />
                <p className="text-[10px] font-bold text-purple-600">{uploadProgress}%</p>
              </div>
            ) : uploadState === "error" && uploadError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
                <AlertCircle className="h-5 w-5 text-red-500 mx-auto mb-1" />
                <p className="text-xs font-bold text-red-600 mb-2">{uploadError.message}</p>
                <Button type="button" size="sm" className="rounded-full h-7 bg-red-500 text-white text-xs font-bold" onClick={() => { setUploadState("idle"); setUploadError(null); fileInputRef.current?.click(); }}>Try Again</Button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-between border border-dashed border-purple-200 rounded-2xl px-4 py-4 cursor-pointer hover:bg-purple-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 bg-purple-100 rounded-full flex items-center justify-center">
                    <UploadCloud className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold text-slate-700">Upload Payment Proof</p>
                    <p className="text-[10px] text-slate-400 font-medium">PNG, JPG, JPEG, WEBP supported</p>
                  </div>
                </div>
                <Button type="button" size="sm" className="h-8 px-3 rounded-xl bg-purple-600 text-white text-xs font-extrabold gap-1 shrink-0">
                  <UploadCloud className="h-3.5 w-3.5" /> Upload
                </Button>
              </div>
            )}
          </div>

          {/* Confirm button */}
          <Button
            type="button"
            className="w-full h-13 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-sm gap-2 shadow-lg shadow-purple-500/30 disabled:opacity-50"
            disabled={isPending || uploadState === "uploading" || !proofUrl || countdown === 0}
            onClick={onConfirm}
          >
            {isPending
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <CheckCircle2 className="h-5 w-5" />}
            {countdown === 0 ? "Payment Expired" : "Confirm Payment"}
          </Button>

          {/* Owner note */}
          <div className="flex items-start gap-2.5 bg-slate-50 rounded-2xl px-4 py-3 border border-slate-100">
            <Shield className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-extrabold text-slate-700">Waiting for owner approval</p>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">Your balance will automatically be added after payment has been verified.</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────
export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: settings } = useGetSettings();
  const { data: topupHistory, isLoading: loadingHistory } = useListMyTopups({ limit: 5 });
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof topupSchema>>({
    resolver: zodResolver(topupSchema),
    defaultValues: { amount: 10000, transferAmount: 10000, paymentProof: "" },
  });

  const selectedAmount = form.watch("amount");

  const setPreset = (preset: number) => {
    form.setValue("amount", preset, { shouldValidate: true });
    form.setValue("transferAmount", preset, { shouldValidate: true });
    setCustomValue("");
    setCustomError("");
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
    form.setValue("amount", v, { shouldValidate: true });
    form.setValue("transferAmount", v, { shouldValidate: true });
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
    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          form.setValue("paymentProof", data.url, { shouldValidate: true });
          setUploadState("success");
          setUploadProgress(100);
          toast({ title: "✅ Proof uploaded successfully!" });
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConfirm = () => {
    const values = form.getValues();
    createTopup.mutate(
      { data: { amount: values.amount, transferAmount: values.transferAmount, paymentProof: values.paymentProof } as any },
      {
        onSuccess: () => {
          toast({ title: "🚀 Submitted!", description: "Waiting for owner to process." });
          setQrisOpen(false);
          resetProof();
          form.reset({ amount: 10000, transferAmount: 10000, paymentProof: "" });
        },
        onError: (err: any) => {
          toast({ title: "Failed", description: err?.message || "Please try again.", variant: "destructive" });
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
              {/* Decorative stars */}
              <div className="absolute top-5 right-28 text-yellow-400 text-xl select-none pointer-events-none">★</div>
              <div className="absolute top-12 right-14 text-yellow-300 text-sm select-none pointer-events-none animate-bounce">★</div>
              <div className="absolute top-4 right-44 text-yellow-200 text-xs select-none pointer-events-none">✦</div>
              {/* Character */}
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
                {PRESETS.map((p, i) => {
                  const active = selectedAmount === p.amount;
                  return (
                    <motion.button
                      key={p.amount}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setPreset(p.amount)}
                      className={`relative flex flex-col items-center py-3.5 px-2 rounded-2xl font-extrabold text-sm border transition-all ${
                        active
                          ? "bg-gradient-to-br from-purple-500 to-indigo-600 text-white border-transparent shadow-md shadow-purple-500/25"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:border-purple-200 hover:bg-purple-50"
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="preset-selected"
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-white rounded-full flex items-center justify-center shadow-sm"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-purple-600" />
                        </motion.span>
                      )}
                      <span className={`text-xs font-extrabold ${active ? "text-white/70" : "text-slate-400"}`}>TOP UP</span>
                      <span className="text-sm font-extrabold mt-0.5 leading-tight">{p.label}</span>
                    </motion.button>
                  );
                })}
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
            <div className="mx-4 mb-6">
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

            {/* ── Sticky Pay Button ── */}
            <div className="sticky bottom-[64px] md:bottom-0 px-4 py-3 bg-white/95 backdrop-blur border-t border-slate-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
              <motion.div whileTap={{ scale: 0.98 }}>
                <Button
                  type="button"
                  className="w-full h-13 text-sm font-extrabold rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30"
                  onClick={() => {
                    if (!selectedAmount || selectedAmount < 100) {
                      toast({ title: "Please select an amount first!", variant: "destructive" });
                      return;
                    }
                    setQrisOpen(true);
                  }}
                >
                  Pay Now — Rp {(selectedAmount ?? 0).toLocaleString("id-ID")}
                  <ChevronRight className="h-5 w-5 ml-1" />
                </Button>
              </motion.div>
            </div>

            {/* ── QRIS Dialog ── */}
            <QRISDialog
              open={qrisOpen}
              onClose={() => setQrisOpen(false)}
              amount={selectedAmount ?? 0}
              settings={settings}
              token={token}
              form={form}
              uploadState={uploadState}
              setUploadState={setUploadState}
              uploadProgress={uploadProgress}
              setUploadProgress={setUploadProgress}
              uploadError={uploadError}
              setUploadError={setUploadError}
              fileInputRef={fileInputRef as React.RefObject<HTMLInputElement>}
              handleFileChange={handleFileChange}
              resetProof={resetProof}
              onConfirm={handleConfirm}
              isPending={createTopup.isPending}
            />
          </form>
        </Form>
      </AppLayout>
    </ProtectedRoute>
  );
}
