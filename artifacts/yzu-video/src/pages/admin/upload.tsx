import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useListCategories } from "@workspace/api-client-react";
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
  Link as LinkIcon, CheckCircle2, Globe, Sparkles, Package, Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";

// ─── Constants ────────────────────────────────────────────────────────────────

const UPLOADER_TYPE_OPTIONS = [
  {
    value: "Public",
    label: "Public",
    icon: "🌐",
    description: "API Public",
    color: "border-sky-400 bg-sky-50 text-sky-700",
  },
  {
    value: "Owner",
    label: "Owner",
    icon: "👑",
    description: "API Owner",
    color: "border-amber-400 bg-amber-50 text-amber-700",
  },
  {
    value: "Media",
    label: "Media",
    icon: "🖼️",
    description: "API Media",
    color: "border-violet-400 bg-violet-50 text-violet-700",
  },
] as const;

type UploaderTypeValue = "Public" | "Owner" | "Media";

/** Map UI uploader type to the value the backend upload endpoints expect. */
function toApiUploaderType(uiType: UploaderTypeValue | undefined): string | undefined {
  if (!uiType) return undefined;
  if (uiType === "Public") return "Creator";
  if (uiType === "Owner")  return "Owner";
  // "Media" uses the /upload/image endpoint directly — no uploaderType needed
  return undefined;
}

const CONTENT_TYPE_OPTIONS = [
  {
    value: "public",
    label: "Video Gratis",
    icon: "🌍",
    description: "Semua orang bisa menonton tanpa login",
    color: "border-green-400 bg-green-50 text-green-700",
    selectedColor: "border-green-400 bg-green-50",
  },
  {
    value: "premium",
    label: "Video Premium",
    icon: "⭐",
    description: "Butuh langganan atau pembelian",
    color: "border-amber-400 bg-amber-50 text-amber-700",
    selectedColor: "border-amber-400 bg-amber-50",
  },
  {
    value: "home_video",
    label: "Video Home",
    icon: "🏠",
    description: "Tampil di Home tanpa harga",
    color: "border-purple-400 bg-purple-50 text-purple-700",
    selectedColor: "border-purple-400 bg-purple-50",
  },
] as const;

type VideoSourceType = "upload" | "external_link";

// ─── URL Validator ────────────────────────────────────────────────────────────

function isValidVideoLink(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\.(mp4|webm|mov|avi|mkv|m3u8)(\?.*)?$/i.test(u.pathname)) return true;
    if (/youtube\.com|youtu\.be/.test(u.hostname)) return true;
    if (/vimeo\.com/.test(u.hostname)) return true;
    if (u.hostname === "drive.google.com") return true;
    return false;
  } catch {
    return false;
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const uploadSchema = z.object({
  title:           z.string().min(3, "Judul minimal 3 karakter"),
  description:     z.string().optional(),
  categoryId:      z.string().optional(),
  visibility:      z.enum(["public", "premium", "home_video"]).default("public"),
  bundleId:        z.string().optional(),
  price:           z.coerce.number().min(0).optional(),
  downloadable:    z.boolean().default(false),
  videoSourceType: z.enum(["upload", "external_link"]).default("upload"),
  videoUrl:        z.string().min(1, "Video wajib diisi"),
  videoFilePath:   z.string().optional(),
  thumbnail:       z.string().min(1, "Thumbnail wajib diupload"),
  uploaderType:    z.enum(["Public", "Owner", "Media"]).optional(),
}).superRefine((data, ctx) => {
  if (data.videoSourceType === "external_link" && data.videoUrl && !isValidVideoLink(data.videoUrl)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["videoUrl"],
      message: "Link tidak valid. Gunakan YouTube, Vimeo, Google Drive, atau link MP4/M3U8 langsung.",
    });
  }
  if (data.visibility !== "home_video" && !data.categoryId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["categoryId"],
      message: "Pilih kategori",
    });
  }
});

type UploadForm = z.infer<typeof uploadSchema>;

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  icon, title, gradient, children,
}: {
  icon: React.ReactNode;
  title: string;
  gradient: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden shadow-md border border-white/60">
      <div className={`${gradient} px-5 py-3 flex items-center gap-2`}>
        <span className="text-white">{icon}</span>
        <h2 className="text-white font-bold text-base tracking-wide">{title}</h2>
      </div>
      <div className="bg-white p-5 space-y-4">{children}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUploadVideo() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: categoriesRaw, isLoading: isLoadingCategories, refetch: refetchCategories } = useListCategories();
  const categories: any[] = Array.isArray(categoriesRaw)
    ? categoriesRaw
    : (categoriesRaw as any)?.data ?? [];

  const [isUploadingVideo, setIsUploadingVideo]   = useState(false);
  const [isUploadingThumb, setIsUploadingThumb]   = useState(false);
  const [isSubmitting, setIsSubmitting]           = useState(false);
  const [uploadProgress, setUploadProgress]       = useState(0);

  // Storage metadata returned from upload endpoints — stored and forwarded to POST /videos
  const [uploadMeta, setUploadMeta] = useState<{
    videoStorageFolder?: string;
    thumbnailPath?: string;
    thumbnailStorageFolder?: string;
    bucketName?: string;
    // Bunny Stream (Owner uploads)
    bunnyVideoId?: string | null;
    bunnyPlaybackUrl?: string | null;
    bunnyLibraryId?: string | null;
    videoStorageProvider?: string | null;
  }>({});

  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      title: "",
      description: "",
      categoryId: "",
      visibility: "public",
      bundleId: "",
      price: 0,
      downloadable: false,
      videoSourceType: "upload",
      videoUrl: "",
      videoFilePath: "",
      thumbnail: "",
      uploaderType: undefined,
    },
  });

  const visibility      = form.watch("visibility");
  const videoSourceType = form.watch("videoSourceType");
  const videoUrl        = form.watch("videoUrl");
  const thumbnail       = form.watch("thumbnail");

  // ── File upload ──────────────────────────────────────────────────────────────
  const handleFileUpload = async (file: File, type: "video" | "image") => {
    const isVideo        = type === "video";
    const setUploading   = isVideo ? setIsUploadingVideo : setIsUploadingThumb;
    const endpoint       = isVideo ? "/api/upload/video" : "/api/upload/thumbnail";
    const urlField       = isVideo ? "videoUrl" : "thumbnail";
    const pathField      = isVideo ? "videoFilePath" : undefined;
    const formKey        = isVideo ? "video" : "thumbnail";

    setUploading(true);
    setUploadProgress(0);

    const currentUploaderType = form.getValues("uploaderType") as UploaderTypeValue | undefined;

    // For "Media" type: thumbnails go to /api/upload/image (MEDIA Supabase);
    //                   videos still go to /api/upload/video (legacy path).
    // For "Public" type: send uploaderType "Creator" → PUBLIC Supabase.
    // For "Owner" type:  send uploaderType "Owner"   → OWNER Supabase.
    let resolvedEndpoint = endpoint;
    const currentVisibility = form.getValues("visibility");
    if (currentVisibility === "home_video") {
      resolvedEndpoint = isVideo ? "/api/upload/home-feed-video" : "/api/upload/home-feed-thumbnail";
    } else if (!isVideo && currentUploaderType === "Media") {
      resolvedEndpoint = "/api/upload/image";
    }

    const fd = new FormData();
    if (!isVideo && currentUploaderType === "Media") {
      // /upload/image expects field "image"
      fd.append("image", file);
    } else {
      fd.append(formKey, file);
    }

    // Pass translated uploaderType so backend routes to the correct storage folder
    // (home feed uploads use dedicated endpoints — no uploaderType needed)
    if (currentVisibility !== "home_video") {
      const apiUploaderType = toApiUploaderType(currentUploaderType);
      if (apiUploaderType) fd.append("uploaderType", apiUploaderType);
    }

    try {
      const data = await new Promise<{
        url: string; path?: string; storageFolder?: string; bucketName?: string;
        bunnyVideoId?: string | null; bunnyPlaybackUrl?: string | null;
        bunnyLibraryId?: string | null; storageProvider?: string | null;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          let parsed: any = null;
          try { parsed = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && parsed?.success !== false) {
            resolve(parsed);
          } else {
            reject(new Error(parsed?.message ?? "Upload gagal"));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("POST", resolvedEndpoint);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(fd);
      });

      form.setValue(urlField as keyof UploadForm, data.url, { shouldValidate: true });
      if (pathField && data.path) {
        form.setValue(pathField as keyof UploadForm, data.path, { shouldValidate: false });
      }

      // Capture storage metadata for forwarding to video creation
      if (isVideo) {
        setUploadMeta(prev => ({
          ...prev,
          videoStorageFolder:   data.storageFolder,
          bucketName:           data.bucketName ?? undefined,
          videoStorageProvider: data.storageProvider ?? null,
          bunnyVideoId:         data.bunnyVideoId    ?? null,
          bunnyPlaybackUrl:     data.bunnyPlaybackUrl ?? null,
          bunnyLibraryId:       data.bunnyLibraryId  ?? null,
        }));
      } else {
        setUploadMeta(prev => ({
          ...prev,
          thumbnailPath:        data.path,
          thumbnailStorageFolder: data.storageFolder,
          bucketName:           data.bucketName ?? undefined,
        }));
      }

      toast({ title: `${isVideo ? "Video" : "Thumbnail"} berhasil diupload!` });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // ── Switch source type ───────────────────────────────────────────────────────
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
      // Home feed video — different API, no price/bundle/category
      if (values.visibility === "home_video") {
        await adminFetch("/admin/home-feed", {
          method: "POST",
          body: JSON.stringify({
            title: values.title,
            description: values.description || null,
            videoUrl: values.videoUrl,
            thumbnail: values.thumbnail || null,
            status: "published",
            isActive: true,
          }),
        });
        toast({ title: "🎉 Video Home berhasil dipublikasi!" });
        setLocation("/admin/home-feed");
        return;
      }
      // 1. Create the video
      const created: any = await adminFetch("/videos", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          categoryId:      values.categoryId || null,
          videoSourceType: values.videoSourceType,
          videoFilePath:   values.videoFilePath || null,
          thumbnail:       values.thumbnail || null,
          // Multi-storage metadata — translate UI value to API value before sending
          uploaderType:         toApiUploaderType(values.uploaderType as UploaderTypeValue | undefined) || null,
          thumbnailPath:        uploadMeta.thumbnailPath       || null,
          storageFolder:        uploadMeta.videoStorageFolder  || null,
          bucketName:           uploadMeta.bucketName          || null,
          // Bunny Stream metadata (Owner uploads)
          videoStorageProvider: uploadMeta.videoStorageProvider ?? null,
          bunnyVideoId:         uploadMeta.bunnyVideoId         ?? null,
          bunnyPlaybackUrl:     uploadMeta.bunnyPlaybackUrl     ?? null,
          bunnyLibraryId:       uploadMeta.bunnyLibraryId       ?? null,
        }),
      });

      toast({ title: "🎉 Video berhasil dipublikasi!" });
      setLocation("/admin/videos");
    } catch (err: any) {
      toast({ title: "Gagal mempublikasi", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-4 md:p-8 max-w-3xl mx-auto">

          {/* ── Page Header ── */}
          <div className="mb-7">
            <div className="inline-flex items-center gap-2 bg-gradient-to-r from-sky-400 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-3 shadow-sm">
              <Sparkles className="h-3 w-3" />
              Admin Panel
            </div>
            <h1 className="text-3xl font-heading font-bold text-gray-800">Upload Video Baru</h1>
            <p className="text-muted-foreground mt-1 text-sm">Publish konten baru ke platform</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

              {/* ══════════════════════════════════════════════
                  0. UPLOADER TYPE
              ══════════════════════════════════════════════ */}
              <SectionCard
                icon={<Users className="h-4 w-4" />}
                title="Tipe Uploader"
                gradient="bg-gradient-to-r from-teal-500 to-cyan-600"
              >
                <FormField control={form.control} name="uploaderType" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700 font-semibold sr-only">Tipe Uploader</FormLabel>
                    <FormDescription className="text-xs text-gray-500 mb-2">
                      Pilih tipe uploader agar file tersimpan di folder Supabase yang tepat.
                    </FormDescription>
                    <FormControl>
                      <div className="grid grid-cols-3 gap-3">
                        {UPLOADER_TYPE_OPTIONS.map((opt) => {
                          const isSelected = field.value === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => field.onChange(isSelected ? undefined : opt.value)}
                              className={`flex flex-col items-center text-center gap-1.5 py-4 px-2 rounded-xl border-2 transition-all font-medium text-sm
                                ${isSelected
                                  ? opt.color + " shadow-sm scale-[1.02]"
                                  : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300"
                                }`}
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
                    {field.value && (
                      <p className="text-xs text-teal-600 font-medium mt-1">
                        {field.value === "Public"  && <span>🌐 Video → <code className="bg-sky-50 px-1 rounded">API Public · PUBLIC Supabase</code></span>}
                        {field.value === "Owner"   && <span>👑 Video → <code className="bg-amber-50 px-1 rounded">API Owner · OWNER Supabase</code></span>}
                        {field.value === "Media"   && <span>🖼️ Thumbnail → <code className="bg-violet-50 px-1 rounded">MEDIA Supabase</code> · Video → storage default</span>}
                      </p>
                    )}
                  </FormItem>
                )} />
              </SectionCard>

              {/* ══════════════════════════════════════════════
                  1. CONTENT TYPE
              ══════════════════════════════════════════════ */}
              <SectionCard
                icon={<Package className="h-4 w-4" />}
                title="Tipe Konten"
                gradient="bg-gradient-to-r from-purple-500 to-pink-500"
              >
                <FormField control={form.control} name="visibility" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700 font-semibold sr-only">Tipe Konten</FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-3 gap-3">
                        {CONTENT_TYPE_OPTIONS.map((opt) => {
                          const isSelected = field.value === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                field.onChange(opt.value);
                                // Clear category when switching to home_video
                                if (opt.value === "home_video") form.setValue("categoryId", "");
                              }}
                              className={`flex flex-col items-center text-center gap-1.5 py-4 px-2 rounded-xl border-2 transition-all font-medium text-sm
                                ${isSelected ? opt.color + " shadow-sm scale-[1.02]" : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300"}`}
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

                {/* Price (premium only) */}
                {visibility === "premium" && (
                  <FormField control={form.control} name="price" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700 font-semibold">Harga Pembelian Satuan (Rp)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Isi 0 jika hanya via bundle/langganan"
                          className="bg-amber-50/20 border-amber-200 focus:border-amber-400"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Pengguna bisa membeli video ini tanpa langganan.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </SectionCard>

              {/* ══════════════════════════════════════════════
                  2. VIDEO SOURCE
              ══════════════════════════════════════════════ */}
              <SectionCard
                icon={<VideoIcon className="h-4 w-4" />}
                title="Sumber Video"
                gradient="bg-gradient-to-r from-sky-400 to-blue-500"
              >
                {/* Source toggle */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => switchSource("upload")}
                    className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all font-medium text-sm
                      ${videoSourceType === "upload"
                        ? "border-sky-400 bg-sky-50 text-sky-700 shadow-sm"
                        : "border-gray-200 bg-gray-50 text-gray-500 hover:border-sky-200"
                      }`}
                  >
                    <UploadCloud className={`h-6 w-6 ${videoSourceType === "upload" ? "text-sky-500" : "text-gray-400"}`} />
                    <span>Upload File</span>
                    {videoSourceType === "upload" && (
                      <span className="text-xs text-sky-400">✓ Dipilih</span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => switchSource("external_link")}
                    className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 transition-all font-medium text-sm
                      ${videoSourceType === "external_link"
                        ? "border-orange-400 bg-orange-50 text-orange-700 shadow-sm"
                        : "border-gray-200 bg-gray-50 text-gray-500 hover:border-orange-200"
                      }`}
                  >
                    <LinkIcon className={`h-6 w-6 ${videoSourceType === "external_link" ? "text-orange-500" : "text-gray-400"}`} />
                    <span>Link Video</span>
                    {videoSourceType === "external_link" && (
                      <span className="text-xs text-orange-400">✓ Dipilih</span>
                    )}
                  </button>
                </div>

                {/* ── Upload File ── */}
                {videoSourceType === "upload" && (
                  <FormField control={form.control} name="videoUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700 font-semibold">File Video <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <div>
                          <input
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                            className="hidden"
                            ref={videoInputRef}
                            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], "video")}
                          />
                          {field.value ? (
                            <div className="border-2 border-sky-200 bg-sky-50 rounded-xl p-4 flex flex-col items-center text-center gap-2">
                              <CheckCircle2 className="h-8 w-8 text-sky-500" />
                              <p className="text-sm font-semibold text-sky-700">Video siap dipublikasi</p>
                              <Button
                                type="button" variant="outline" size="sm"
                                onClick={() => videoInputRef.current?.click()}
                                className="border-sky-300 text-sky-600 hover:bg-sky-50"
                              >
                                Ganti Video
                              </Button>
                            </div>
                          ) : (
                            <div
                              onClick={() => !isUploadingVideo && videoInputRef.current?.click()}
                              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors h-44
                                ${isUploadingVideo
                                  ? "border-sky-300 bg-sky-50 pointer-events-none"
                                  : "border-gray-200 bg-gray-50 hover:border-sky-300 hover:bg-sky-50"
                                }`}
                            >
                              {isUploadingVideo ? (
                                <div className="w-full max-w-xs text-center space-y-2">
                                  <Loader2 className="h-7 w-7 animate-spin text-sky-500 mx-auto" />
                                  <p className="text-sm font-semibold text-sky-700">Mengupload… {uploadProgress}%</p>
                                  <div className="w-full bg-sky-100 h-2.5 rounded-full overflow-hidden">
                                    <div
                                      className="bg-gradient-to-r from-sky-400 to-blue-500 h-full rounded-full transition-all duration-300"
                                      style={{ width: `${uploadProgress}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <UploadCloud className="h-9 w-9 text-sky-400 mb-2" />
                                  <p className="text-sm font-semibold text-gray-700">Pilih atau drag file video</p>
                                  <p className="text-xs text-gray-400 mt-1">MP4, MOV, AVI, MKV, WebM • maks 500 MB</p>
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

                {/* ── Video Link ── */}
                {videoSourceType === "external_link" && (
                  <FormField control={form.control} name="videoUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-700 font-semibold">URL Video <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
                          <Input
                            {...field}
                            placeholder="https://youtube.com/watch?v=... atau link MP4 langsung"
                            className="pl-9 border-orange-200 focus:border-orange-400 bg-orange-50/30"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {["YouTube", "Vimeo", "Google Drive", "MP4/WebM", "M3U8/HLS"].map((lbl) => (
                          <span
                            key={lbl}
                            className="text-xs bg-orange-100 text-orange-600 font-medium px-2 py-0.5 rounded-full"
                          >
                            {lbl}
                          </span>
                        ))}
                      </div>
                    </FormItem>
                  )} />
                )}
              </SectionCard>

              {/* ══════════════════════════════════════════════
                  3. THUMBNAIL
              ══════════════════════════════════════════════ */}
              <SectionCard
                icon={<ImageIcon className="h-4 w-4" />}
                title="Thumbnail"
                gradient="bg-gradient-to-r from-violet-500 to-purple-600"
              >
                <FormField control={form.control} name="thumbnail" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700 font-semibold">
                      Gambar Thumbnail <span className="text-red-500">*</span>
                    </FormLabel>
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
                              <Button
                                type="button" variant="secondary" size="sm"
                                onClick={() => thumbInputRef.current?.click()}
                              >
                                Ganti Gambar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => !isUploadingThumb && thumbInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors h-44
                              ${isUploadingThumb
                                ? "border-violet-300 bg-violet-50 pointer-events-none"
                                : "border-gray-200 bg-gray-50 hover:border-violet-300 hover:bg-violet-50"
                              }`}
                          >
                            {isUploadingThumb ? (
                              <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                            ) : (
                              <>
                                <ImageIcon className="h-9 w-9 text-violet-400 mb-2" />
                                <p className="text-sm font-semibold text-gray-700">Pilih Thumbnail</p>
                                <p className="text-xs text-gray-400 mt-1">JPG, PNG, WebP • Rasio 16:9 disarankan</p>
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

              {/* ══════════════════════════════════════════════
                  4. DETAIL VIDEO
              ══════════════════════════════════════════════ */}
              <SectionCard
                icon={<Sparkles className="h-4 w-4" />}
                title="Detail Video"
                gradient="bg-gradient-to-r from-amber-400 to-orange-500"
              >
                {/* Title */}
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700 font-semibold">
                      Judul Video <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Judul yang menarik untuk video kamu"
                        className="bg-amber-50/30 border-amber-200 focus:border-amber-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Description */}
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700 font-semibold">Deskripsi</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ceritakan tentang video ini…"
                        className="resize-none h-28 bg-amber-50/20 border-amber-200 focus:border-amber-400"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Category (hidden for home_video) */}
                {visibility !== "home_video" && (
                <FormField control={form.control} name="categoryId" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-700 font-semibold">
                      Kategori <span className="text-red-500">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v)}
                      value={field.value || undefined}
                      disabled={isLoadingCategories}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-amber-50/30 border-amber-200 focus:border-amber-400">
                          {isLoadingCategories
                            ? <span className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Memuat…</span>
                            : <SelectValue placeholder="Pilih kategori" />
                          }
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.length === 0 ? (
                          <div className="py-3 px-4 text-sm text-muted-foreground text-center">
                            Belum ada kategori
                            <button
                              type="button"
                              onClick={() => refetchCategories()}
                              className="block mx-auto mt-1 text-xs text-primary underline"
                            >
                              Refresh
                            </button>
                          </div>
                        ) : (
                          categories.map((cat: any) => (
                            <SelectItem key={cat.id} value={cat.id}>
                              {cat.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                )}

                {/* Downloadable (hidden for home_video) */}
                {visibility !== "home_video" && (
                <FormField control={form.control} name="downloadable" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base text-gray-700 font-semibold">Izinkan Download</FormLabel>
                      <FormDescription>Apakah pengguna bisa mendownload video ini?</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
                )}
              </SectionCard>

              {/* ── Actions ── */}
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button" variant="ghost"
                  onClick={() => setLocation("/admin/videos")}
                  className="text-gray-500"
                >
                  Batal
                </Button>
                <Button
                  type="submit" size="lg"
                  disabled={isSubmitting || isUploadingVideo || isUploadingThumb}
                  className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold shadow-md px-8"
                >
                  {isSubmitting
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mempublikasi…</>
                    : "🚀 Publikasi Video"
                  }
                </Button>
              </div>

            </form>
          </Form>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
