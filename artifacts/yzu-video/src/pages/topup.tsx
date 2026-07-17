import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useCreateTopup, useGetSettings } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Wallet, QrCode, UploadCloud, Loader2, CheckCircle2, X, AlertCircle,
  ShieldAlert, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_AMOUNTS = [5000, 10000, 20000, 50000];
const MAX_FILE_SIZE  = 10 * 1024 * 1024;
const ALLOWED_TYPES  = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const LS_KEY         = "topup_rules_ack";

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

function shouldShowModal(sessionKey: string): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return true;
    const { ts, sk } = JSON.parse(raw) as { ts: number; sk: string };
    if (sk !== sessionKey) return true;                      // new login session
    if (Date.now() - ts > 24 * 60 * 60 * 1000) return true; // 24 h expired
    return false;
  } catch {
    return true;
  }
}

function ackModal(sessionKey: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), sk: sessionKey }));
}

// ─── Rules Modal ─────────────────────────────────────────────────────────────

const RULES = [
  "The transfer amount MUST be exactly the same as the nominal top up selected.",
  "If the transferred amount is different from the selected nominal, the payment will be automatically rejected.",
  "Make sure the payment proof is clear and readable.",
  "Payments from invalid or edited screenshots will be rejected.",
  "Only upload payment proof after the transfer has been completed.",
  "Double-check the nominal before submitting your payment.",
  "Processing will only begin after the admin reviews the payment.",
];

function TopUpRulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-sm w-[95vw] rounded-3xl border-0 p-0 overflow-hidden shadow-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-amber-400 via-orange-400 to-orange-500 px-6 pt-6 pb-5 text-center relative">
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
            <ShieldAlert className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-white font-extrabold text-lg leading-tight">⚠️ Important Top Up Rules</h2>
          <p className="text-orange-100 text-xs mt-1 font-medium">Please read before making a payment</p>
        </div>

        {/* Body */}
        <div className="bg-white px-5 pt-4 pb-5 space-y-3 max-h-[55vh] overflow-y-auto">
          <ol className="space-y-2.5">
            {RULES.map((rule, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-100 text-orange-600 font-extrabold text-xs flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-snug">{rule}</span>
              </li>
            ))}
          </ol>

          {/* Example box */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 mt-1 space-y-2">
            <p className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">Example</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-green-50 border border-green-200 rounded-xl p-2.5 text-center">
                <p className="text-[10px] text-slate-500 font-bold mb-1">Selected Top Up</p>
                <p className="font-extrabold text-slate-800 text-sm">Rp 5.000</p>
                <p className="text-[10px] text-slate-500 font-bold mt-1">Transferred</p>
                <p className="font-extrabold text-green-600 text-sm">Rp 5.000 ✅</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 text-center">
                <p className="text-[10px] text-slate-500 font-bold mb-1">Selected Top Up</p>
                <p className="font-extrabold text-slate-800 text-sm">Rp 5.000</p>
                <p className="text-[10px] text-slate-500 font-bold mt-1">Transferred</p>
                <p className="font-extrabold text-red-500 text-sm">Rp 1.000 ❌</p>
                <p className="text-[9px] text-red-400 font-bold mt-0.5">Rejected</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white px-5 pb-5 pt-1">
          <Button
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-extrabold text-sm shadow-lg shadow-orange-500/30 gap-2"
            onClick={onClose}
          >
            I Understand <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const topupSchema = z.object({
  amount:         z.coerce.number().min(100, "Minimum top-up adalah Rp 100"),
  transferAmount: z.coerce.number().min(100, "Masukkan jumlah yang kamu transfer"),
  paymentProof:   z.string().min(1, "Bukti transfer wajib diupload"),
}).superRefine((data, ctx) => {
  if (data.transferAmount && data.amount && data.transferAmount !== data.amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferAmount"],
      message: "Jumlah transfer harus sama persis dengan nominal top-up yang dipilih. Pembayaran dengan nominal berbeda akan otomatis ditolak.",
    });
  }
});

interface UploadError { code: string; message: string; detail?: string }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: settings }  = useGetSettings();
  const createTopup = useCreateTopup();

  // Session key is first 10 chars of JWT (changes on every login)
  const sessionKey = (token ?? "anon").slice(0, 10);

  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (shouldShowModal(sessionKey)) setShowModal(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCloseModal = () => {
    ackModal(sessionKey);
    setShowModal(false);
  };

  const [uploadState, setUploadState]   = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError]   = useState<UploadError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof topupSchema>>({
    resolver: zodResolver(topupSchema),
    defaultValues: { amount: 10000, transferAmount: 10000, paymentProof: "" },
  });

  const amount = form.watch("amount");

  // Keep transferAmount in sync when user picks a preset so the field pre-fills
  const setPreset = (preset: number) => {
    form.setValue("amount", preset, { shouldValidate: true });
    form.setValue("transferAmount", preset, { shouldValidate: true });
  };

  // ── File upload ──────────────────────────────────────────────────────────────

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
          toast({ title: "✅ Sip!", description: "Bukti transfer berhasil diupload." });
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

  // ── Submit ───────────────────────────────────────────────────────────────────

  const onSubmit = (values: z.infer<typeof topupSchema>) => {
    createTopup.mutate(
      { data: { amount: values.amount, transferAmount: values.transferAmount, paymentProof: values.paymentProof } as any },
      {
        onSuccess: () => {
          toast({ title: "Terkirim! 🚀", description: "Tunggu admin memproses ya." });
          setLocation("/history");
        },
        onError: (err: any) => {
          toast({ title: "Gagal", description: err?.message || "Coba lagi nanti.", variant: "destructive" });
        },
      },
    );
  };

  const proofUrl = form.watch("paymentProof");

  return (
    <ProtectedRoute>
      <AppLayout>
        {/* Rules Modal */}
        <TopUpRulesModal open={showModal} onClose={handleCloseModal} />

        <div className="container mx-auto px-4 py-8 max-w-md">
          {/* Header */}
          <div className="text-center mb-7">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 mb-3 shadow-sm">
              <Wallet className="h-8 w-8 text-orange-500" />
            </div>
            <h1 className="text-2xl font-heading font-extrabold text-slate-800">Top-up Saldo</h1>
            <p className="text-xs font-medium text-slate-500 mt-1">
              Saldo saat ini:{" "}
              <span className="text-purple-600 font-extrabold text-sm">
                Rp {user?.walletBalance?.toLocaleString("id-ID") ?? 0}
              </span>
            </p>
            {/* Re-open rules button */}
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1 rounded-full transition-colors"
            >
              <ShieldAlert className="h-3 w-3" /> Lihat Aturan Top Up
            </button>
          </div>

          <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm mb-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                {/* ── Amount selection ── */}
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-extrabold text-slate-700 text-sm">Mau isi berapa?</FormLabel>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {PRESET_AMOUNTS.map((preset) => (
                        <Button
                          key={preset} type="button"
                          variant={field.value === preset ? "default" : "outline"}
                          className={`h-12 rounded-2xl font-extrabold text-sm transition-all border-none ${
                            field.value === preset
                              ? "bg-orange-500 text-white shadow-md shadow-orange-500/30"
                              : "bg-slate-50 text-slate-600 hover:bg-orange-50 hover:text-orange-600"
                          }`}
                          onClick={() => setPreset(preset)}
                        >
                          Rp {(preset / 1000).toLocaleString()}rb
                        </Button>
                      ))}
                    </div>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold">Rp</span>
                        <Input
                          type="number"
                          className="pl-12 h-14 rounded-2xl text-lg font-extrabold bg-slate-50 border-transparent focus-visible:ring-orange-500"
                          placeholder="Nominal lain"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            // sync transferAmount when typing custom amount
                            const v = Number(e.target.value);
                            if (!isNaN(v)) form.setValue("transferAmount", v, { shouldValidate: false });
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* ── QRIS ── */}
                <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 text-center">
                  <h3 className="font-heading font-extrabold text-sm text-slate-700 mb-3 flex items-center justify-center gap-1.5">
                    <QrCode className="h-4 w-4 text-purple-500" /> Scan QRIS di bawah ini
                  </h3>
                  {settings?.qrisImage ? (
                    <div className="bg-white p-3 rounded-2xl inline-block shadow-sm mb-3">
                      <img src={settings.qrisImage} alt="QRIS" className="w-40 h-40 object-contain mix-blend-multiply" />
                    </div>
                  ) : (
                    <div className="w-40 h-40 mx-auto bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 mb-3">
                      <QrCode className="h-8 w-8 mb-2 opacity-50" />
                      <span className="text-[10px] font-bold">QRIS belum diset</span>
                    </div>
                  )}
                  <p className="text-[11px] font-medium text-slate-500 px-4">
                    Transfer sejumlah{" "}
                    <strong className="text-orange-500 text-xs">
                      Rp {amount ? Number(amount).toLocaleString("id-ID") : 0}
                    </strong>{" "}
                    lalu screenshot bukti transaksinya.
                  </p>
                </div>

                {/* ── Transfer Amount field ── */}
                <FormField control={form.control} name="transferAmount" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-extrabold text-slate-700 text-sm">
                      Jumlah yang kamu transfer{" "}
                      <span className="text-red-500">*</span>
                    </FormLabel>
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-2 text-[11px] text-amber-700 font-medium flex items-start gap-2">
                      <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                      Jumlah ini HARUS sama persis dengan nominal top-up yang kamu pilih. Nominal berbeda akan otomatis ditolak.
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

                {/* ── Payment Proof ── */}
                <FormField control={form.control} name="paymentProof" render={() => (
                  <FormItem>
                    <FormLabel className="font-extrabold text-slate-700 text-sm">Upload Bukti Transfer</FormLabel>
                    <FormControl>
                      <div className="mt-1">
                        <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

                        {uploadState === "success" && proofUrl && (
                          <div className="relative rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 group w-full h-32 flex items-center justify-center">
                            <img src={proofUrl} alt="Bukti Transfer" className="h-full object-contain" />
                            <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                              <CheckCircle2 className="h-6 w-6 text-green-400 mb-1" />
                              <div className="flex gap-2">
                                <Button type="button" size="sm" className="h-8 rounded-full bg-white text-slate-800 hover:bg-slate-100 text-xs font-bold" onClick={() => fileInputRef.current?.click()}>Ganti</Button>
                                <Button type="button" size="sm" className="h-8 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs font-bold" onClick={resetProof}>Hapus</Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {uploadState === "uploading" && (
                          <div className="h-32 rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50 flex flex-col items-center justify-center gap-3">
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
                          <div onClick={() => fileInputRef.current?.click()} className="h-32 rounded-2xl border-2 border-dashed border-slate-200 hover:border-orange-400 hover:bg-orange-50 transition-colors flex flex-col items-center justify-center cursor-pointer bg-slate-50">
                            <UploadCloud className="h-8 w-8 text-slate-400 mb-2" />
                            <p className="text-xs font-extrabold text-slate-600">Klik untuk upload foto</p>
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* ── Submit ── */}
                <Button
                  type="submit"
                  className="w-full h-14 text-sm font-extrabold rounded-2xl bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/30 border-none"
                  disabled={createTopup.isPending || uploadState === "uploading" || !proofUrl}
                >
                  {createTopup.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                  Kirim Bukti
                </Button>

              </form>
            </Form>
          </div>

          <div className="text-center">
            <Link href="/history" className="text-[11px] font-bold text-slate-500 hover:text-purple-600">
              Lihat Riwayat Top-up →
            </Link>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
