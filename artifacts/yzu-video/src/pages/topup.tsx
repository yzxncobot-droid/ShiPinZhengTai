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

const PRESET_AMOUNTS = [10000, 20000, 50000, 100000];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const topupSchema = z.object({
  amount: z.coerce.number().min(1000, { message: "Minimum top-up adalah Rp 1.000" }),
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

  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "success" | "error">("idle");
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
      return { code: "FORMAT_NOT_SUPPORTED", message: `Format "${file.type}" tidak didukung.`, detail: "Gunakan file JPG atau PNG." };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { code: "FILE_TOO_LARGE", message: `File terlalu besar.`, detail: "Maksimal 10 MB." };
    }
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploadProgress(0);

    const validationError = validateFile(file);
    if (validationError) {
      setUploadState("error");
      setUploadError(validationError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

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

    xhr.addEventListener("error", () => {
      setUploadState("error");
      setUploadError({ code: "NETWORK_ERROR", message: "Koneksi terputus." });
    });

    xhr.open("POST", "/api/upload/payment-proof");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
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
        <div className="container mx-auto px-4 py-8 max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 mb-3 shadow-sm">
              <Wallet className="h-8 w-8 text-orange-500" />
            </div>
            <h1 className="text-2xl font-heading font-extrabold text-slate-800">Top-up Saldo</h1>
            <p className="text-xs font-medium text-slate-500 mt-1">
              Saldo saat ini: <span className="text-purple-600 font-extrabold text-sm">Rp {user?.walletBalance?.toLocaleString("id-ID") ?? 0}</span>
            </p>
          </div>

          <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm mb-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-extrabold text-slate-700 text-sm">Mau isi berapa?</FormLabel>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {PRESET_AMOUNTS.map((preset) => (
                          <Button
                            key={preset}
                            type="button"
                            variant={field.value === preset ? "default" : "outline"}
                            className={`h-12 rounded-2xl font-extrabold text-sm transition-all border-none ${
                              field.value === preset 
                                ? "bg-orange-500 text-white shadow-md shadow-orange-500/30" 
                                : "bg-slate-50 text-slate-600 hover:bg-orange-50 hover:text-orange-600"
                            }`}
                            onClick={() => form.setValue("amount", preset, { shouldValidate: true })}
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
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                    Transfer sejumlah <strong className="text-orange-500 text-xs">Rp {amount ? Number(amount).toLocaleString("id-ID") : 0}</strong> dan screenshot bukti transaksinya.
                  </p>
                </div>

                <FormField
                  control={form.control}
                  name="paymentProof"
                  render={() => (
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
                  )}
                />

                <Button type="submit" className="w-full h-14 text-sm font-extrabold rounded-2xl bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/30 border-none" disabled={createTopup.isPending || uploadState === "uploading" || !proofUrl}>
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
