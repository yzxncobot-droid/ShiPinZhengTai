import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AppLayout } from "@/components/layout/AppLayout";
import { adminFetch } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, UploadCloud, Video as VideoIcon,
  Link as LinkIcon, CheckCircle2, Globe, Sparkles, ShieldAlert,
  Gift, Heart, MessageCircle, KeyRound,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { motion } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────
type VideoSourceType = "upload" | "external_link";
type RewardType = "LIKE" | "COMMENT";

const REWARD_TYPE_OPTIONS: { value: RewardType; label: string; icon: React.ElementType; color: string }[] = [
  { value: "LIKE",    label: "Like",    icon: Heart,         color: "border-rose-400 bg-rose-50 text-rose-700" },
  { value: "COMMENT", label: "Komentar", icon: MessageCircle, color: "border-sky-400 bg-sky-50 text-sky-700" },
];

function isValidVideoLink(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\.(mp4|webm|mov|avi|mkv|m3u8)(\?.*)?$/i.test(u.pathname)) return true;
    if (/youtube\.com|youtu\.be/.test(u.hostname)) return true;
    if (/vimeo\.com/.test(u.hostname)) return true;
    if (u.hostname === "drive.google.com") return true;
    return false;
  } catch { return false; }
}

const uploadSchema = z.object({
  title:           z.string().min(3, "Judul minimal 3 karakter"),
  description:     z.string().optional(),
  videoSourceType: z.enum(["upload", "external_link"]).default("upload"),
  videoUrl:        z.string().min(1, "Video wajib diisi"),
  videoFilePath:   z.string().optional(),
  // ── Kode progres (reward) ──
  rewardEnabled: z.boolean().default(false),
  rewardType:    z.enum(["LIKE", "COMMENT"]).default("LIKE"),
  rewardTarget:  z.coerce.number().int().min(1, "Minimal 1").default(10),
  rewardCode:    z.string().default(""),
}).superRefine((data, ctx) => {
  if (data.videoSourceType === "external_link" && data.videoUrl && !isValidVideoLink(data.videoUrl)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["videoUrl"], message: "Link tidak valid." });
  }
  if (data.rewardEnabled) {
    if (!data.rewardCode.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rewardCode"], message: "Kode wajib diisi" });
    }
    if (!data.rewardTarget || data.rewardTarget < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rewardTarget"], message: "Jumlah minimal 1" });
    }
  }
});

type UploadForm = z.infer<typeof uploadSchema>;

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({ icon, title, gradient, children }: {
  icon: React.ReactNode; title: string; gradient: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-slate-100">
      <div className={`${gradient} px-5 py-3 flex items-center gap-2`}>
        <span className="text-white">{icon}</span>
        <h2 className="text-white font-bold text-base">{title}</h2>
      </div>
      <div className="bg-white p-5 space-y-4">{children}</div>
    </div>
  );
}

// ─── Not Authorized ───────────────────────────────────────────────────────────
function NotAuthorized() {
  const [, setLocation] = useLocation();
  return (
    <AppLayout>
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="h-20 w-20 bg-red-100 rounded-full flex items-center justify-center">
          <ShieldAlert className="h-10 w-10 text-red-500" />
        </div>
        <h2 className="text-xl font-heading font-extrabold text-slate-800">Akses Ditolak</h2>
        <p className="text-slate-500 text-sm max-w-sm">
          Halaman upload video hanya bisa digunakan oleh <strong>Owner</strong>.
        </p>
        <Button onClick={() => setLocation("/")} className="rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold">
          Kembali ke Beranda
        </Button>
      </div>
    </AppLayout>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CreatorUploadPage() {
  const { user, token, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isSubmitting, setIsSubmitting]         = useState(false);
  const [uploadProgress, setUploadProgress]     = useState(0);
  const [xhrRef] = useState<{ current: XMLHttpRequest | null }>({ current: null });

  const videoInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      title: "", description: "",
      videoSourceType: "upload", videoUrl: "", videoFilePath: "",
      rewardEnabled: false, rewardType: "LIKE", rewardTarget: 10, rewardCode: "",
    },
  });

  const videoSourceType = form.watch("videoSourceType");
  const rewardEnabled   = form.watch("rewardEnabled");
  const rewardType      = form.watch("rewardType");

  // ── File upload (Home Feed video → MEDIA Supabase) ───────────────────────────
  const handleFileUpload = async (file: File) => {
    setIsUploadingVideo(true);
    setUploadProgress(0);
    const fd = new FormData();
    fd.append("video", file);

    try {
      const data = await new Promise<{ url: string; path?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          let parsed: any = null;
          try { parsed = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && parsed?.success !== false) {
            resolve(parsed);
          } else {
            const serverMsg = parsed?.message ?? "Upload gagal";
            const serverDetail = parsed?.detail ? ` — ${parsed.detail}` : "";
            reject(new Error(`${serverMsg}${serverDetail}`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Tidak dapat terhubung ke server. Periksa koneksi internet.")));
        xhr.open("POST", "/api/upload/home-feed-video");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(fd);
      });

      form.setValue("videoUrl", data.url, { shouldValidate: true });
      if (data.path) form.setValue("videoFilePath", data.path);
      toast({ title: "Video berhasil diupload! ✅" });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setIsUploadingVideo(false);
      setUploadProgress(0);
      xhrRef.current = null;
    }
  };

  const cancelUpload = () => {
    xhrRef.current?.abort();
    setIsUploadingVideo(false);
    setUploadProgress(0);
    toast({ title: "Upload dibatalkan" });
  };

  const switchSource = (t: VideoSourceType) => {
    form.setValue("videoSourceType", t);
    form.setValue("videoUrl", "");
    form.setValue("videoFilePath", "");
    form.clearErrors("videoUrl");
  };

  // ── Submit → POST /admin/home-feed ───────────────────────────────────────────
  const onSubmit = async (values: UploadForm) => {
    setIsSubmitting(true);
    try {
      await adminFetch("/admin/home-feed", {
        method: "POST",
        body: JSON.stringify({
          title: values.title,
          description: values.description || null,
          videoUrl: values.videoUrl,
          thumbnail: null,
          status: "published",
          isActive: true,
          rewardType: values.rewardEnabled ? values.rewardType : "NONE",
          rewardTarget: values.rewardEnabled ? Number(values.rewardTarget) : 0,
          rewardCode: values.rewardEnabled ? values.rewardCode.trim() : "",
        }),
      });
      toast({ title: "🎉 Video Home berhasil dipublikasi!" });
      setLocation("/");
    } catch (err: any) {
      toast({ title: "Gagal mempublikasi", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Auth guard ───────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        </div>
      </AppLayout>
    );
  }
  if (!token || !user) {
    setLocation("/login");
    return null;
  }

  // Only the owner can use the home video upload.
  if (user?.role !== "owner") {
    return <NotAuthorized />;
  }

  return (
    <AppLayout>
      <div className="px-4 py-6 max-w-2xl mx-auto">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-3 shadow-sm">
            <Sparkles className="h-3 w-3" />
            Home Feed
          </div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-800">Upload Video Home</h1>
          <p className="text-slate-500 text-sm mt-1">Publish video ke feed beranda</p>
        </motion.div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

            {/* ── Video Source ── */}
            <SectionCard icon={<VideoIcon className="h-4 w-4" />} title="Sumber Video" gradient="bg-gradient-to-r from-sky-400 to-blue-500">
              <div className="grid grid-cols-2 gap-3">
                {(["upload", "external_link"] as const).map((src) => (
                  <button
                    key={src} type="button" onClick={() => switchSource(src)}
                    className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all font-medium text-sm
                      ${videoSourceType === src
                        ? src === "upload" ? "border-sky-400 bg-sky-50 text-sky-700 shadow-sm" : "border-orange-400 bg-orange-50 text-orange-700 shadow-sm"
                        : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"
                      }`}
                  >
                    {src === "upload"
                      ? <UploadCloud className={`h-6 w-6 ${videoSourceType === "upload" ? "text-sky-500" : "text-slate-400"}`} />
                      : <LinkIcon className={`h-6 w-6 ${videoSourceType === "external_link" ? "text-orange-500" : "text-slate-400"}`} />
                    }
                    <span>{src === "upload" ? "Upload File" : "Link Video"}</span>
                    <span className="text-[10px] text-slate-400">
                      {src === "upload" ? "MP4, MOV, WebM" : "YouTube, Vimeo, MP4"}
                    </span>
                  </button>
                ))}
              </div>

              {/* Upload File */}
              {videoSourceType === "upload" && (
                <FormField control={form.control} name="videoUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold">File Video <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <div>
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                          className="hidden" ref={videoInputRef}
                          onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                        />
                        {field.value ? (
                          <div className="border-2 border-sky-200 bg-sky-50 rounded-xl p-4 flex flex-col items-center gap-2">
                            <CheckCircle2 className="h-8 w-8 text-sky-500" />
                            <p className="text-sm font-semibold text-sky-700">Video siap dipublikasi</p>
                            <Button type="button" variant="outline" size="sm" onClick={() => videoInputRef.current?.click()} className="border-sky-300 text-sky-600">
                              Ganti Video
                            </Button>
                          </div>
                        ) : (
                          <div
                            onClick={() => !isUploadingVideo && videoInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer h-44 transition-colors
                              ${isUploadingVideo ? "border-sky-300 bg-sky-50 pointer-events-none" : "border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-sky-50"}`}
                          >
                            {isUploadingVideo ? (
                              <div className="w-full max-w-xs text-center space-y-3">
                                <Loader2 className="h-7 w-7 animate-spin text-sky-500 mx-auto" />
                                <p className="text-sm font-semibold text-sky-700">Mengupload… {uploadProgress}%</p>
                                <div className="w-full bg-sky-100 h-2.5 rounded-full overflow-hidden">
                                  <div className="bg-gradient-to-r from-sky-400 to-blue-500 h-full rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                                </div>
                                <Button type="button" size="sm" variant="outline" onClick={cancelUpload} className="border-red-200 text-red-500 hover:bg-red-50 text-xs">
                                  Batalkan Upload
                                </Button>
                              </div>
                            ) : (
                              <>
                                <UploadCloud className="h-9 w-9 text-sky-400 mb-2" />
                                <p className="text-sm font-semibold text-slate-700">Pilih atau drag file video</p>
                                <p className="text-xs text-slate-400 mt-1">MP4, MOV, WebM • maks 500 MB</p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {/* External Link */}
              {videoSourceType === "external_link" && (
                <FormField control={form.control} name="videoUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold">URL Video <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
                        <Input {...field} placeholder="https://youtube.com/watch?v=... atau link MP4" className="pl-9 border-orange-200 focus:border-orange-400" />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </SectionCard>

            {/* ── Video Details ── */}
            <SectionCard icon={<Sparkles className="h-4 w-4" />} title="Detail Video" gradient="bg-gradient-to-r from-emerald-500 to-teal-500">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Judul <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Judul video yang menarik..." className="border-emerald-200 focus:border-emerald-400" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Deskripsi</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Ceritakan tentang video ini..." rows={3} className="border-emerald-200 focus:border-emerald-400 resize-none" />
                  </FormControl>
                </FormItem>
              )} />
            </SectionCard>

            {/* ── Kode Progres (Reward) ── */}
            <SectionCard icon={<Gift className="h-4 w-4" />} title="Kode Progres" gradient="bg-gradient-to-r from-violet-500 to-purple-600">
              {/* On/Off toggle */}
              <FormField control={form.control} name="rewardEnabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-xl border border-slate-100 p-3 bg-slate-50">
                  <div>
                    <FormLabel className="font-semibold">Aktifkan Kode Progres</FormLabel>
                    <FormDescription className="text-xs">Buka kode setelah target like/komentar tercapai</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />

              {/* Reward config — only when enabled */}
              {rewardEnabled && (
                <div className="space-y-4 pt-1">
                  {/* Reward type: Like / Komentar */}
                  <FormField control={form.control} name="rewardType" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold">Tipe Progres</FormLabel>
                      <FormControl>
                        <div className="grid grid-cols-2 gap-3">
                          {REWARD_TYPE_OPTIONS.map((opt) => {
                            const Icon = opt.icon;
                            const isSelected = field.value === opt.value;
                            return (
                              <button
                                key={opt.value} type="button"
                                onClick={() => field.onChange(opt.value)}
                                className={`flex flex-col items-center gap-1.5 py-4 px-2 rounded-xl border-2 transition-all font-medium text-sm
                                  ${isSelected ? opt.color + " shadow-sm scale-[1.02]" : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"}`}
                              >
                                <Icon className={`h-6 w-6 ${isSelected ? "" : "text-slate-400"}`} />
                                <span className="font-extrabold text-[12px]">{opt.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Target count */}
                  <FormField control={form.control} name="rewardTarget" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold">
                        Jumlah {rewardType === "LIKE" ? "Like" : "Komentar"} agar kode terbuka <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="number" min={1} placeholder="contoh: 100" className="border-violet-200 focus:border-violet-400" {...field} />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Kode akan terbuka otomatis saat video mencapai jumlah ini
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Reward code */}
                  <FormField control={form.control} name="rewardCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-semibold">Kode <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <div className="relative">
                          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-violet-400" />
                          <Input {...field} placeholder="contoh: FUN100X" className="pl-9 border-violet-200 focus:border-violet-400 uppercase tracking-wider" />
                        </div>
                      </FormControl>
                      <FormDescription className="text-xs">Kode ini akan ditampilkan ke penonton setelah target tercapai</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}
            </SectionCard>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isSubmitting || isUploadingVideo}
              className="w-full h-12 rounded-full font-extrabold bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/30 gap-2"
            >
              {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Mempublikasi...</> : "🚀 Publikasikan Video"}
            </Button>
          </form>
        </Form>
      </div>
    </AppLayout>
  );
}
