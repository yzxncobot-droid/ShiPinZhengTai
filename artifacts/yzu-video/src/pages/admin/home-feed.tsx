import { useState, useRef, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, Pencil, Trash2, UploadCloud, Video as VideoIcon,
  Image as ImageIcon, CheckCircle2, Star, X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ────────────────────────────────────────────────────────────────────
interface AdminHomeFeedVideo {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
  thumbnail: string | null;
  status: string;
  isActive: boolean;
  sortOrder: number;
  rewardType: "LIKE" | "COMMENT" | "NONE";
  rewardTarget: number;
  rewardCode: string | null;
  likeCount: number;
  commentCount: number;
  rewardProgress: number;
  rewardUnlocked: boolean;
  createdAt: string;
}

interface FormState {
  title: string;
  description: string;
  videoUrl: string;
  thumbnail: string;
  status: string;
  isActive: boolean;
  sortOrder: number;
  rewardType: "LIKE" | "COMMENT" | "NONE";
  rewardTarget: number;
  rewardCode: string;
}

const EMPTY: FormState = {
  title: "", description: "", videoUrl: "", thumbnail: "",
  status: "published", isActive: true, sortOrder: 0,
  rewardType: "NONE", rewardTarget: 0, rewardCode: "",
};

export default function AdminHomeFeedPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminHomeFeedVideo | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const { data: videos = [], isLoading } = useQuery<AdminHomeFeedVideo[]>({
    queryKey: ["admin-home-feed"],
    queryFn: () => adminFetch("/admin/home-feed"),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-home-feed"] });
    queryClient.invalidateQueries({ queryKey: ["home-feed"] });
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (v: AdminHomeFeedVideo) => {
    setEditing(v);
    setForm({
      title: v.title, description: v.description ?? "", videoUrl: v.videoUrl,
      thumbnail: v.thumbnail ?? "", status: v.status, isActive: v.isActive,
      sortOrder: v.sortOrder, rewardType: v.rewardType, rewardTarget: v.rewardTarget,
      rewardCode: v.rewardCode ?? "",
    });
    setOpen(true);
  };

  const set = (k: keyof FormState, val: any) => setForm((f) => ({ ...f, [k]: val }));

  // ── File upload (multipart → home-feed endpoints) ────────────────────────────
  const uploadFile = useCallback(async (file: File, kind: "video" | "thumbnail") => {
    const isVideo = kind === "video";
    const endpoint = isVideo ? "/api/upload/home-feed-video" : "/api/upload/home-feed-thumbnail";
    const field = isVideo ? "video" : "thumbnail";
    const setUp = isVideo ? setUploadingVideo : setUploadingThumb;
    setUp(true); setProgress(0);
    const fd = new FormData();
    fd.append(field, file);
    try {
      const data = await new Promise<{ url: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          let parsed: any = null;
          try { parsed = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && parsed?.success !== false) resolve(parsed);
          else reject(new Error(parsed?.message ?? "Upload gagal"));
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("POST", endpoint);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(fd);
      });
      if (isVideo) set("videoUrl", data.url); else set("thumbnail", data.url);
      toast({ title: `${isVideo ? "Video" : "Thumbnail"} berhasil diupload` });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUp(false); setProgress(0);
    }
  }, [token, toast]);

  // ── Save (create / update) ───────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Judul wajib diisi", variant: "destructive" }); return; }
    if (!form.videoUrl.trim()) { toast({ title: "Video wajib diupload", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { ...form, sortOrder: Number(form.sortOrder) || 0, rewardTarget: Number(form.rewardTarget) || 0 };
      if (editing) {
        await adminFetch(`/admin/home-feed/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: "Video diperbarui" });
      } else {
        await adminFetch("/admin/home-feed", { method: "POST", body: JSON.stringify(body) });
        toast({ title: "Video ditambahkan" });
      }
      setOpen(false); refresh();
    } catch (err: any) {
      toast({ title: "Gagal menyimpan", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (v: AdminHomeFeedVideo) => {
    if (!confirm(`Hapus video "${v.title}"?`)) return;
    try {
      await adminFetch(`/admin/home-feed/${v.id}`, { method: "DELETE" });
      toast({ title: "Video dihapus" }); refresh();
    } catch (err: any) {
      toast({ title: "Gagal menghapus", description: err.message, variant: "destructive" });
    }
  };

  const toggleActive = async (v: AdminHomeFeedVideo) => {
    try {
      await adminFetch(`/admin/home-feed/${v.id}`, {
        method: "PATCH", body: JSON.stringify({ isActive: !v.isActive }),
      });
      refresh();
    } catch (err: any) {
      toast({ title: "Gagal mengubah status", description: err.message, variant: "destructive" });
    }
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-heading font-bold text-gray-800">Home Feed Videos</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Video feed TikTok-style di Home. Disimpan di Media Supabase, terpisah dari produk Shop.
              </p>
            </div>
            <Button onClick={openCreate} className="bg-gradient-to-r from-purple-500 to-violet-600 text-white font-bold">
              <Plus className="h-4 w-4 mr-1" /> Tambah Video
            </Button>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-purple-500" /></div>
          ) : videos.length === 0 ? (
            <div className="text-center py-16">
              <VideoIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Belum ada video Home Feed.</p>
              <p className="text-sm text-gray-400 mt-1">Klik "Tambah Video" untuk membuat video pertama.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {videos.map((v) => (
                <div key={v.id} className="flex items-center gap-4 rounded-2xl bg-white border border-slate-100 p-3 shadow-sm">
                  {/* Thumbnail */}
                  <div className="h-16 w-28 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                    {v.thumbnail ? (
                      <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center"><VideoIcon className="h-6 w-6 text-slate-300" /></div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-800 truncate">{v.title}</p>
                      {!v.isActive && <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">NONAKTIF</span>}
                      {v.status === "draft" && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">DRAFT</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span>❤️ {v.likeCount}</span>
                      <span>💬 {v.commentCount}</span>
                      <span>Urutan: {v.sortOrder}</span>
                      {v.rewardType !== "NONE" && (
                        <span className="inline-flex items-center gap-1 text-purple-600 font-bold">
                          <Star className="h-3 w-3" fill="currentColor" /> {v.rewardType} {v.rewardProgress}%
                          {v.rewardUnlocked && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch checked={v.isActive} onCheckedChange={() => toggleActive(v)} />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(v)} className="h-8 w-8">
                      <Pencil className="h-4 w-4 text-slate-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(v)} className="h-8 w-8">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Create / Edit Modal ── */}
        {open && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-extrabold text-slate-800">
                  {editing ? "Edit Video" : "Tambah Video Home Feed"}
                </h2>
                <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Video upload */}
                <div>
                  <label className="text-sm font-bold text-slate-700">Video <span className="text-red-500">*</span></label>
                  <input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="hidden" ref={videoRef}
                    onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "video")} />
                  {form.videoUrl ? (
                    <div className="mt-1.5 rounded-xl border-2 border-purple-200 bg-purple-50 p-3 flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-purple-500" />
                      <span className="text-sm text-purple-700 font-medium flex-1 truncate">Video terunggah</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => videoRef.current?.click()}>Ganti</Button>
                    </div>
                  ) : uploadingVideo ? (
                    <div className="mt-1.5">
                      <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
                      <div className="w-full bg-purple-100 h-2 rounded-full mt-2 overflow-hidden">
                        <div className="bg-purple-500 h-full rounded-full" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => videoRef.current?.click()}
                      className="mt-1.5 w-full border-2 border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center text-slate-400 hover:border-purple-300 hover:bg-purple-50">
                      <UploadCloud className="h-8 w-8 mb-1" />
                      <span className="text-sm font-medium">Upload Video (MP4/WebM/MOV)</span>
                    </button>
                  )}
                </div>

                {/* Thumbnail upload */}
                <div>
                  <label className="text-sm font-bold text-slate-700">Thumbnail</label>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" ref={thumbRef}
                    onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "thumbnail")} />
                  {form.thumbnail ? (
                    <div className="mt-1.5 relative rounded-xl overflow-hidden h-32 border-2 border-violet-200">
                      <img src={form.thumbnail} alt="" className="h-full w-full object-cover" />
                      <button type="button" onClick={() => thumbRef.current?.click()}
                        className="absolute bottom-2 right-2 bg-white/90 rounded-full px-2 py-1 text-xs font-bold">Ganti</button>
                    </div>
                  ) : uploadingThumb ? (
                    <Loader2 className="h-5 w-5 animate-spin text-violet-500 mt-2" />
                  ) : (
                    <button type="button" onClick={() => thumbRef.current?.click()}
                      className="mt-1.5 w-full border-2 border-dashed border-slate-200 rounded-xl py-6 flex flex-col items-center text-slate-400 hover:border-violet-300 hover:bg-violet-50">
                      <ImageIcon className="h-7 w-7 mb-1" />
                      <span className="text-sm font-medium">Upload Thumbnail</span>
                    </button>
                  )}
                </div>

                {/* Title */}
                <div>
                  <label className="text-sm font-bold text-slate-700">Judul <span className="text-red-500">*</span></label>
                  <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Judul video" className="mt-1.5" />
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm font-bold text-slate-700">Deskripsi</label>
                  <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Deskripsi video" className="mt-1.5 resize-none" rows={2} />
                </div>

                {/* Sort order + status */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-bold text-slate-700">Urutan</label>
                    <Input type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-slate-700">Status</label>
                    <Select value={form.status} onValueChange={(v) => set("status", v)}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="published">Published</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Active toggle */}
                <div className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                  <span className="text-sm font-bold text-slate-700">Aktif (tampil di Home)</span>
                  <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
                </div>

                {/* Reward config */}
                <div className="rounded-xl border-2 border-purple-100 bg-purple-50/40 p-3 space-y-3">
                  <p className="text-sm font-extrabold text-purple-700 flex items-center gap-1.5">
                    <Star className="h-4 w-4" fill="currentColor" /> Konfigurasi Reward
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600">Jenis Reward</label>
                      <Select value={form.rewardType} onValueChange={(v) => set("rewardType", v)}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">Tidak ada</SelectItem>
                          <SelectItem value="LIKE">Like</SelectItem>
                          <SelectItem value="COMMENT">Komentar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600">Target</label>
                      <Input type="number" value={form.rewardTarget} onChange={(e) => set("rewardTarget", e.target.value)} className="mt-1" placeholder="cth: 100" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600">Kode Reward</label>
                    <Input value={form.rewardCode} onChange={(e) => set("rewardCode", e.target.value)} className="mt-1" placeholder="cth: ABC123" />
                    <p className="text-[11px] text-slate-400 mt-1">Kode hanya terungkap ke user setelah target tercapai (divalidasi backend).</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-5 pt-3 border-t border-slate-100">
                <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
                <Button onClick={handleSave} disabled={saving || uploadingVideo || uploadingThumb}
                  className="bg-gradient-to-r from-purple-500 to-violet-600 text-white font-bold">
                  {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Menyimpan...</> : "Simpan"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </AdminLayout>
    </ProtectedRoute>
  );
}
