import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useCreateTopup, useGetSettings } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Wallet, QrCode, UploadCloud, Loader2, Info, CheckCircle2, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

const PRESET_AMOUNTS = [5000, 10000, 15000, 20000, 25000, 50000, 100000];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const topupSchema = z.object({
  amount: z.coerce.number().min(5000, { message: "Minimum top-up adalah Rp 5.000" }),
  paymentProof: z.string().min(1, { message: "Bukti transfer wajib diupload" }),
});

interface UploadError {
  code: string;
  message: string;
  detail?: string;
}

export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: settings } = useGetSettings();
  const createTopup = useCreateTopup();

  const [uploadState, setUploadState] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof topupSchema>>({
    resolver: zodResolver(topupSchema),
    defaultValues: { amount: 10000, paymentProof: "" },
  });

  const amount = form.watch("amount");

  const validateFile = (file: File): UploadError | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return {
        code: "FORMAT_NOT_SUPPORTED",
        message: `Format "${file.type || "tidak diketahui"}" tidak didukung.`,
        detail: "Gunakan file JPG, JPEG, PNG, atau WEBP.",
      };
    }
    if (file.size > MAX_FILE_SIZE) {
      return {
        code: "FILE_TOO_LARGE",
        message: `Ukuran file ${(file.size / 1024 / 1024).toFixed(1)} MB melebihi batas 10 MB.`,
        detail: "Kompres gambar terlebih dahulu sebelum upload.",
      };
    }
    if (!token) {
      return {
        code: "UNAUTHORIZED",
        message: "Anda belum login.",
        detail: "Silakan login ulang lalu coba lagi.",
      };
    }
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset state
    setUploadError(null);
    setUploadProgress(0);

    // Client-side validation
    const validationError = validateFile(file);
    if (validationError) {
      setUploadState("error");
      setUploadError(validationError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Upload via XHR to track progress
    setUploadState("uploading");
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (ev) => {
      if (ev.lengthComputable) {
        setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          form.setValue("paymentProof", data.url, { shouldValidate: true });
          setUploadState("success");
          setUploadProgress(100);
          toast({
            title: "✅ Bukti transfer berhasil diupload",
            description: "File tersimpan di Supabase Storage.",
          });
        } else {
          setUploadState("error");
          setUploadError({
            code: data.error ?? "SERVER_ERROR",
            message: data.message ?? "Upload gagal di server.",
            detail: data.supabaseMessage ?? data.detail ?? `HTTP ${xhr.status}`,
          });
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      } catch {
        setUploadState("error");
        setUploadError({
          code: "PARSE_ERROR",
          message: "Respons server tidak terbaca.",
          detail: xhr.responseText?.slice(0, 200),
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });

    xhr.addEventListener("error", () => {
      setUploadState("error");
      setUploadError({
        code: "CONNECTION_FAILED",
        message: "Koneksi gagal. Periksa internet Anda.",
        detail: "XMLHttpRequest network error",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    });

    xhr.addEventListener("timeout", () => {
      setUploadState("error");
      setUploadError({
        code: "TIMEOUT",
        message: "Upload melebihi batas waktu.",
        detail: "Coba lagi dengan file yang lebih kecil atau koneksi yang lebih baik.",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    });

    xhr.timeout = 60000; // 60 s
    xhr.open("POST", "/api/upload/payment-proof");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
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
      { data: values },
      {
        onSuccess: () => {
          toast({
            title: "Top-up Terkirim",
            description: "Permintaan top-up Anda sedang menunggu konfirmasi admin.",
          });
          setLocation("/history");
        },
        onError: (err: any) => {
          toast({
            title: "Gagal Mengirim",
            description: err?.message ?? "Terjadi kesalahan, coba lagi.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const proofUrl = form.watch("paymentProof");

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="container mx-auto px-4 md:px-6 py-12 max-w-4xl">
          <div className="flex flex-col md:flex-row gap-8 items-start">

            {/* Left: Form */}
            <div className="w-full md:w-1/2 space-y-6">
              <div>
                <h1 className="text-3xl font-heading font-bold mb-2">Wallet Top-up</h1>
                <p className="text-muted-foreground">
                  Tambahkan saldo ke wallet menggunakan QRIS untuk membeli konten premium dan langganan.
                </p>
              </div>

              {/* Balance */}
              <div className="bg-card border border-border/50 rounded-2xl p-6 flex items-center gap-4 shadow-sm">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Saldo Saat Ini</p>
                  <p className="text-2xl font-bold tracking-tight">
                    Rp {user?.walletBalance?.toLocaleString("id-ID") ?? 0}
                  </p>
                </div>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                  {/* Amount selector */}
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pilih Nominal</FormLabel>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                          {PRESET_AMOUNTS.map((preset) => (
                            <Button
                              key={preset}
                              type="button"
                              variant={field.value === preset ? "default" : "outline"}
                              className={`rounded-xl ${field.value === preset ? "shadow-md shadow-primary/20" : "bg-card hover:bg-muted"}`}
                              onClick={() => form.setValue("amount", preset, { shouldValidate: true })}
                            >
                              {preset / 1000}K
                            </Button>
                          ))}
                        </div>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                              Rp
                            </span>
                            <Input
                              type="number"
                              className="pl-12 h-12 text-lg font-medium bg-card"
                              placeholder="Nominal lainnya"
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* QRIS */}
                  <div className="bg-muted/30 p-6 rounded-2xl border border-border border-dashed">
                    <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
                      <QrCode className="h-5 w-5 text-primary" /> Scan untuk Bayar
                    </h3>
                    {settings?.qrisImage ? (
                      <div className="bg-white p-4 rounded-xl inline-block shadow-sm">
                        <img
                          src={settings.qrisImage}
                          alt="QRIS"
                          className="w-48 h-48 object-contain mix-blend-multiply"
                        />
                      </div>
                    ) : (
                      <div className="w-48 h-48 bg-card border rounded-xl flex items-center justify-center flex-col text-muted-foreground">
                        <QrCode className="h-10 w-10 mb-2 opacity-50" />
                        <span className="text-xs">QRIS belum dikonfigurasi</span>
                      </div>
                    )}
                    <Alert className="mt-6 bg-card">
                      <Info className="h-4 w-4" />
                      <AlertTitle>Cara Transfer</AlertTitle>
                      <AlertDescription className="text-muted-foreground">
                        1. Scan QR dengan aplikasi banking atau e-wallet Anda.<br />
                        2. Transfer tepat{" "}
                        <strong>Rp {amount ? Number(amount).toLocaleString("id-ID") : 0}</strong>.<br />
                        3. Screenshot bukti transfer berhasil.<br />
                        4. Upload screenshot di bawah ini.
                      </AlertDescription>
                    </Alert>
                  </div>

                  {/* Payment proof upload */}
                  <FormField
                    control={form.control}
                    name="paymentProof"
                    render={() => (
                      <FormItem>
                        <FormLabel>Bukti Transfer</FormLabel>
                        <FormControl>
                          <div className="mt-2 space-y-3">
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                              className="hidden"
                              ref={fileInputRef}
                              onChange={handleFileChange}
                            />

                            {/* Success state */}
                            {uploadState === "success" && proofUrl && (
                              <div className="relative rounded-xl overflow-hidden border border-green-500/40 group w-fit">
                                <img src={proofUrl} alt="Bukti Transfer" className="h-36 object-cover" />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                  >
                                    Ganti
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={resetProof}
                                  >
                                    Hapus
                                  </Button>
                                </div>
                                <div className="absolute top-2 right-2 bg-green-500 rounded-full p-0.5">
                                  <CheckCircle2 className="h-4 w-4 text-white" />
                                </div>
                              </div>
                            )}

                            {/* Uploading state */}
                            {uploadState === "uploading" && (
                              <div className="border-2 border-dashed border-primary/50 rounded-xl p-8 flex flex-col items-center justify-center gap-4 bg-card/50">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <div className="w-full max-w-xs space-y-1">
                                  <Progress value={uploadProgress} className="h-2" />
                                  <p className="text-xs text-center text-muted-foreground">
                                    Mengupload ke Supabase Storage… {uploadProgress}%
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Error state */}
                            {uploadState === "error" && uploadError && (
                              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-2">
                                <div className="flex items-start gap-2">
                                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm text-destructive">{uploadError.message}</p>
                                    {uploadError.detail && (
                                      <p className="text-xs text-muted-foreground mt-1 break-words">
                                        {uploadError.detail}
                                      </p>
                                    )}
                                    <p className="text-xs text-muted-foreground/60 mt-1 font-mono">
                                      [{uploadError.code}]
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={resetProof}
                                    className="shrink-0 text-muted-foreground hover:text-foreground"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full"
                                  onClick={() => {
                                    setUploadState("idle");
                                    setUploadError(null);
                                    setTimeout(() => fileInputRef.current?.click(), 50);
                                  }}
                                >
                                  Coba Lagi
                                </Button>
                              </div>
                            )}

                            {/* Idle state */}
                            {uploadState === "idle" && (
                              <div
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-card/50"
                              >
                                <UploadCloud className="h-10 w-10 text-muted-foreground mb-3" />
                                <p className="text-sm font-medium">Klik untuk upload bukti transfer</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  JPG, JPEG, PNG, WEBP — Maks. 10 MB
                                </p>
                              </div>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full h-12 text-md rounded-xl"
                    disabled={createTopup.isPending || uploadState === "uploading" || !proofUrl}
                  >
                    {createTopup.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Kirim Permintaan Top-up
                  </Button>
                </form>
              </Form>
            </div>

            {/* Right: Info */}
            <div className="w-full md:w-1/2 md:pl-8">
              <div className="bg-card/50 border border-border/50 rounded-2xl p-6 sticky top-24">
                <h3 className="font-heading font-semibold text-lg mb-4">Riwayat Top-up</h3>
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <Wallet className="h-12 w-12 opacity-20 mb-3" />
                  <p>
                    Lihat{" "}
                    <Link href="/history" className="text-primary hover:underline">
                      Riwayat
                    </Link>{" "}
                    untuk semua transaksi dan statusnya.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
