import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListCategories, useListBundles } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, UploadCloud, Video as VideoIcon, Image as ImageIcon,
  Link as LinkIcon, CheckCircle2, Globe, Sparkles, Package, ShieldAlert,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { motion } from "framer-motion";

// ─── Type helpers ─────────────────────────────────────────────────────────────
type UserWithBadge = { creatorBadge?: boolean; verifiedCreator?: boolean } & Record<string, any>;

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTENT_TYPE_OPTIONS = [
  {
    value: "public",
    label: "Video Gratis",
    icon: "🌍",
    description: "Semua orang bisa menonton",
    color: "border-green-400 bg-green-50 text-green-700",
  },
  {
    value: "premium",
    label: "Video Premium",
    icon: "⭐",
    description: "Butuh langganan atau pembelian",
    color: "border-amber-400 bg-amber-50 text-amber-700",
  },
  {
    value: "hidden_bundle",
    label: "Video Bundle",
    icon: "📦",
    description: "Eksklusif dalam paket bundle",
    color: "border-purple-400 bg-purple-50 text-purple-700",
  },
] as const;

type VideoSourceType = "upload" | "external_link";

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
  categoryId:      z.string().optional(),
  visibility:      z.enum(["public", "premium", "hidden_bundle"]).default("public"),
  bundleId:        z.string().optional(),
  price:           z.coerce.number().min(0).optional(),
  downloadable:    z.boolean().default(false),
  videoSourceType: z.enum(["upload", "external_link"]).default("upload"),
  videoUrl:        z.string().min(1, "Video wajib diisi"),
  videoFilePath:   z.string().optional(),
  thumbnail:       z.string().optional(),
  tags:            z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.videoSourceType === "external_link" && data.videoUrl && !isValidVideoLink(data.videoUrl)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["videoUrl"], message: "Link tidak valid." });
  }
  if (data.visibility === "hidden_bundle" && !data.bundleId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bundleId"], message: "Pilih bundle tujuan" });
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
          Kamu membutuhkan <strong>Creator Badge</strong> untuk mengakses halaman ini.
          Hubungi admin untuk mendapatkan akses.
        </p>
        <Button onClick={() => setLocation("/profile")} className="rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold">
          Kembali ke Profil
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
  const u = user as UserWithBadge | null | undefined;

  const { data: categoriesRaw } = useListCategories();
  const { data: bundlesRaw } = useListBundles();
  const categories: any[] = Array.isArray(categoriesRaw) ? categoriesRaw : (categoriesRaw as any)?.data ?? [];
  const bundles: any[] = Array.isArray(bundlesRaw) ? bundlesRaw : (bundlesRaw as any)?.data ?? [];

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const [isSubmitting, setIsSubmitting]         = useState(false);
  const [uploadProgress, setUploadProgress]     = useState(0);
  const [thumbProgress, setThumbProgress]       = useState(0);
  const [xhrRef] = useState<{ current: XMLHttpRequest | null }>({ current: null });

  // Storage metadata returned from upload endpoints — forwarded to POST /creator/videos
  const [uploadMeta, setUploadMeta] = useState<{
    videoStorageFolder?: string;
    thumbnailPath?: string;
    bucketName?: string;
  }>({});

  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      title: "", description: "", categoryId: "", visibility: "public",
      bundleId: "", price: 0, downloadable: false,
      videoSourceType: "upload", videoUrl: "", videoFilePath: "", thumbnail: "", tags: "",
    },
  });

  const visibility      = form.watch("visibility");
  const videoSourceType = form.watch("videoSourceType");
  const videoUrl        = form.watch("videoUrl");
  const thumbnail       = form.watch("thumbnail");

  // ── File upload ──────────────────────────────────────────────────────────────
  const handleFileUpload = async (file: File, type: "video" | "image") => {
    const isVid      = type === "video";
    const setUpl     = isVid ? setIsUploadingVideo : setIsUploadingThumb;
    const setProgress = isVid ? setUploadProgress : setThumbProgress;
    const endpoint   = isVid ? "/api/upload/video" : "/api/upload/thumbnail";
    const urlField   = isVid ? "videoUrl" : "thumbnail";
    const formKey    = isVid ? "video" : "thumbnail";

    setUpl(true);
    setProgress(0);
    const fd = new FormData();
    fd.append(formKey, file);

    // Auto-determine uploaderType so backend routes to PUBLIC Supabase.
    // Verified Creator: flag OR role === 'verified_creator'
    // Creator:          flag OR role === 'creator' / 'verified_creator'
    const isVerifiedCreator = !!u?.verifiedCreator || u?.role === "verified_creator";
    const isCreator         = !!u?.creatorBadge    || u?.role === "creator" || u?.role === "verified_creator";
    const uploaderType = isVerifiedCreator ? "Verified Creator" : isCreator ? "Creator" : null;
    if (uploaderType) fd.append("uploaderType", uploaderType);

    try {
      const data = await new Promise<{
        url: string; path?: string; storageFolder?: string; bucketName?: string;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        if (isVid) xhrRef.current = xhr;
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          let parsed: any = null;
          try { parsed = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && parsed?.success !== false) {
            resolve(parsed);
          } else {
            // Prefer the server's detailed error; fall back to generic message
            const serverMsg = parsed?.message ?? "Upload gagal";
            const serverDetail = parsed?.detail ? ` — ${parsed.detail}` : "";
            reject(new Error(`${serverMsg}${serverDetail}`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Tidak dapat terhubung ke server. Periksa koneksi internet.")));
        xhr.open("POST", endpoint);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(fd);
      });

      form.setValue(urlField as keyof UploadForm, data.url, { shouldValidate: true });
      if (isVid && data.path) form.setValue("videoFilePath", data.path);

      // Capture storage metadata to forward when creating the video record
      if (isVid) {
        setUploadMeta(prev => ({
          ...prev,
          videoStorageFolder: data.storageFolder,
          bucketName: data.bucketName ?? undefined,
        }));
      } else {
        setUploadMeta(prev => ({
          ...prev,
          thumbnailPath: data.path,
          bucketName: data.bucketName ?? prev.bucketName,
        }));
      }

      toast({ title: `${isVid ? "Video" : "Thumbnail"} berhasil diupload! ✅` });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUpl(false);
      setProgress(0);
      if (isVid) xhrRef.current = null;
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

  // ── Submit ───────────────────────────────────────────────────────────────────
  const onSubmit = async (values: UploadForm) => {
    if (values.visibility === "public") values.price = 0;
    setIsSubmitting(true);
    try {
      const created: any = await adminFetch("/creator/videos", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          categoryId:    values.categoryId || null,
          videoFilePath: values.videoFilePath || null,
          thumbnail:     values.thumbnail || null,
          // Forward storage metadata captured from upload endpoints
          storageFolder: uploadMeta.videoStorageFolder || null,
          thumbnailPath: uploadMeta.thumbnailPath      || null,
          bucketName:    uploadMeta.bucketName         || null,
        }),
      });

      // If bundle video, link to the chosen bundle
      if (values.visibility === "hidden_bundle" && values.bundleId && created?.id) {
        try {
          const existingBundle: any = await adminFetch(`/bundles/${values.bundleId}`);
          const currentIds: string[] = (existingBundle?.videos ?? []).map((v: any) => v.id);
          if (!currentIds.includes(created.id)) {
            await adminFetch(`/bundles/${values.bundleId}`, {
              method: "PATCH",
              body: JSON.stringify({ videoIds: [...currentIds, created.id] }),
            });
          }
        } catch (bundleErr: any) {
          toast({
            title: "Video dibuat, tapi gagal ditambahkan ke bundle",
            description: bundleErr.message ?? "Tambahkan manual dari menu Bundle.",
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }
      }

      toast({ title: "🎉 Video berhasil dipublikasi!" });
      setLocation("/my-video");
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

  // Creator access = creatorBadge flag OR role is 'creator' / 'verified_creator'
  const hasCreatorAccess =
    !!u?.creatorBadge ||
    u?.role === "creator" ||
    u?.role === "verified_creator";

  // Admin/Owner without any creator access must use their admin upload page.
  const isAdminOrOwner = u?.role === "admin" || u?.role === "owner";
  if (isAdminOrOwner && !hasCreatorAccess) {
    const adminPath = u?.role === "owner" ? "/owner" : "/admin";
    setLocation(adminPath);
    return null;
  }
  if (!hasCreatorAccess) {
    return <NotAuthorized />;
  }

  return (
    <AppLayout>
      <div className="px-4 py-6 max-w-2xl mx-auto">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-3 shadow-sm">
            <Sparkles className="h-3 w-3" />
            Creator Studio
          </div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-800">Upload Video</h1>
          <p className="text-slate-500 text-sm mt-1">Publish konten baru ke platform</p>
        </motion.div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

            {/* ── Content Type ── */}
            <SectionCard icon={<Package className="h-4 w-4" />} title="Tipe Konten" gradient="bg-gradient-to-r from-purple-500 to-pink-500">
              <FormField control={form.control} name="visibility" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="grid grid-cols-3 gap-3">
                      {CONTENT_TYPE_OPTIONS.map((opt) => {
                        const isSelected = field.value === opt.value;
                        return (
                          <button
                            key={opt.value} type="button"
                            onClick={() => { field.onChange(opt.value); if (opt.value !== "hidden_bundle") form.setValue("bundleId", ""); }}
                            className={`flex flex-col items-center text-center gap-1.5 py-4 px-2 rounded-xl border-2 transition-all font-medium text-sm
                              ${isSelected ? opt.color + " shadow-sm scale-[1.02]" : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"}`}
                          >
                            <span className="text-2xl">{opt.icon}</span>
                            <span className="font-extrabold text-[12px] leading-tight">{opt.label}</span>
                            <span className="text-[10px] leading-tight opacity-70">{opt.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Bundle selector */}
              {visibility === "hidden_bundle" && (
                <FormField control={form.control} name="bundleId" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold">Bundle Tujuan <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger className="border-purple-200 focus:border-purple-400">
                          <SelectValue placeholder="Pilih bundle tujuan" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bundles.length === 0
                          ? <div className="py-3 px-4 text-sm text-slate-400 text-center">Belum ada bundle.</div>
                          : bundles.map((b: any) => (
                            <SelectItem key={b.id} value={String(b.id)}>
                              <div className="flex items-center gap-2">
                                <Package className="h-3.5 w-3.5 text-purple-500" />
                                <span>{b.title}</span>
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {/* Price */}
              {(visibility === "premium" || visibility === "hidden_bundle") && (
                <FormField control={form.control} name="price" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-semibold">Harga (Rp)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" className="border-amber-200 focus:border-amber-400" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </SectionCard>

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
                          onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], "video")}
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

            {/* ── Thumbnail ── */}
            <SectionCard icon={<ImageIcon className="h-4 w-4" />} title="Thumbnail" gradient="bg-gradient-to-r from-violet-500 to-purple-600">
              <FormField control={form.control} name="thumbnail" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Gambar Thumbnail</FormLabel>
                  <FormControl>
                    <div>
                      <input
                        type="file" accept="image/jpeg,image/png,image/webp"
                        className="hidden" ref={thumbInputRef}
                        onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], "image")}
                      />
                      {field.value ? (
                        <div className="relative rounded-xl overflow-hidden border-2 border-violet-200 group w-full h-44">
                          <img src={field.value} alt="Thumbnail" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Button type="button" variant="secondary" size="sm" onClick={() => thumbInputRef.current?.click()}>Ganti Gambar</Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => !isUploadingThumb && thumbInputRef.current?.click()}
                          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer h-44 transition-colors
                            ${isUploadingThumb ? "border-violet-300 bg-violet-50 pointer-events-none" : "border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50"}`}
                        >
                          {isUploadingThumb ? (
                            <div className="text-center space-y-2">
                              <Loader2 className="h-8 w-8 animate-spin text-violet-500 mx-auto" />
                              <p className="text-sm font-semibold text-violet-700">Mengupload… {thumbProgress}%</p>
                            </div>
                          ) : (
                            <>
                              <ImageIcon className="h-9 w-9 text-violet-400 mb-2" />
                              <p className="text-sm font-semibold text-slate-700">Pilih Thumbnail</p>
                              <p className="text-xs text-slate-400 mt-1">JPG, PNG, WebP • Opsional</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
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

              <FormField control={form.control} name="categoryId" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Kategori</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || undefined}>
                    <FormControl>
                      <SelectTrigger className="border-emerald-200 focus:border-emerald-400">
                        <SelectValue placeholder="Pilih kategori" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((cat: any) => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              <FormField control={form.control} name="tags" render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">Tags</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="anak, belajar, lucu (pisahkan dengan koma)" className="border-emerald-200 focus:border-emerald-400" />
                  </FormControl>
                  <FormDescription className="text-xs">Pisahkan dengan koma</FormDescription>
                </FormItem>
              )} />

              <FormField control={form.control} name="downloadable" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-xl border border-slate-100 p-3 bg-slate-50">
                  <div>
                    <FormLabel className="font-semibold">Izinkan Download</FormLabel>
                    <FormDescription className="text-xs">Penonton bisa mengunduh video ini</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />
            </SectionCard>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isSubmitting || isUploadingVideo || isUploadingThumb}
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
