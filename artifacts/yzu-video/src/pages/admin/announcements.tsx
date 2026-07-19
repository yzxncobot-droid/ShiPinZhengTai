import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { adminFetch } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Megaphone, Plus, Pin, Edit3, Trash2, MoreVertical, Loader2,
  Image as ImageIcon, Link as LinkIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

interface Announcement {
  id: string; title: string; content: string;
  imageUrl?: string; videoUrl?: string; linkUrl?: string; linkLabel?: string;
  isPinned: boolean; visibility: string;
  authorUsername: string; createdAt: string; updatedAt: string;
  commentCount: number;
  reactions: { emoji: string; count: number }[];
}

const EMPTY: Partial<Announcement> = { title: "", content: "", imageUrl: "", videoUrl: "", linkUrl: "", linkLabel: "", isPinned: false, visibility: "all" };

export default function AdminAnnouncementsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Announcement>>(EMPTY);
  const [isEditMode, setIsEditMode] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: () => adminFetch<Announcement[]>("/announcements?limit=50"),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => adminFetch("/announcements", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-announcements"] }); setModalOpen(false); toast({ title: "Pengumuman dibuat!" }); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => adminFetch(`/announcements/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-announcements"] }); setModalOpen(false); toast({ title: "Disimpan!" }); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminFetch(`/announcements/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-announcements"] }); setDeleteId(null); toast({ title: "Dihapus" }); },
  });

  const pinMutation = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) =>
      adminFetch(`/announcements/${id}`, { method: "PATCH", body: JSON.stringify({ isPinned }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-announcements"] }),
  });

  const openCreate = () => { setEditing(EMPTY); setIsEditMode(false); setModalOpen(true); };
  const openEdit = (ann: Announcement) => { setEditing({ ...ann }); setIsEditMode(true); setModalOpen(true); };

  const handleSubmit = () => {
    if (!editing.title?.trim() || !editing.content?.trim()) {
      toast({ title: "Judul dan konten wajib diisi", variant: "destructive" }); return;
    }
    const data = { title: editing.title, content: editing.content, imageUrl: editing.imageUrl || null, videoUrl: editing.videoUrl || null, linkUrl: editing.linkUrl || null, linkLabel: editing.linkLabel || null, isPinned: editing.isPinned ?? false, visibility: editing.visibility ?? "all" };
    if (isEditMode && editing.id) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <AdminLayout>
        <div className="p-6 max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
                <Megaphone className="h-6 w-6 text-purple-500" /> Pengumuman
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">Buat dan kelola pengumuman untuk semua pengguna</p>
            </div>
            <Button
              onClick={openCreate}
              className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none shadow-md gap-2"
            >
              <Plus className="h-4 w-4" /> Buat Pengumuman
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
            </div>
          ) : announcements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-slate-100">
              <Megaphone className="h-12 w-12 text-slate-200 mb-3" />
              <p className="font-bold text-slate-500">Belum ada pengumuman</p>
              <p className="text-sm text-slate-400 mt-1">Klik "Buat Pengumuman" untuk memulai</p>
            </div>
          ) : (
            <div className="space-y-3">
              {announcements.map((ann) => (
                <div key={ann.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${ann.isPinned ? "border-amber-200 bg-amber-50/30" : "border-slate-100"}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {ann.isPinned && (
                          <span className="flex items-center gap-1 text-[10px] font-extrabold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full uppercase">
                            <Pin className="h-2.5 w-2.5" /> Disematkan
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${ann.visibility === "all" ? "bg-green-100 text-green-700" : "bg-purple-100 text-purple-700"}`}>
                          {ann.visibility}
                        </span>
                      </div>
                      <h3 className="font-extrabold text-slate-800">{ann.title}</h3>
                      <p className="text-sm text-slate-500 mt-1 line-clamp-2">{ann.content}</p>
                      {ann.imageUrl && <p className="text-[11px] text-purple-500 mt-1 flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Ada gambar</p>}
                      {ann.linkUrl && <p className="text-[11px] text-blue-500 mt-0.5 flex items-center gap-1"><LinkIcon className="h-3 w-3" /> {ann.linkUrl}</p>}
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
                        <span>{formatDistanceToNow(new Date(ann.createdAt), { addSuffix: true, locale: localeId })}</span>
                        <span>💬 {ann.commentCount} komentar</span>
                        <span>
                          {ann.reactions.map((r) => `${r.emoji}${r.count}`).join(" ")}
                        </span>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-8 w-8 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors shrink-0">
                          <MoreVertical className="h-4 w-4 text-slate-500" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(ann)} className="gap-2">
                          <Edit3 className="h-3.5 w-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => pinMutation.mutate({ id: ann.id, isPinned: !ann.isPinned })} className="gap-2">
                          <Pin className="h-3.5 w-3.5" /> {ann.isPinned ? "Lepas pin" : "Sematkan"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteId(ann.id)} className="gap-2 text-red-600 focus:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" /> Hapus
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create / Edit Modal */}
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="max-w-lg rounded-3xl">
            <DialogHeader>
              <DialogTitle>{isEditMode ? "Edit Pengumuman" : "Buat Pengumuman Baru"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <Label className="font-semibold">Judul *</Label>
                <Input
                  value={editing.title ?? ""}
                  onChange={(e) => setEditing((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Judul pengumuman..."
                  className="mt-1 rounded-xl"
                />
              </div>

              <div>
                <Label className="font-semibold">Konten *</Label>
                <Textarea
                  value={editing.content ?? ""}
                  onChange={(e) => setEditing((p) => ({ ...p, content: e.target.value }))}
                  placeholder="Tulis pengumuman di sini..."
                  className="mt-1 rounded-xl resize-none min-h-[120px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="font-semibold text-xs">URL Gambar</Label>
                  <Input
                    value={editing.imageUrl ?? ""}
                    onChange={(e) => setEditing((p) => ({ ...p, imageUrl: e.target.value }))}
                    placeholder="https://..."
                    className="mt-1 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <Label className="font-semibold text-xs">URL Link</Label>
                  <Input
                    value={editing.linkUrl ?? ""}
                    onChange={(e) => setEditing((p) => ({ ...p, linkUrl: e.target.value }))}
                    placeholder="https://..."
                    className="mt-1 rounded-xl text-sm"
                  />
                </div>
              </div>

              {editing.linkUrl && (
                <div>
                  <Label className="font-semibold text-xs">Label Link</Label>
                  <Input
                    value={editing.linkLabel ?? ""}
                    onChange={(e) => setEditing((p) => ({ ...p, linkLabel: e.target.value }))}
                    placeholder="Klik di sini..."
                    className="mt-1 rounded-xl text-sm"
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <Switch
                  checked={editing.isPinned ?? false}
                  onCheckedChange={(v) => setEditing((p) => ({ ...p, isPinned: v }))}
                />
                <Label className="font-semibold">Sematkan di atas</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Batal</Button>
              <Button
                onClick={handleSubmit}
                disabled={isSaving}
                className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none"
              >
                {isSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Menyimpan...</> : isEditMode ? "Simpan Perubahan" : "Publikasi"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <DialogContent className="max-w-sm rounded-3xl">
            <DialogHeader>
              <DialogTitle>Hapus pengumuman?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-500">Tindakan ini tidak bisa dibatalkan.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteId(null)}>Batal</Button>
              <Button
                variant="destructive"
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="rounded-2xl"
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
