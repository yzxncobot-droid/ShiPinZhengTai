import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useCreateTopup, useGetSettings } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Wallet, QrCode, UploadCloud, Loader2, CheckCircle2, X, AlertCircle,
  ShieldAlert, ArrowRight, Copy, Clock, Sparkles, ChevronRight, History,
  Plus, CreditCard, Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from "@/components/ui/drawer";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────
const PRESET_AMOUNTS = [1000, 5000, 10000, 15000, 20000, 25000, 50000];
const BONUS_MAP: Record<number, string | null> = {
  1000: null, 5000: null, 10000: "+500 Koin", 15000: "+800 Koin",
  20000: "+1.200 Koin", 25000: "+1.600 Koin", 50000: "+3.500 Koin",
};
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const LS_KEY = "topup_rules_ack";
const PAYMENT_TIMEOUT_SECS = 15 * 60; // 15 minutes

function shouldShowModal(sessionKey: string): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return true;
    const { ts, sk } = JSON.parse(raw) as { ts: number; sk: string };
    if (sk !== sessionKey) return true;
    if (Date.now() - ts > 24 * 60 * 60 * 1000) return true;
    return false;
  } catch { return true; }
}

function ackModal(sessionKey: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), sk: sessionKey }));
}

const RULES = [
  "Jumlah transfer HARUS sama persis dengan nominal top up yang dipilih.",
  "Nominal berbeda akan otomatis ditolak oleh sistem.",
  "Pastikan bukti pembayaran jelas dan terbaca.",
  "Screenshot yang diedit atau palsu akan ditolak.",
  "Upload bukti setelah transfer selesai dilakukan.",
  "Periksa kembali nominal sebelum submit.",
  "Proses hanya dimulai setelah admin review.",
];

function TopUpRulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-sm w-[95vw] rounded-3xl border-0 p-0 overflow-hidden shadow-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="gradient-funplus-pink px-6 pt-6 pb-5 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-white font-extrabold text-lg leading-tight">⚠️ Aturan Top Up</h2>
          <p className="text-white/80 text-xs mt-1 font-medium">Baca sebelum melakukan pembayaran</p>
        </div>
        <div className="bg-white px-5 pt-4 pb-5 space-y-3 max-h-[55vh] overflow-y-auto">
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
        <div className="bg-white px-5 pb-5 pt-1">
          <Button
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-extrabold text-sm shadow-lg gap-2"
            onClick={onClose}
          >
            Saya Mengerti <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const topupSchema = z.object({
  amount: z.coerce.number().min(100, "Minimum Rp 100"),
  transferAmount: z.coerce.number().min(100, "Masukkan jumlah transfer"),
  paymentProof: z.string().min(1, "Bukti transfer wajib diupload"),
}).superRefine((data, ctx) => {
  if (data.transferAmount && data.amount && data.transferAmount !== data.amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferAmount"],
      message: "Jumlah transfer harus sama persis dengan nominal top-up. Nominal berbeda akan ditolak otomatis.",
    });
  }
});

interface UploadError { code: string; message: string; detail?: string }

function formatCountdown(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: settings } = useGetSettings();
  const createTopup = useCreateTopup();

  const sessionKey = (token ?? "anon").slice(0, 10);
  const [showModal, setShowModal] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [countdown, setCountdown] = useState(PAYMENT_TIMEOUT_SECS);

  useEffect(() => {
    if (shouldShowModal(sessionKey)) setShowModal(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown timer in drawer
  useEffect(() => {
    if (!drawerOpen) return;
    setCountdown(PAYMENT_TIMEOUT_SECS);
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [drawerOpen]);

  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof topupSchema>>({
    resolver: zodResolver(topupSchema),
    defaultValues: { amount: 10000, transferAmount: 10000, paymentProof: "" },
  });

  const amount = form.watch("amount");

  const setPreset = (preset: number) => {
    form.setValue("amount", preset, { shouldValidate: true });
    form.setValue("transferAmount", preset, { shouldValidate: true });
  };

  const validateFile = (file: File): UploadError | null => {
    if (!ALLOWED_TYPES.includes(file.type))
      return { code: "FORMAT_NOT_SUPPORTED", message: `Format "${file.type}" tidak didukung.`, detail: "Gunakan JPG atau PNG." };
    if (file.size > MAX_FILE_SIZE)
      return { code: "FILE_TOO_LARGE", message: "File terlalu besar.", detail: "Maksimal 10 MB." };
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploadProgress(0);
    const err = validateFile(file);
    if (err) { setUploadState("error"); setUploadError(err); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
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
          toast({ title: "✅ Bukti berhasil diupload!" });
        } else {
          setUploadState("error");
          setUploadError({ code: "SERVER_ERROR", message: "Gagal upload.", detail: data.message });
        }
      } catch {
        setUploadState("error");
        setUploadError({ code: "PARSE_ERROR", message: "Error server." });
      }
    });
    xhr.addEventListener("error", () => { setUploadState("error"); setUploadError({ code: "NETWORK_ERROR", message: "Koneksi terputus." }); });
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

  const onSubmit = (values: z.infer<typeof topupSchema>) => {
    createTopup.mutate(
      { data: { amount: values.amount, transferAmount: values.transferAmount, paymentProof: values.paymentProof } as any },
      {
        onSuccess: () => {
          toast({ title: "Terkirim! 🚀", description: "Tunggu admin memproses ya." });
          setDrawerOpen(false);
          setLocation("/history");
        },
        onError: (err: any) => {
          toast({ title: "Gagal", description: err?.message || "Coba lagi nanti.", variant: "destructive" });
        },
      },
    );
  };

  const proofUrl = form.watch("paymentProof");
  const copyAmount = () => {
    navigator.clipboard.writeText(String(amount ?? 0)).then(() => toast({ title: "Nominal tersalin!" }));
  };

  const isLowTime = countdown < 3 * 60;

  return (
    <ProtectedRoute>
      <AppLayout>
        <TopUpRulesModal open={showModal} onClose={() => { ackModal(sessionKey); setShowModal(false); }} />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Hero wallet card */}
            <div className="relative overflow-hidden gradient-funplus pt-8 pb-10 px-4">
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-pink-400/20 rounded-full blur-3xl" />
              <div className="relative z-10 max-w-sm mx-auto">
                {/* Wallet glass card */}
                <div className="bg-white/15 backdrop-blur border border-white/25 rounded-3xl p-5 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 bg-white/20 rounded-xl flex items-center justify-center">
                        <Wallet className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-white/70 text-[10px] font-bold uppercase tracking-wider">Saldo Wallet</p>
                        <p className="text-white font-extrabold text-xl">
                          Rp {user?.walletBalance?.toLocaleString("id-ID") ?? 0}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowModal(true)}
                      className="h-8 w-8 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
                    >
                      <ShieldAlert className="h-4 w-4 text-white" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-center">
                      <p className="text-white/60 text-[10px] font-bold">Metode</p>
                      <p className="text-white text-xs font-extrabold mt-0.5">QRIS</p>
                    </div>
                    <div className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-center">
                      <p className="text-white/60 text-[10px] font-bold">Status</p>
                      <p className="text-green-300 text-xs font-extrabold mt-0.5">✓ Aktif</p>
                    </div>
                    <div className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-center">
                      <p className="text-white/60 text-[10px] font-bold">Min.</p>
                      <p className="text-white text-xs font-extrabold mt-0.5">Rp 100</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Main content */}
            <div className="container mx-auto px-4 py-5 max-w-sm -mt-4">
              {/* Amount Selection Card */}
              <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm mb-4">
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-extrabold text-slate-700 text-sm flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-purple-500" />
                      Pilih Nominal
                    </FormLabel>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                      {PRESET_AMOUNTS.map((preset) => {
                        const bonus = BONUS_MAP[preset];
                        const isActive = Number(field.value) === preset;
                        return (
                          <motion.button
                            key={preset}
                            type="button"
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setPreset(preset)}
                            className={`relative flex flex-col items-center py-3 px-2 rounded-2xl font-extrabold text-sm transition-all border ${
                              isActive
                                ? "bg-gradient-to-br from-purple-500 to-pink-500 text-white border-transparent shadow-md shadow-purple-500/30"
                                : "bg-slate-50 text-slate-700 border-slate-200 hover:border-purple-200 hover:bg-purple-50"
                            }`}
                          >
                            <span className="text-xs font-extrabold">
                              {preset >= 1000 ? `${preset / 1000}rb` : `${preset}`}
                            </span>
                            {bonus && (
                              <span className={`text-[8px] font-bold mt-0.5 ${isActive ? "text-yellow-200" : "text-green-600"}`}>
                                {bonus}
                              </span>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>

                    <div className="mt-3">
                      <p className="text-xs font-bold text-slate-500 mb-1.5">Atau nominal lain:</p>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-sm">Rp</span>
                          <Input
                            type="number"
                            className="pl-12 h-12 rounded-2xl font-extrabold bg-slate-50 border-slate-200 focus-visible:ring-purple-500"
                            placeholder="Masukkan nominal"
                            {...field}
                            onChange={(e) => {
                              field.onChange(e);
                              const v = Number(e.target.value);
                              if (!isNaN(v)) form.setValue("transferAmount", v, { shouldValidate: false });
                            }}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </div>
                  </FormItem>
                )} />

                {/* Lanjut Bayar button */}
                <motion.div whileTap={{ scale: 0.97 }} className="mt-5">
                  <Button
                    type="button"
                    className="w-full h-14 text-sm font-extrabold rounded-2xl bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-lg shadow-purple-500/30 border-none gap-2"
                    onClick={() => {
                      if (!amount || amount < 100) {
                        toast({ title: "Pilih nominal dulu!", variant: "destructive" });
                        return;
                      }
                      setDrawerOpen(true);
                    }}
                  >
                    <CreditCard className="h-5 w-5" />
                    Lanjut Bayar — Rp {(amount ?? 0).toLocaleString("id-ID")}
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </motion.div>
              </div>

              {/* History link */}
              <div className="text-center">
                <Link href="/history" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-purple-600 transition-colors">
                  <History className="h-3.5 w-3.5" /> Lihat Riwayat Top-up
                </Link>
              </div>
            </div>

            {/* Payment Drawer */}
            <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
              <DrawerContent className="rounded-t-3xl border-0">
                <DrawerHeader className="text-left px-5 pb-0">
                  <div className="flex items-center justify-between">
                    <DrawerTitle className="font-heading font-extrabold text-lg text-slate-800">
                      Pembayaran QRIS
                    </DrawerTitle>
                    <DrawerClose asChild>
                      <button className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                        <X className="h-4 w-4 text-slate-600" />
                      </button>
                    </DrawerClose>
                  </div>
                </DrawerHeader>

                <div className="overflow-y-auto max-h-[80vh] px-5 pb-8 space-y-5 mt-4">
                  {/* Countdown */}
                  <div className={`flex items-center justify-between rounded-2xl px-4 py-3 border ${
                    isLowTime ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
                  }`}>
                    <div className="flex items-center gap-2">
                      <Clock className={`h-4 w-4 ${isLowTime ? "text-red-500" : "text-amber-500"}`} />
                      <span className={`text-xs font-bold ${isLowTime ? "text-red-700" : "text-amber-700"}`}>
                        Batas waktu pembayaran
                      </span>
                    </div>
                    <span className={`text-lg font-extrabold tabular-nums ${isLowTime ? "text-red-600" : "text-amber-600"}`}>
                      {formatCountdown(countdown)}
                    </span>
                  </div>

                  {/* Amount summary */}
                  <div className="bg-purple-50 border border-purple-100 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold text-purple-500 uppercase tracking-wider">Total Pembayaran</p>
                      <p className="text-2xl font-extrabold text-purple-700">
                        Rp {(amount ?? 0).toLocaleString("id-ID")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copyAmount}
                      className="flex items-center gap-1.5 bg-white border border-purple-200 text-purple-600 text-xs font-bold px-3 py-2 rounded-xl hover:bg-purple-50 transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" /> Salin
                    </button>
                  </div>

                  {/* QRIS */}
                  <div className="bg-slate-50 rounded-3xl p-5 border border-slate-100 text-center">
                    <h3 className="font-extrabold text-sm text-slate-700 mb-3 flex items-center justify-center gap-1.5">
                      <QrCode className="h-4 w-4 text-purple-500" /> Scan QRIS
                    </h3>
                    {settings?.qrisImage ? (
                      <div className="bg-white p-3 rounded-2xl inline-block shadow-sm mb-3 mx-auto">
                        <img src={settings.qrisImage} alt="QRIS" className="w-44 h-44 object-contain mix-blend-multiply" />
                      </div>
                    ) : (
                      <div className="w-44 h-44 mx-auto bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 mb-3">
                        <QrCode className="h-10 w-10 mb-2 opacity-40" />
                        <span className="text-[10px] font-bold">QRIS belum diset</span>
                      </div>
                    )}
                    <p className="text-[11px] text-slate-500 font-medium">
                      Transfer tepat{" "}
                      <strong className="text-purple-600">Rp {(amount ?? 0).toLocaleString("id-ID")}</strong>
                      {" "}lalu screenshot buktinya
                    </p>
                  </div>

                  {/* Transfer Amount Field */}
                  <FormField control={form.control} name="transferAmount" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-extrabold text-slate-700 text-sm">
                        Jumlah yang kamu transfer <span className="text-red-500">*</span>
                      </FormLabel>
                      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-2 text-[11px] text-amber-700 font-medium flex items-start gap-2">
                        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                        HARUS sama persis dengan nominal. Nominal berbeda akan ditolak otomatis.
                      </div>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold">Rp</span>
                          <Input
                            type="number"
                            className={`pl-12 h-14 rounded-2xl text-lg font-extrabold bg-slate-50 border-2 focus-visible:ring-0 ${
                              field.value && amount && Number(field.value) !== Number(amount)
                                ? "border-red-400 bg-red-50"
                                : field.value && Number(field.value) === Number(amount)
                                ? "border-green-400 bg-green-50"
                                : "border-transparent"
                            }`}
                            placeholder={`${Number(amount).toLocaleString("id-ID")}`}
                            {...field}
                          />
                          {field.value && amount && Number(field.value) === Number(amount) && (
                            <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-green-500" />
                          )}
                          {field.value && amount && Number(field.value) !== Number(amount) && (
                            <AlertCircle className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-red-500" />
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Proof Upload */}
                  <FormField control={form.control} name="paymentProof" render={() => (
                    <FormItem>
                      <FormLabel className="font-extrabold text-slate-700 text-sm">Upload Bukti Transfer</FormLabel>
                      <FormControl>
                        <div className="mt-1">
                          <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

                          {uploadState === "success" && proofUrl && (
                            <div className="relative rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 w-full h-36 flex items-center justify-center">
                              <img src={proofUrl} alt="Bukti Transfer" className="h-full object-contain" />
                              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                                <CheckCircle2 className="h-7 w-7 text-green-400" />
                                <div className="flex gap-2">
                                  <Button type="button" size="sm" className="h-8 rounded-full bg-white text-slate-800 hover:bg-slate-100 text-xs font-bold" onClick={() => fileInputRef.current?.click()}>Ganti</Button>
                                  <Button type="button" size="sm" className="h-8 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs font-bold" onClick={resetProof}>Hapus</Button>
                                </div>
                              </div>
                            </div>
                          )}
                          {uploadState === "uploading" && (
                            <div className="h-36 rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50 flex flex-col items-center justify-center gap-3">
                              <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                              <div className="w-48">
                                <Progress value={uploadProgress} className="h-1.5 bg-purple-200" />
                                <p className="text-[10px] text-center font-bold text-purple-600 mt-2">Mengupload... {uploadProgress}%</p>
                              </div>
                            </div>
                          )}
                          {uploadState === "error" && uploadError && (
                            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
                              <AlertCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
                              <p className="font-bold text-xs text-red-600 mb-3">{uploadError.message}</p>
                              <Button type="button" size="sm" className="rounded-full h-8 bg-red-500 hover:bg-red-600 text-white font-bold" onClick={() => { setUploadState("idle"); fileInputRef.current?.click(); }}>Coba Lagi</Button>
                            </div>
                          )}
                          {uploadState === "idle" && (
                            <div onClick={() => fileInputRef.current?.click()} className="h-36 rounded-2xl border-2 border-dashed border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-colors flex flex-col items-center justify-center cursor-pointer bg-slate-50 gap-2">
                              <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                                <UploadCloud className="h-6 w-6 text-purple-500" />
                              </div>
                              <p className="text-xs font-extrabold text-slate-600">Klik untuk upload foto</p>
                              <p className="text-[10px] text-slate-400 font-medium">JPG, PNG, WebP • Maks 10 MB</p>
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Submit */}
                  <Button
                    type="submit"
                    className="w-full h-14 text-sm font-extrabold rounded-2xl bg-gradient-to-r from-purple-600 to-pink-500 shadow-lg shadow-purple-500/30 border-none gap-2"
                    disabled={createTopup.isPending || uploadState === "uploading" || !proofUrl || countdown === 0}
                  >
                    {createTopup.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                    {countdown === 0 ? "Waktu Habis" : "Konfirmasi Pembayaran"}
                  </Button>
                </div>
              </DrawerContent>
            </Drawer>
          </form>
        </Form>
      </AppLayout>
    </ProtectedRoute>
  );
}
