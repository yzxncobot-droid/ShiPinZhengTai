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
  Hash, Plus, Edit3, Trash2, MoreVertical, Loader2, Lock, Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatRoom {
  id: string; name: string; slug: string; description?: string;
  imageUrl?: string; rules?: string; isLocked: boolean;
  slowModeSeconds: number; memberCount: number; createdAt: string;
}

const EMPTY: Partial<ChatRoom> = { name: "", slug: "", description: "", imageUrl: "", rules: "", isLocked: false, slowModeSeconds: 0 };

function toSlug(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export default function AdminChatRoomsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<ChatRoom>>(EMPTY);
  const [isEditMode, setIsEditMode] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ["admin-chat-rooms"],
    queryFn: () => adminFetch<ChatRoom[]>("/chat/rooms"),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => adminFetch("/chat/rooms", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-chat-rooms"] }); setModalOpen(false); toast({ title: "Room dibuat!" }); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => adminFetch(`/chat/rooms/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-chat-rooms"] }); setModalOpen(false); toast({ title: "Disimpan!" }); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminFetch(`/chat/rooms/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-chat-rooms"] }); setDeleteId(null); toast({ title: "Room dihapus" }); },
  });

  const lockMutation = useMutation({
    mutationFn: ({ id, isLocked }: { id: string; isLocked: boolean }) =>
      adminFetch(`/chat/rooms/${id}`, { method: "PATCH", body: JSON.stringify({ isLocked }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-chat-rooms"] }),
  });

  const openCreate = () => { setEditing(EMPTY); setIsEditMode(false); setModalOpen(true); };
  const openEdit = (room: ChatRoom) => { setEditing({ ...room }); setIsEditMode(true); setModalOpen(true); };

  const handleSubmit = () => {
    if (!editing.name?.trim()) { toast({ title: "Nama wajib diisi", variant: "destructive" }); return; }
    const slug = editing.slug?.trim() || toSlug(editing.name);
    const data = {
      name: editing.name.trim(),
      slug,
      description: editing.description?.trim() || null,
      imageUrl: editing.imageUrl?.trim() || null,
      rules: editing.rules?.trim() || null,
      isLocked: editing.isLocked ?? false,
      slowModeSeconds: editing.slowModeSeconds ?? 0,
    };
    if (isEditMode && editing.id) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const COLORS = ["from-purple-400 to-pink-400", "from-blue-400 to-cyan-400", "from-amber-400 to-orange-400", "from-green-400 to-teal-400", "from-rose-400 to-pink-500"];

  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <AdminLayout>
        <div className="p-6 max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
                <Hash className="h-6 w-6 text-purple-500" /> Chat Rooms
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">Kelola public chat rooms komunitas</p>
            </div>
            <Button
              onClick={openCreate}
              className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none shadow-md gap-2"
            >
              <Plus className="h-4 w-4" /> Buat Room
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-slate-100">
              <Hash className="h-12 w-12 text-slate-200 mb-3" />
              <p className="font-bold text-slate-500">Belum ada chat room</p>
              <p className="text-sm text-slate-400 mt-1">Klik "Buat Room" untuk memulai</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {rooms.map((room) => {
                const color = COLORS[room.name.charCodeAt(0) % COLORS.length];
                return (
                  <div key={room.id} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex items-center gap-3">
                    {room.imageUrl ? (
                      <img src={room.imageUrl} alt={room.name} className="h-12 w-12 rounded-2xl object-cover shrink-0" />
                    ) : (
                      <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center shrink-0`}>
                        <Hash className="h-6 w-6 text-white" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-extrabold text-slate-800 truncate">{room.name}</p>
                        {room.isLocked && <Lock className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                      </div>
                      {room.description && <p className="text-xs text-slate-500 truncate">{room.description}</p>}
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Users className="h-3 w-3" /> {(room.memberCount ?? 0).toLocaleString()} anggota
                        {room.slowModeSeconds > 0 && <span className="ml-2 text-amber-500">⏳ Slow {room.slowModeSeconds}s</span>}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-8 w-8 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 shrink-0">
                          <MoreVertical className="h-4 w-4 text-slate-500" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(room)} className="gap-2">
                          <Edit3 className="h-3.5 w-3.5" /> Edit Room
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => lockMutation.mutate({ id: room.id, isLocked: !room.isLocked })} className="gap-2">
                          <Lock className="h-3.5 w-3.5" /> {room.isLocked ? "Buka Kunci" : "Kunci Room"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteId(room.id)} className="gap-2 text-red-600 focus:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" /> Hapus Room
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create / Edit Modal */}
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="max-w-lg rounded-3xl">
            <DialogHeader>
              <DialogTitle>{isEditMode ? "Edit Room" : "Buat Chat Room Baru"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <Label className="font-semibold">Nama Room *</Label>
                <Input
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing((p) => ({
                    ...p,
                    name: e.target.value,
                    slug: p.slug === toSlug(p.name ?? "") ? toSlug(e.target.value) : p.slug,
                  }))}
                  placeholder="General, Gaming, Anime..."
                  className="mt-1 rounded-xl"
                />
              </div>

              <div>
                <Label className="font-semibold text-sm">Slug (URL)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-slate-400 text-sm">#</span>
                  <Input
                    value={editing.slug ?? ""}
                    onChange={(e) => setEditing((p) => ({ ...p, slug: toSlug(e.target.value) }))}
                    placeholder="general"
                    className="rounded-xl font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <Label className="font-semibold">Deskripsi</Label>
                <Textarea
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Tentang room ini..."
                  className="mt-1 rounded-xl resize-none h-20"
                />
              </div>

              <div>
                <Label className="font-semibold text-sm">Peraturan Room</Label>
                <Textarea
                  value={editing.rules ?? ""}
                  onChange={(e) => setEditing((p) => ({ ...p, rules: e.target.value }))}
                  placeholder="Peraturan yang harus ditaati..."
                  className="mt-1 rounded-xl resize-none h-16 text-sm"
                />
              </div>

              <div>
                <Label className="font-semibold text-sm">URL Gambar Room</Label>
                <Input
                  value={editing.imageUrl ?? ""}
                  onChange={(e) => setEditing((p) => ({ ...p, imageUrl: e.target.value }))}
                  placeholder="https://..."
                  className="mt-1 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={editing.isLocked ?? false}
                    onCheckedChange={(v) => setEditing((p) => ({ ...p, isLocked: v }))}
                  />
                  <Label className="font-semibold text-sm">Kunci Room</Label>
                </div>
                <div>
                  <Label className="font-semibold text-xs">Slow Mode (detik)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={editing.slowModeSeconds ?? 0}
                    onChange={(e) => setEditing((p) => ({ ...p, slowModeSeconds: parseInt(e.target.value) || 0 }))}
                    className="mt-1 rounded-xl text-sm h-8"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Batal</Button>
              <Button
                onClick={handleSubmit}
                disabled={isSaving}
                className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none"
              >
                {isSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Menyimpan...</> : isEditMode ? "Simpan" : "Buat Room"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <DialogContent className="max-w-sm rounded-3xl">
            <DialogHeader><DialogTitle>Hapus room ini?</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-500">Semua pesan dalam room akan ikut terhapus.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteId(null)}>Batal</Button>
              <Button
                variant="destructive"
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="rounded-2xl"
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus Permanen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
