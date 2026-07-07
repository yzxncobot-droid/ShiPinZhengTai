import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDate } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Star, RefreshCw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMPTY_FORM = {
  name: "", description: "", price: "", durationDays: "30",
  features: "", isActive: true, color: "#6366f1", badge: "",
};

export default function AdminSubscriptions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editPlan, setEditPlan] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);

  const { data: plans, isLoading, refetch } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: () => adminFetch("/subscriptions"),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => adminFetch("/subscriptions", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-subscriptions"] }); toast({ title: "Plan dibuat" }); setShowForm(false); setForm(EMPTY_FORM); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => adminFetch(`/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-subscriptions"] }); toast({ title: "Plan diperbarui" }); setEditPlan(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/subscriptions/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-subscriptions"] }); toast({ title: "Plan dihapus" }); setDeleteId(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const allPlans = Array.isArray(plans) ? plans : [];

  const openEdit = (plan: any) => {
    setEditPlan(plan);
    setForm({
      name: plan.name, description: plan.description ?? "", price: String(plan.price),
      durationDays: String(plan.durationDays), features: Array.isArray(plan.features) ? plan.features.join("\n") : "",
      isActive: plan.isActive ?? true, color: plan.color ?? "#6366f1", badge: plan.badge ?? "",
    });
  };

  const buildPayload = (f: typeof EMPTY_FORM) => ({
    ...f,
    price: parseFloat(f.price) || 0,
    durationDays: parseInt(f.durationDays) || 30,
    features: f.features ? f.features.split("\n").filter(Boolean) : [],
  });

  const FormFields = () => (
    <div className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Nama Plan *</Label>
          <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Silver" />
        </div>
        <div className="space-y-1.5">
          <Label>Badge Label</Label>
          <Input value={form.badge} onChange={(e) => setForm(p => ({ ...p, badge: e.target.value }))} placeholder="Populer" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Deskripsi</Label>
        <Input value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Akses konten premium" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Harga (Rp) *</Label>
          <Input type="number" value={form.price} onChange={(e) => setForm(p => ({ ...p, price: e.target.value }))} placeholder="50000" />
        </div>
        <div className="space-y-1.5">
          <Label>Durasi (hari) *</Label>
          <Input type="number" value={form.durationDays} onChange={(e) => setForm(p => ({ ...p, durationDays: e.target.value }))} placeholder="30" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Fitur (1 per baris)</Label>
        <Textarea value={form.features} onChange={(e) => setForm(p => ({ ...p, features: e.target.value }))}
          placeholder={"Akses semua video premium\nDownload video\nTanpa iklan"} rows={4} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Warna Aksen</Label>
          <div className="flex gap-2">
            <Input type="color" value={form.color} onChange={(e) => setForm(p => ({ ...p, color: e.target.value }))} className="w-12 h-9 p-1" />
            <Input value={form.color} onChange={(e) => setForm(p => ({ ...p, color: e.target.value }))} placeholder="#6366f1" />
          </div>
        </div>
        <div className="flex items-end gap-2 pb-0.5">
          <input type="checkbox" id="planActive" checked={form.isActive} onChange={(e) => setForm(p => ({ ...p, isActive: e.target.checked }))} />
          <Label htmlFor="planActive">Plan Aktif</Label>
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
              <h1 className="text-2xl font-bold">Manajemen Langganan</h1>
              <p className="text-sm text-muted-foreground">{allPlans.length} plan tersedia</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
              <Button className="gap-2" onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }}>
                <Plus className="h-4 w-4" />Tambah Plan
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
            </div>
          ) : allPlans.length === 0 ? (
            <div className="py-24 text-center text-muted-foreground">
              <Star className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p>Belum ada plan langganan</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allPlans.map((plan: any) => (
                <div key={plan.id} className="bg-card rounded-xl border p-5 space-y-4 hover:shadow-md transition-shadow relative">
                  {plan.badge && (
                    <Badge className="absolute top-3 right-3 text-xs" style={{ backgroundColor: plan.color ?? "#6366f1", color: "#fff" }}>
                      {plan.badge}
                    </Badge>
                  )}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${plan.color ?? "#6366f1"}20` }}>
                        <Star className="h-4 w-4" style={{ color: plan.color ?? "#6366f1" }} />
                      </div>
                      <h3 className="font-bold text-lg">{plan.name}</h3>
                    </div>
                    <p className="text-muted-foreground text-sm">{plan.description}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{fmtRp(plan.price)}</p>
                    <p className="text-xs text-muted-foreground">per {plan.durationDays} hari</p>
                  </div>
                  {Array.isArray(plan.features) && plan.features.length > 0 && (
                    <ul className="space-y-1">
                      {plan.features.map((f: string, i: number) => (
                        <li key={i} className="text-sm flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <Badge variant={plan.isActive ? "default" : "secondary"}>
                      {plan.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(plan)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(plan.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Tambah Plan Baru</DialogTitle></DialogHeader>
            <FormFields />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button onClick={() => createMut.mutate(buildPayload(form))} disabled={createMut.isPending || !form.name || !form.price}>
                {createMut.isPending ? "Membuat..." : "Buat Plan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editPlan} onOpenChange={() => setEditPlan(null)}>
          <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Edit Plan</DialogTitle></DialogHeader>
            <FormFields />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPlan(null)}>Batal</Button>
              <Button onClick={() => updateMut.mutate({ id: editPlan.id, data: buildPayload(form) })} disabled={updateMut.isPending}>
                {updateMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Hapus Plan?</AlertDialogTitle>
              <AlertDialogDescription>User aktif tidak akan terpengaruh, tapi plan tidak bisa dipilih lagi.</AlertDialogDescription>
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
