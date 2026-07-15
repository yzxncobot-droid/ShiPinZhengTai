import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDate } from "@/lib/admin-api";
import { useState, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Trash2, Search, Gift, RefreshCw, Layers, Image as ImageIcon, Loader2 } from "lucide-react";

const BADGES = ["NONE", "BEST SELLER", "POPULAR", "NEW", "VALUE PACK"];

const EMPTY_FORM = {
  title: "", description: "", thumbnail: "", banner: "",
  price: 0, originalPrice: 0,
  badge: "NONE", isActive: true, sortOrder: 0, videoIds: [] as number[],
};

export default function AdminBundles() {
  const { toast } = useToast();
  const { token } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editBundle, setEditBundle] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [videoSearch, setVideoSearch] = useState("");
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const bannerRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const { data: bundles, isLoading, refetch } = useQuery({
    queryKey: ["admin-bundles"],
    queryFn: () => adminFetch("/bundles"),
  });

  const { data: videosData } = useQuery({
    queryKey: ["admin-bundles-video-picker", videoSearch],
    queryFn: () => adminFetch(`/videos?search=${videoSearch}&limit=50&includeHidden=true`),
    enabled: showForm || !!editBundle,
  });

  const createMut = useMutation({
    mutationFn: (data: any) => adminFetch("/bundles", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-bundles"] }); toast({ title: "Bundle dibuat" }); setShowForm(false); setForm(EMPTY_FORM); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => adminFetch(`/bundles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-bundles"] }); toast({ title: "Bundle diperbarui" }); setEditBundle(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/bundles/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-bundles"] }); toast({ title: "Bundle dihapus" }); setDeleteId(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const list: any[] = Array.isArray(bundles) ? bundles : [];
  const filtered = search ? list.filter((b) => b.title.toLowerCase().includes(search.toLowerCase())) : list;
  const availableVideos: any[] = Array.isArray(videosData?.data) ? videosData.data : Array.isArray(videosData) ? videosData : [];

  const openEdit = async (bundle: any) => {
    const detail = await adminFetch(`/bundles/${bundle.id}`);
    setEditBundle(detail);
    setForm({
      title: detail.title, description: detail.description ?? "",
      thumbnail: detail.thumbnail ?? "", banner: detail.banner ?? "",
      price: detail.price ?? 0, originalPrice: detail.originalPrice ?? 0,
      badge: detail.badge ?? "NONE", isActive: detail.isActive ?? true, sortOrder: detail.sortOrder ?? 0,
      videoIds: (detail.videos ?? []).map((v: any) => v.id),
    });
  };

  const toggleVideo = (id: number) => {
    setForm((p) => {
      const has = p.videoIds.includes(id);
      if (has) return { ...p, videoIds: p.videoIds.filter((v) => v !== id) };
      if (p.videoIds.length >= 10) {
        toast({ title: "Maksimal 10 video per bundle", variant: "destructive" });
        return p;
      }
      return { ...p, videoIds: [...p.videoIds, id] };
    });
  };

  const uploadImage = async (file: File, field: "thumbnail" | "banner") => {
    const setUploading = field === "banner" ? setIsUploadingBanner : setIsUploadingThumb;
    setUploading(true);
    const fd = new FormData();
    fd.append("image", file);
    try {
      const data = await new Promise<{ url: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener("load", () => {
          let parsed: any = null;
          try { parsed = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && parsed?.success !== false) resolve(parsed);
          else reject(new Error(parsed?.message ?? "Upload gagal"));
        });
        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("POST", "/api/upload/image");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(fd);
      });
      setForm((p) => ({ ...p, [field]: data.url }));
      toast({ title: `${field === "banner" ? "Banner" : "Thumbnail"} berhasil diupload` });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const buildPayload = () => ({
    title: form.title,
    description: form.description || null,
    thumbnail: form.thumbnail || null,
    banner: form.banner || null,
    price: Number(form.price),
    originalPrice: form.originalPrice ? Number(form.originalPrice) : null,
    badge: form.badge === "NONE" ? null : form.badge,
    isActive: form.isActive,
    sortOrder: Number(form.sortOrder) || 0,
    videoIds: form.videoIds,
  });

  const discountPercent = form.originalPrice && form.originalPrice > form.price
    ? Math.round((1 - form.price / form.originalPrice) * 100)
    : 0;

  const FormFields = () => (
    <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto pr-1">
      <div className="space-y-1.5">
        <Label>Judul Bundle *</Label>
        <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Contoh: Paket Dongeng Seru" />
      </div>
      <div className="space-y-1.5">
        <Label>Deskripsi</Label>
        <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Deskripsi bundle" rows={2} />
      </div>

      {/* Thumbnail + Banner uploads */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Thumbnail</Label>
          <input type="file" accept="image/*" className="hidden" ref={thumbRef}
            onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], "thumbnail")} />
          <div
            className="relative border rounded-lg overflow-hidden cursor-pointer group h-24"
            onClick={() => thumbRef.current?.click()}
          >
            {isUploadingThumb ? (
              <div className="h-full flex items-center justify-center bg-muted/20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : form.thumbnail ? (
              <>
                <img src={form.thumbnail} className="h-full w-full object-cover" alt="thumbnail" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ImageIcon className="h-6 w-6 text-white" />
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground">
                <ImageIcon className="h-5 w-5 mb-1" />
                <span className="text-xs">Upload thumbnail</span>
              </div>
            )}
          </div>
          <Input
            value={form.thumbnail} onChange={(e) => setForm((p) => ({ ...p, thumbnail: e.target.value }))}
            placeholder="Atau tempel URL" className="text-xs h-7" />
        </div>
        <div className="space-y-1.5">
          <Label>Banner (opsional)</Label>
          <input type="file" accept="image/*" className="hidden" ref={bannerRef}
            onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], "banner")} />
          <div
            className="relative border rounded-lg overflow-hidden cursor-pointer group h-24"
            onClick={() => bannerRef.current?.click()}
          >
            {isUploadingBanner ? (
              <div className="h-full flex items-center justify-center bg-muted/20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : form.banner ? (
              <>
                <img src={form.banner} className="h-full w-full object-cover" alt="banner" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ImageIcon className="h-6 w-6 text-white" />
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground">
                <ImageIcon className="h-5 w-5 mb-1" />
                <span className="text-xs">Upload banner</span>
              </div>
            )}
          </div>
          <Input
            value={form.banner} onChange={(e) => setForm((p) => ({ ...p, banner: e.target.value }))}
            placeholder="Atau tempel URL" className="text-xs h-7" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Harga Bundle *</Label>
          <Input type="number" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: parseInt(e.target.value) || 0 }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Harga Asli (opsional)</Label>
          <Input type="number" value={form.originalPrice} onChange={(e) => setForm((p) => ({ ...p, originalPrice: parseInt(e.target.value) || 0 }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Diskon</Label>
          <div className="h-9 flex items-center px-3 rounded-md border bg-muted/30 text-sm font-bold text-red-500">
            {discountPercent > 0 ? `-${discountPercent}%` : "—"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Badge</Label>
          <Select value={form.badge} onValueChange={(v) => setForm((p) => ({ ...p, badge: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BADGES.map((b) => <SelectItem key={b} value={b}>{b === "NONE" ? "Tanpa Badge" : b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Urutan Tampil</Label>
          <Input type="number" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="isActive" checked={form.isActive} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: !!v }))} />
        <Label htmlFor="isActive">Aktif (tampilkan di aplikasi)</Label>
      </div>

      <div className="space-y-1.5 pt-2 border-t">
        <div className="flex items-center justify-between pt-2">
          <Label>Pilih Video ({form.videoIds.length}/10)</Label>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-8 h-8" placeholder="Cari video..." value={videoSearch} onChange={(e) => setVideoSearch(e.target.value)} />
        </div>
        <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
          {availableVideos.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3 text-center">Tidak ada video ditemukan</p>
          ) : availableVideos.map((v: any) => (
            <label key={v.id} className="flex items-center gap-2.5 p-2 hover:bg-muted/30 cursor-pointer">
              <Checkbox checked={form.videoIds.includes(v.id)} onCheckedChange={() => toggleVideo(v.id)} />
              <div className="h-8 w-12 rounded bg-muted overflow-hidden shrink-0">
                {v.thumbnail && <img src={v.thumbnail} className="h-full w-full object-cover" alt="" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium truncate block">{v.title}</span>
                {v.visibility === "hidden_bundle" && (
                  <span className="text-[10px] text-violet-500 font-medium">sudah di bundle</span>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Manajemen Bundle</h1>
              <p className="text-sm text-muted-foreground">{filtered.length} bundle</p>
            </div>
            <Button className="gap-2" onClick={() => { setShowForm(true); setForm(EMPTY_FORM); setVideoSearch(""); }}>
              <Plus className="h-4 w-4" />Tambah Bundle
            </Button>
          </div>

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cari bundle..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </div>

          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium text-muted-foreground">Bundle</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Badge</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Harga</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Video</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Dibuat</th>
                  <th className="p-3 text-center font-medium text-muted-foreground">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array(4).fill(0).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="p-3"><Skeleton className="h-8 w-full" /></td></tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-16 text-center text-muted-foreground">
                    <Gift className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p>Belum ada bundle</p>
                  </td></tr>
                ) : filtered.map((b: any) => (
                  <tr key={b.id} className="hover:bg-muted/20">
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-14 rounded-md bg-muted overflow-hidden shrink-0">
                          {b.thumbnail && <img src={b.thumbnail} className="h-full w-full object-cover" alt="" />}
                        </div>
                        <span className="font-medium truncate max-w-[180px]">{b.title}</span>
                      </div>
                    </td>
                    <td className="p-3 hidden md:table-cell">{b.badge ? <Badge variant="secondary">{b.badge}</Badge> : "—"}</td>
                    <td className="p-3">
                      <div className="font-semibold">{fmtRp(b.price)}</div>
                      {b.originalPrice > b.price && <div className="text-xs text-muted-foreground line-through">{fmtRp(b.originalPrice)}</div>}
                    </td>
                    <td className="p-3 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Layers className="h-3.5 w-3.5" />{b.videoCount}</span>
                    </td>
                    <td className="p-3">
                      <Badge variant={b.isActive ? "default" : "secondary"}>{b.isActive ? "Aktif" : "Nonaktif"}</Badge>
                    </td>
                    <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">{fmtDate(b.createdAt)}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(b)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(b.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Dialog */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Tambah Bundle Baru</DialogTitle></DialogHeader>
            <FormFields />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button
                onClick={() => createMut.mutate(buildPayload())}
                disabled={createMut.isPending || !form.title || form.videoIds.length < 1}
              >
                {createMut.isPending ? "Membuat..." : "Buat Bundle"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editBundle} onOpenChange={() => setEditBundle(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Edit Bundle</DialogTitle></DialogHeader>
            <FormFields />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditBundle(null)}>Batal</Button>
              <Button
                onClick={() => updateMut.mutate({ id: editBundle.id, data: buildPayload() })}
                disabled={updateMut.isPending || !form.title || form.videoIds.length < 1}
              >
                {updateMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Bundle?</AlertDialogTitle>
              <AlertDialogDescription>
                Video di dalamnya akan dikembalikan ke status "premium" (tidak lagi tersembunyi). Bundle ini akan hilang dari aplikasi.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteId && deleteMut.mutate(deleteId)}>Hapus</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
