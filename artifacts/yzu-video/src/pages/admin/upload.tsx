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
import { Loader2, UploadCloud, Video as VideoIcon, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";

const VISIBILITY_OPTIONS = [
  { value: "public",        label: "Gratis (Public)",                 description: "Semua orang bisa menonton" },
  { value: "premium",       label: "Premium",                         description: "Butuh langganan atau pembelian" },
  { value: "hidden_bundle", label: "Bundle Eksklusif (Hidden)",       description: "Hanya muncul di bundle, tidak di listing" },
] as const;

type Visibility = typeof VISIBILITY_OPTIONS[number]["value"];

const uploadSchema = z.object({
  title: z.string().min(5, "Judul minimal 5 karakter"),
  description: z.string().optional(),
  categoryId: z.coerce.number().optional(),
  visibility: z.enum(["public", "premium", "hidden_bundle"]).default("public"),
  price: z.coerce.number().min(0).optional(),
  downloadable: z.boolean().default(false),
  videoUrl: z.string().min(1, "Video wajib diupload"),
  thumbnail: z.string().optional(),
});

type UploadForm = z.infer<typeof uploadSchema>;

export default function AdminUploadVideo() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: categories } = useListCategories();

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      title: "", description: "",
      visibility: "public",
      price: 0,
      downloadable: false,
      videoUrl: "", thumbnail: "",
    },
  });

  const visibility = form.watch("visibility");

  const handleFileUpload = async (file: File, type: "video" | "image") => {
    const isVideo = type === "video";
    const setUploading = isVideo ? setIsUploadingVideo : setIsUploadingThumb;
    const endpoint = isVideo ? "/api/upload/video" : "/api/upload/thumbnail";
    const fieldName: keyof UploadForm = isVideo ? "videoUrl" : "thumbnail";
    const formKey = isVideo ? "video" : "thumbnail";

    setUploading(true);
    setUploadProgress(0);

    const fd = new FormData();
    fd.append(formKey, file);

    try {
      const data = await new Promise<{ url: string }>((resolve, reject) => {
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
        xhr.open("POST", endpoint);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(fd);
      });

      form.setValue(fieldName, data.url, { shouldValidate: true });
      toast({ title: `${type === "video" ? "Video" : "Thumbnail"} berhasil diupload.` });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const onSubmit = async (values: UploadForm) => {
    if (values.visibility === "public") values.price = 0;

    setIsSubmitting(true);
    try {
      await adminFetch("/videos", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          categoryId: values.categoryId || null,
          thumbnail: values.thumbnail || null,
        }),
      });
      toast({ title: "Video berhasil dipublikasi!" });
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
        <div className="p-6 md:p-8 max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-heading font-bold">Upload Video Baru</h1>
            <p className="text-muted-foreground mt-1">Publish konten ke channel kamu</p>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

                {/* File Uploads */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Video */}
                  <FormField control={form.control} name="videoUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>File Video *</FormLabel>
                      <FormControl>
                        <div className="mt-2">
                          <input
                            type="file" accept="video/mp4,video/x-m4v,video/*"
                            className="hidden" ref={videoInputRef}
                            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], "video")}
                          />
                          {field.value ? (
                            <div className="border border-border rounded-xl p-4 bg-muted/20 flex flex-col items-center text-center">
                              <VideoIcon className="h-8 w-8 text-primary mb-2" />
                              <p className="text-sm font-medium mb-2">Video siap dipublikasi</p>
                              <Button type="button" variant="outline" size="sm" onClick={() => videoInputRef.current?.click()}>
                                Ganti Video
                              </Button>
                            </div>
                          ) : (
                            <div
                              onClick={() => !isUploadingVideo && videoInputRef.current?.click()}
                              className={`border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-muted/10 h-40 ${isUploadingVideo ? "pointer-events-none" : ""}`}
                            >
                              {isUploadingVideo ? (
                                <div className="w-full max-w-[200px] text-center">
                                  <p className="text-sm font-medium mb-2">Mengupload… {uploadProgress}%</p>
                                  <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                    <div className="bg-primary h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <UploadCloud className="h-8 w-8 text-muted-foreground mb-3" />
                                  <p className="text-sm font-medium">Pilih File Video</p>
                                  <p className="text-xs text-muted-foreground mt-1">MP4, WebM</p>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Thumbnail */}
                  <FormField control={form.control} name="thumbnail" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Thumbnail</FormLabel>
                      <FormControl>
                        <div className="mt-2">
                          <input
                            type="file" accept="image/jpeg,image/png,image/webp"
                            className="hidden" ref={thumbInputRef}
                            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], "image")}
                          />
                          {field.value ? (
                            <div className="relative rounded-xl overflow-hidden border border-border group w-full h-40">
                              <img src={field.value} alt="Thumbnail" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Button type="button" variant="secondary" size="sm" onClick={() => thumbInputRef.current?.click()}>
                                  Ganti Gambar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div
                              onClick={() => !isUploadingThumb && thumbInputRef.current?.click()}
                              className={`border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-muted/10 h-40 ${isUploadingThumb ? "pointer-events-none" : ""}`}
                            >
                              {isUploadingThumb ? (
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                              ) : (
                                <>
                                  <ImageIcon className="h-8 w-8 text-muted-foreground mb-3" />
                                  <p className="text-sm font-medium">Pilih Thumbnail</p>
                                  <p className="text-xs text-muted-foreground mt-1">Rasio 16:9 disarankan</p>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem className="col-span-full">
                      <FormLabel>Judul Video *</FormLabel>
                      <FormControl>
                        <Input placeholder="Judul yang menarik untuk video kamu" className="bg-background" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem className="col-span-full">
                      <FormLabel>Deskripsi</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Ceritakan tentang video ini..." className="resize-none h-32 bg-background" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Category */}
                  <FormField control={form.control} name="categoryId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kategori</FormLabel>
                      <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger className="bg-background"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(Array.isArray(categories) ? categories : []).map((cat: any) => (
                            <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Visibility */}
                  <FormField control={form.control} name="visibility" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Visibilitas</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {VISIBILITY_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              <div>
                                <p className="font-medium">{o.label}</p>
                                <p className="text-xs text-muted-foreground">{o.description}</p>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Price (shown for premium + hidden_bundle) */}
                  {(visibility === "premium" || visibility === "hidden_bundle") && (
                    <FormField control={form.control} name="price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Harga Pembelian Satuan (Rp)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="Isi 0 jika hanya untuk pelanggan" className="bg-background" {...field} />
                        </FormControl>
                        <FormDescription>
                          {visibility === "hidden_bundle"
                            ? "Jika diisi, pengguna bisa membeli video ini langsung (selain via bundle)."
                            : "Pengguna bisa membeli video ini tanpa langganan."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  {/* Downloadable */}
                  <FormField control={form.control} name="downloadable" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-xl border p-4 bg-background">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Izinkan Download</FormLabel>
                        <FormDescription>Apakah pengguna bisa mendownload video ini?</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <div className="flex justify-end pt-4 border-t border-border/50">
                  <Button type="button" variant="ghost" className="mr-4" onClick={() => setLocation("/admin/videos")}>
                    Batal
                  </Button>
                  <Button type="submit" size="lg" disabled={isSubmitting || isUploadingVideo || isUploadingThumb}>
                    {isSubmitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Publikasi Video
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
