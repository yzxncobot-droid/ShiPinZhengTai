import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDate } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Search, Plus, Edit, Trash2, EyeOff, Globe,
  ChevronLeft, ChevronRight, Video, Star, RefreshCw, CheckSquare, Lock,
} from "lucide-react";

type VideoVisibility = "public" | "premium" | "hidden_bundle";

const STATUS_COLORS: Record<string, string> = {
  published: "bg-green-500/10 text-green-600 border-green-200",
  draft:     "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  hidden:    "bg-gray-500/10 text-gray-600 border-gray-200",
  scheduled: "bg-blue-500/10 text-blue-600 border-blue-200",
};

const STATUS_LABELS: Record<string, string> = {
  published: "Dipublikasi",
  draft:     "Draft",
  hidden:    "Disembunyikan",
  scheduled: "Terjadwal",
};

const VISIBILITY_BADGE: Record<VideoVisibility, { label: string; className: string }> = {
  public:        { label: "Gratis",        className: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
  premium:       { label: "Premium",       className: "bg-yellow-500/10 text-yellow-600 border-yellow-200" },
  hidden_bundle: { label: "Bundle",        className: "bg-violet-500/10 text-violet-600 border-violet-200" },
};

function VisibilityBadge({ visibility }: { visibility?: string }) {
  const v = (visibility ?? "public") as VideoVisibility;
  const cfg = VISIBILITY_BADGE[v] ?? VISIBILITY_BADGE.public;
  return (
    <Badge variant="outline" className={`border text-xs gap-1 ${cfg.className}`}>
      {v === "premium" && <Star className="h-3 w-3" />}
      {v === "hidden_bundle" && <Lock className="h-3 w-3" />}
      {cfg.label}
    </Badge>
  );
}

export default function AdminVideos() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";

  const [search, setSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [editVideo, setEditVideo] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [bulkAction, setBulkAction] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-videos", search, visibilityFilter, statusFilter, page],
    queryFn: () =>
      adminFetch(
        `/videos?search=${search}&${visibilityFilter !== "all" ? `type=${visibilityFilter}` : ""}&page=${page}&limit=15&includeHidden=true${isOwner ? "" : `&creatorId=${user?.id}`}`,
      ),
    placeholderData: (prev) => prev,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => adminFetch("/categories"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/videos/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-videos"] }); toast({ title: "Video dihapus" }); setDeleteId(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      adminFetch(`/videos/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-videos"] }); toast({ title: "Video diperbarui" }); setEditVideo(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const videos = (data as any)?.data ?? [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  const toggleSelect = (id: number) =>
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () =>
    setSelected(selected.length === videos.length ? [] : videos.map((v: any) => v.id));

  const handleBulkAction = async () => {
    if (!bulkAction || selected.length === 0) return;
    const action = bulkAction;
    setBulkAction("");
    for (const id of selected) {
      if (action === "delete") await adminFetch(`/videos/${id}`, { method: "DELETE" }).catch(() => {});
      else await adminFetch(`/videos/${id}`, { method: "PATCH", body: JSON.stringify({ status: action }) }).catch(() => {});
    }
    setSelected([]);
    refetch();
    toast({ title: `${selected.length} video ${action === "delete" ? "dihapus" : "diperbarui"}` });
  };

  const quickStatus = (id: number, status: string) => updateMut.mutate({ id, data: { status } });

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Manajemen Video</h1>
              <p className="text-sm text-muted-foreground">{total} video ditemukan</p>
            </div>
            <Link href="/admin/upload">
              <Button className="gap-2"><Plus className="h-4 w-4" />Upload Video</Button>
            </Link>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari video..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={visibilityFilter} onValueChange={(v) => { setVisibilityFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Visibilitas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tipe</SelectItem>
                <SelectItem value="free">Gratis</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="hidden_bundle">Bundle</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="published">Dipublikasi</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="hidden">Disembunyikan</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {/* Bulk Actions */}
          {selected.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <CheckSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{selected.length} video dipilih</span>
              <Select value={bulkAction} onValueChange={setBulkAction}>
                <SelectTrigger className="w-40 h-8"><SelectValue placeholder="Pilih aksi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Publish Semua</SelectItem>
                  <SelectItem value="hidden">Sembunyikan Semua</SelectItem>
                  <SelectItem value="draft">Set ke Draft</SelectItem>
                  <SelectItem value="delete">Hapus Semua</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleBulkAction} disabled={!bulkAction}>Terapkan</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Batal</Button>
            </div>
          )}

          {/* Table */}
          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 w-10">
                      <Checkbox
                        checked={selected.length === videos.length && videos.length > 0}
                        onCheckedChange={selectAll}
                      />
                    </th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Video</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Kategori</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Visibilitas</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Status</th>
                    <th className="p-3 text-right font-medium text-muted-foreground hidden md:table-cell">Views</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden xl:table-cell">Tanggal</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading
                    ? Array(8).fill(0).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={8} className="p-3"><Skeleton className="h-10 w-full" /></td>
                      </tr>
                    ))
                    : videos.length === 0
                    ? (
                      <tr>
                        <td colSpan={8} className="py-16 text-center text-muted-foreground">
                          <Video className="h-10 w-10 mx-auto mb-2 opacity-20" />
                          <p>Tidak ada video ditemukan</p>
                        </td>
                      </tr>
                    )
                    : videos.map((v: any) => (
                      <tr key={v.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3">
                          <Checkbox checked={selected.includes(v.id)} onCheckedChange={() => toggleSelect(v.id)} />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            {v.thumbnail ? (
                              <img src={v.thumbnail} className="h-10 w-16 object-cover rounded shrink-0" alt="" />
                            ) : (
                              <div className="h-10 w-16 bg-muted rounded flex items-center justify-center shrink-0">
                                <Video className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium truncate max-w-48">{v.title}</p>
                              <p className="text-xs text-muted-foreground">{v.creator?.username ?? "Unknown"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 hidden md:table-cell text-muted-foreground">
                          {v.category?.name ?? "—"}
                        </td>
                        <td className="p-3 hidden lg:table-cell">
                          <VisibilityBadge visibility={v.visibility} />
                          {v.visibility !== "public" && v.price ? (
                            <p className="text-xs text-muted-foreground mt-0.5">{fmtRp(v.price)}</p>
                          ) : null}
                        </td>
                        <td className="p-3 hidden lg:table-cell">
                          <Badge className={`border text-xs ${STATUS_COLORS[v.status] ?? STATUS_COLORS.draft}`}>
                            {STATUS_LABELS[v.status] ?? v.status}
                          </Badge>
                        </td>
                        <td className="p-3 hidden md:table-cell text-right text-muted-foreground">
                          {(v.views ?? 0).toLocaleString("id-ID")}
                        </td>
                        <td className="p-3 hidden xl:table-cell text-muted-foreground text-xs">
                          {fmtDate(v.createdAt)}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1">
                            {v.status === "published" ? (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Sembunyikan"
                                onClick={() => quickStatus(v.id, "hidden")}>
                                <EyeOff className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Publish"
                                onClick={() => quickStatus(v.id, "published")}>
                                <Globe className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                              onClick={() => setEditVideo(v)}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Hapus"
                              onClick={() => setDeleteId(v.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Halaman {page} dari {totalPages} ({total} total)</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Edit Dialog */}
        {editVideo && (
          <Dialog open={!!editVideo} onOpenChange={() => setEditVideo(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Edit Video</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="text-sm font-medium">Judul</label>
                  <Input
                    className="mt-1"
                    defaultValue={editVideo.title}
                    onChange={(e) => setEditVideo((p: any) => ({ ...p, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Deskripsi</label>
                  <textarea
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px] resize-none"
                    defaultValue={editVideo.description ?? ""}
                    onChange={(e) => setEditVideo((p: any) => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Visibilitas</label>
                    <Select
                      value={editVideo.visibility ?? (editVideo.bundleExclusive ? "hidden_bundle" : editVideo.type === "premium" ? "premium" : "public")}
                      onValueChange={(v) => setEditVideo((p: any) => ({ ...p, visibility: v }))}
                    >
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Gratis (Public)</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                        <SelectItem value="hidden_bundle">Bundle Eksklusif</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Status</label>
                    <Select
                      value={editVideo.status ?? "published"}
                      onValueChange={(v) => setEditVideo((p: any) => ({ ...p, status: v }))}
                    >
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="published">Dipublikasi</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="hidden">Disembunyikan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {(editVideo.visibility === "premium" || editVideo.visibility === "hidden_bundle") && (
                  <div>
                    <label className="text-sm font-medium">Harga (Rp)</label>
                    <Input
                      type="number"
                      className="mt-1"
                      defaultValue={editVideo.price ?? ""}
                      onChange={(e) => setEditVideo((p: any) => ({ ...p, price: parseFloat(e.target.value) || null }))}
                    />
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium">Kategori</label>
                  <Select
                    value={String(editVideo.categoryId ?? "")}
                    onValueChange={(v) => setEditVideo((p: any) => ({ ...p, categoryId: parseInt(v) || null }))}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Tanpa Kategori</SelectItem>
                      {Array.isArray(categories) && categories.map((c: any) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="featured"
                    checked={!!editVideo.isFeatured}
                    onChange={(e) => setEditVideo((p: any) => ({ ...p, isFeatured: e.target.checked }))}
                  />
                  <label htmlFor="featured" className="text-sm">Tampilkan sebagai Featured</label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditVideo(null)}>Batal</Button>
                <Button
                  onClick={() => updateMut.mutate({ id: editVideo.id, data: editVideo })}
                  disabled={updateMut.isPending}
                >
                  {updateMut.isPending ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Delete Confirm */}
        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Video?</AlertDialogTitle>
              <AlertDialogDescription>Video akan dihapus permanen dan tidak bisa dikembalikan.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteId && deleteMut.mutate(deleteId)}
              >
                Ya, Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
