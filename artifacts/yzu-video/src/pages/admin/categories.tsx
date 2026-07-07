import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtDate } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Search, FolderOpen, RefreshCw } from "lucide-react";
import { Label } from "@/components/ui/label";

const EMPTY_FORM = { name: "", slug: "", description: "", icon: "", sortOrder: 0, isActive: true };

export default function AdminCategories() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editCat, setEditCat] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);

  const { data: categories, isLoading, refetch } = useQuery({
    queryKey: ["admin-categories", search],
    queryFn: () => adminFetch(`/categories?search=${search}`),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => adminFetch("/categories", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-categories"] }); toast({ title: "Kategori dibuat" }); setShowForm(false); setForm(EMPTY_FORM); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => adminFetch(`/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-categories"] }); toast({ title: "Kategori diperbarui" }); setEditCat(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-categories"] }); toast({ title: "Kategori dihapus" }); setDeleteId(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const cats = Array.isArray(categories) ? categories : [];
  const filtered = search ? cats.filter((c: any) => c.name.toLowerCase().includes(search.toLowerCase())) : cats;

  const openEdit = (cat: any) => {
    setEditCat(cat);
    setForm({ name: cat.name, slug: cat.slug ?? "", description: cat.description ?? "", icon: cat.icon ?? "", sortOrder: cat.sortOrder ?? 0, isActive: cat.isActive ?? true });
  };

  const FormFields = ({ state, onChange }: { state: any; onChange: (f: string, v: any) => void }) => (
    <div className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Nama Kategori *</Label>
          <Input value={state.name} onChange={(e) => onChange("name", e.target.value)} placeholder="Contoh: Drama" />
        </div>
        <div className="space-y-1.5">
          <Label>Slug</Label>
          <Input value={state.slug} onChange={(e) => onChange("slug", e.target.value)} placeholder="drama" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Deskripsi</Label>
        <Input value={state.description} onChange={(e) => onChange("description", e.target.value)} placeholder="Deskripsi kategori" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Ikon (emoji atau nama)</Label>
          <Input value={state.icon} onChange={(e) => onChange("icon", e.target.value)} placeholder="🎭 atau drama" />
        </div>
        <div className="space-y-1.5">
          <Label>Urutan Tampil</Label>
          <Input type="number" value={state.sortOrder} onChange={(e) => onChange("sortOrder", parseInt(e.target.value) || 0)} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="isActive" checked={state.isActive} onChange={(e) => onChange("isActive", e.target.checked)} />
        <Label htmlFor="isActive">Aktif (tampilkan di aplikasi)</Label>
      </div>
    </div>
  );

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Manajemen Kategori</h1>
              <p className="text-sm text-muted-foreground">{filtered.length} kategori</p>
            </div>
            <Button className="gap-2" onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }}>
              <Plus className="h-4 w-4" />Tambah Kategori
            </Button>
          </div>

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cari kategori..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </div>

          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium text-muted-foreground">Nama</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Slug</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Ikon</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Urutan</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Dibuat</th>
                  <th className="p-3 text-center font-medium text-muted-foreground">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading
                  ? Array(5).fill(0).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="p-3"><Skeleton className="h-8 w-full" /></td></tr>
                  ))
                  : filtered.length === 0
                  ? (
                    <tr><td colSpan={7} className="py-16 text-center text-muted-foreground">
                      <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      <p>Tidak ada kategori</p>
                    </td></tr>
                  )
                  : filtered.map((cat: any) => (
                    <tr key={cat.id} className="hover:bg-muted/20">
                      <td className="p-3 font-medium">{cat.name}</td>
                      <td className="p-3 text-muted-foreground hidden md:table-cell font-mono text-xs">{cat.slug ?? "—"}</td>
                      <td className="p-3 hidden md:table-cell text-xl">{cat.icon ?? "📁"}</td>
                      <td className="p-3 hidden lg:table-cell text-muted-foreground">{cat.sortOrder ?? 0}</td>
                      <td className="p-3">
                        <Badge variant={cat.isActive !== false ? "default" : "secondary"}>
                          {cat.isActive !== false ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </td>
                      <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">{fmtDate(cat.createdAt)}</td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cat)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(cat.id)}>
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

        {/* Create Dialog */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader><DialogTitle>Tambah Kategori Baru</DialogTitle></DialogHeader>
            <FormFields state={form} onChange={(f, v) => setForm((p) => ({ ...p, [f]: v }))} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button onClick={() => createMut.mutate(form)} disabled={createMut.isPending || !form.name}>
                {createMut.isPending ? "Membuat..." : "Buat Kategori"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editCat} onOpenChange={() => setEditCat(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Kategori</DialogTitle></DialogHeader>
            <FormFields state={form} onChange={(f, v) => setForm((p) => ({ ...p, [f]: v }))} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditCat(null)}>Batal</Button>
              <Button onClick={() => updateMut.mutate({ id: editCat.id, data: form })} disabled={updateMut.isPending}>
                {updateMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Kategori?</AlertDialogTitle>
              <AlertDialogDescription>Video dalam kategori ini akan kehilangan kategorinya.</AlertDialogDescription>
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
