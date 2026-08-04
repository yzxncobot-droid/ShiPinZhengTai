/**
 * Badge & Role Management — Admin page
 *
 * Allows owner to:
 *  - Create / edit / delete custom roles (badge, color, emoji, permissions, revenue split)
 *  - Assign / revoke roles to/from users
 */
import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtDate } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Pencil, Trash2, Users, Award, ShieldCheck, Upload,
  LayoutDashboard, Video, BarChart3, ChevronRight, Search, UserMinus,
  UserPlus, RefreshCw,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CustomRole {
  id: string;
  name: string;
  emoji: string | null;
  color: string;
  description: string | null;
  isActive: boolean;
  priority: number;
  permDashboard: boolean;
  permUploadVideo: boolean;
  permMyVideo: boolean;
  permLeaderboard: boolean;
  permCreatorDashboard: boolean;
  uploadTypes: string[];
  creatorSharePercent: number;
  platformSharePercent: number;
  createdAt: string;
  updatedAt: string;
}

interface AssignedUser {
  assignmentId: string;
  assignedAt: string;
  userId: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  role: string;
}

const UPLOAD_TYPE_OPTS = [
  { value: "free",    label: "Gratis" },
  { value: "premium", label: "Premium" },
  { value: "bundle",  label: "Bundle" },
];

const EMPTY_FORM: Omit<CustomRole, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  emoji: "",
  color: "#6366f1",
  description: "",
  isActive: true,
  priority: 0,
  permDashboard: false,
  permUploadVideo: false,
  permMyVideo: false,
  permLeaderboard: true,
  permCreatorDashboard: false,
  uploadTypes: ["free"],
  creatorSharePercent: 50,
  platformSharePercent: 50,
};

// ── Role Badge display ────────────────────────────────────────────────────────
function RolePill({ role }: { role: CustomRole }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border"
      style={{ borderColor: role.color + "50", backgroundColor: role.color + "18", color: role.color }}
    >
      {role.emoji && <span>{role.emoji}</span>}
      {role.name}
    </span>
  );
}

// ── Role Form Dialog ──────────────────────────────────────────────────────────
function RoleFormDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: CustomRole;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = Boolean(existing);

  const [form, setForm] = useState<Omit<CustomRole, "id" | "createdAt" | "updatedAt">>(
    existing
      ? { ...existing }
      : { ...EMPTY_FORM },
  );

  // Reset when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (!v) onClose();
    else setForm(existing ? { ...existing } : { ...EMPTY_FORM });
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleUploadType = (type: string) => {
    set(
      "uploadTypes",
      form.uploadTypes.includes(type)
        ? form.uploadTypes.filter((t) => t !== type)
        : [...form.uploadTypes, type],
    );
  };

  const mutation = useMutation({
    mutationFn: () =>
      adminFetch(
        isEdit ? `/admin/badge-roles/${existing!.id}` : "/admin/badge-roles",
        {
          method: isEdit ? "PUT" : "POST",
          body: JSON.stringify({
            ...form,
            creatorSharePercent: form.creatorSharePercent,
          }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-roles"] });
      toast({ title: isEdit ? "Role diperbarui" : "Role dibuat", description: form.name });
      onClose();
    },
    onError: (err: any) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            {isEdit ? "Edit Role" : "Buat Role Baru"}
          </DialogTitle>
          <DialogDescription>
            Atur nama, tampilan, permission, akses upload, dan revenue sharing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* ── Identity ── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Identitas</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nama Role *</Label>
                <Input
                  placeholder="mis. Verified Creator"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Emoji / Icon</Label>
                <Input
                  placeholder="mis. ⭐"
                  value={form.emoji ?? ""}
                  onChange={(e) => set("emoji", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Warna Badge</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => set("color", e.target.value)}
                    className="h-9 w-14 cursor-pointer rounded border border-input bg-transparent"
                  />
                  <Input
                    value={form.color}
                    onChange={(e) => set("color", e.target.value)}
                    className="font-mono"
                    placeholder="#6366f1"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Prioritas</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => set("priority", Number(e.target.value))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Deskripsi</Label>
              <Textarea
                rows={2}
                placeholder="Deskripsi singkat tentang role ini…"
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="isActive"
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", v)}
              />
              <Label htmlFor="isActive">Status Aktif</Label>
            </div>
          </section>

          {/* ── Preview ── */}
          {form.name && (
            <div className="rounded-lg border p-3 bg-muted/30 flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Preview:</span>
              <RolePill role={{ ...form, id: "", createdAt: "", updatedAt: "" } as CustomRole} />
            </div>
          )}

          {/* ── Permissions ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Permission Akses</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { key: "permDashboard" as const, label: "Dashboard", icon: LayoutDashboard },
                { key: "permUploadVideo" as const, label: "Upload Video", icon: Upload },
                { key: "permMyVideo" as const, label: "My Video", icon: Video },
                { key: "permLeaderboard" as const, label: "Leaderboard", icon: BarChart3 },
                { key: "permCreatorDashboard" as const, label: "Creator Dashboard", icon: ChevronRight },
              ].map(({ key, label, icon: Icon }) => (
                <label
                  key={key}
                  className={`flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                    form[key] ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={form[key]}
                    onCheckedChange={(v) => set(key, Boolean(v))}
                  />
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* ── Upload Types ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Jenis Upload yang Diizinkan</h3>
            <div className="flex gap-3">
              {UPLOAD_TYPE_OPTS.map(({ value, label }) => (
                <label
                  key={value}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 cursor-pointer transition-colors ${
                    form.uploadTypes.includes(value)
                      ? "border-primary/50 bg-primary/5 text-primary"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={form.uploadTypes.includes(value)}
                    onCheckedChange={() => toggleUploadType(value)}
                  />
                  <span className="text-sm font-medium">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* ── Revenue Sharing ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Revenue Sharing</h3>
            <p className="text-xs text-muted-foreground">
              Persentase pendapatan dari pembelian video premium oleh pengguna ber-role ini.
            </p>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Creator mendapat</span>
                  <span className="font-bold text-primary">{form.creatorSharePercent}%</span>
                </div>
                <Slider
                  min={0} max={100} step={5}
                  value={[form.creatorSharePercent]}
                  onValueChange={([v]) => {
                    set("creatorSharePercent", v);
                    set("platformSharePercent", 100 - v);
                  }}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0% (Platform 100%)</span>
                  <span>100% (Platform 0%)</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Creator</p>
                  <p className="text-xl font-bold text-green-600">{form.creatorSharePercent}%</p>
                </div>
                <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Platform</p>
                  <p className="text-xl font-bold text-blue-600">{form.platformSharePercent}%</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.name || mutation.isPending}
          >
            {mutation.isPending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Buat Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Assign User Dialog ────────────────────────────────────────────────────────
function AssignUserDialog({
  role,
  open,
  onClose,
}: {
  role: CustomRole;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useQuery<any[]>({
    queryKey: ["badge-roles-users-search", search],
    queryFn: () =>
      adminFetch(`/admin/users?search=${encodeURIComponent(search)}&limit=20`)
        .then((res: any) => (Array.isArray(res) ? res : (res?.data ?? []))),
    enabled: open,
  });

  const { data: assigned } = useQuery<AssignedUser[]>({
    queryKey: ["badge-roles-assigned", role.id],
    queryFn: () => adminFetch(`/admin/badge-roles/${role.id}/users`),
    enabled: open,
  });
  const assignedIds = new Set((assigned ?? []).map((a) => a.userId));

  const assignMutation = useMutation({
    mutationFn: (userId: string) =>
      adminFetch(`/admin/badge-roles/${role.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-roles-assigned", role.id] });
      toast({ title: "Role diberikan" });
    },
    onError: (err: any) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) =>
      adminFetch(`/admin/badge-roles/${role.id}/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-roles-assigned", role.id] });
      toast({ title: "Role dicabut" });
    },
    onError: (err: any) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Assign Role: <RolePill role={role} />
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 min-h-0 max-h-80">
          {isLoading ? (
            Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
          ) : (
            (users as any[] | undefined ?? []).map((u: any) => {
              const isAssigned = assignedIds.has(u.id);
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-3 rounded-lg p-2.5 border hover:bg-muted/30 transition-colors"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={u.avatar} />
                    <AvatarFallback className="text-xs">{u.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.username}</p>
                    <p className="text-xs text-muted-foreground">{u.role}</p>
                  </div>
                  {isAssigned ? (
                    <Button
                      size="sm" variant="destructive"
                      onClick={() => revokeMutation.mutate(u.id)}
                      disabled={revokeMutation.isPending}
                    >
                      <UserMinus className="h-3.5 w-3.5 mr-1" /> Cabut
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="outline"
                      onClick={() => assignMutation.mutate(u.id)}
                      disabled={assignMutation.isPending}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AdminBadgeRolesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<CustomRole | null>(null);
  const [deleteRole, setDeleteRole] = useState<CustomRole | null>(null);
  const [assignRole, setAssignRole] = useState<CustomRole | null>(null);
  const [detailRole, setDetailRole] = useState<CustomRole | null>(null);

  const { data: roles, isLoading, refetch, isFetching } = useQuery<CustomRole[]>({
    queryKey: ["badge-roles"],
    queryFn: () => adminFetch("/admin/badge-roles"),
  });

  const { data: detailUsers, isLoading: detailUsersLoading } = useQuery<AssignedUser[]>({
    queryKey: ["badge-roles-assigned", detailRole?.id],
    queryFn: () => adminFetch(`/admin/badge-roles/${detailRole!.id}/users`),
    enabled: Boolean(detailRole),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminFetch(`/admin/badge-roles/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-roles"] });
      toast({ title: "Role dihapus" });
      setDeleteRole(null);
    },
    onError: (err: any) => toast({ title: "Gagal menghapus", description: err.message, variant: "destructive" }),
  });

  const revokeFromDetail = useMutation({
    mutationFn: ({ roleId, userId }: { roleId: string; userId: string }) =>
      adminFetch(`/admin/badge-roles/${roleId}/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badge-roles-assigned", detailRole?.id] });
      toast({ title: "Role dicabut" });
    },
    onError: (err: any) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                Badge & Role Management
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Kelola role dinamis — permission, akses upload, dan revenue sharing.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Buat Role
              </Button>
            </div>
          </div>

          {/* Roles Grid / Table */}
          {isLoading ? (
            <div className="space-y-3">
              {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : !roles?.length ? (
            <div className="text-center py-20 text-muted-foreground">
              <Award className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Belum ada role</p>
              <p className="text-sm mt-1">Klik "Buat Role" untuk memulai.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="rounded-xl border bg-card p-4 space-y-3 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setDetailRole(role)}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <RolePill role={role} />
                      {!role.isActive && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Nonaktif</Badge>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => setAssignRole(role)}
                        title="Assign ke user"
                      >
                        <Users className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => setEditRole(role)}
                        title="Edit role"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteRole(role)}
                        title="Hapus role"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Description */}
                  {role.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{role.description}</p>
                  )}

                  {/* Revenue split */}
                  <div className="flex gap-2">
                    <div className="flex-1 rounded bg-green-50 dark:bg-green-950/30 px-2 py-1.5 text-center">
                      <p className="text-[10px] text-muted-foreground">Creator</p>
                      <p className="text-sm font-bold text-green-600">{role.creatorSharePercent}%</p>
                    </div>
                    <div className="flex-1 rounded bg-blue-50 dark:bg-blue-950/30 px-2 py-1.5 text-center">
                      <p className="text-[10px] text-muted-foreground">Platform</p>
                      <p className="text-sm font-bold text-blue-600">{role.platformSharePercent}%</p>
                    </div>
                  </div>

                  {/* Permissions mini-chips */}
                  <div className="flex flex-wrap gap-1">
                    {role.permDashboard && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">Dashboard</span>
                    )}
                    {role.permUploadVideo && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">Upload</span>
                    )}
                    {role.permMyVideo && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">My Video</span>
                    )}
                    {role.permLeaderboard && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">Leaderboard</span>
                    )}
                    {role.permCreatorDashboard && (
                      <span className="text-[10px] rounded px-1.5 py-0.5 bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300">Creator Dash</span>
                    )}
                    {role.uploadTypes.map((t) => (
                      <span key={t} className="text-[10px] rounded px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                        {t}
                      </span>
                    ))}
                  </div>

                  <p className="text-[10px] text-muted-foreground">Prioritas: {role.priority}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Role Detail Drawer ── */}
        <Dialog open={Boolean(detailRole)} onOpenChange={(v) => !v && setDetailRole(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
            {detailRole && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <RolePill role={detailRole} />
                    <span className="text-muted-foreground font-normal text-sm">— Detail</span>
                  </DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="info" className="flex-1 flex flex-col min-h-0">
                  <TabsList className="shrink-0">
                    <TabsTrigger value="info">Info</TabsTrigger>
                    <TabsTrigger value="users">Pengguna</TabsTrigger>
                  </TabsList>

                  <TabsContent value="info" className="overflow-y-auto space-y-4 mt-4">
                    {detailRole.description && (
                      <p className="text-sm text-muted-foreground">{detailRole.description}</p>
                    )}

                    {/* Revenue */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Creator mendapat</p>
                        <p className="text-2xl font-bold text-green-600">{detailRole.creatorSharePercent}%</p>
                      </div>
                      <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 p-4 text-center">
                        <p className="text-xs text-muted-foreground mb-1">Platform mendapat</p>
                        <p className="text-2xl font-bold text-blue-600">{detailRole.platformSharePercent}%</p>
                      </div>
                    </div>

                    {/* Permissions */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Permission</h4>
                      <Table>
                        <TableBody>
                          {[
                            { label: "Dashboard Admin", v: detailRole.permDashboard },
                            { label: "Upload Video", v: detailRole.permUploadVideo },
                            { label: "My Video", v: detailRole.permMyVideo },
                            { label: "Leaderboard", v: detailRole.permLeaderboard },
                            { label: "Creator Dashboard", v: detailRole.permCreatorDashboard },
                          ].map(({ label, v }) => (
                            <TableRow key={label}>
                              <TableCell className="text-sm">{label}</TableCell>
                              <TableCell>
                                <Badge variant={v ? "default" : "outline"} className={v ? "bg-green-500" : ""}>
                                  {v ? "✓ Diizinkan" : "✗ Ditolak"}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow>
                            <TableCell className="text-sm">Jenis Upload</TableCell>
                            <TableCell className="flex gap-1 flex-wrap">
                              {detailRole.uploadTypes.map((t) => (
                                <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                              ))}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Dibuat: {fmtDate(detailRole.createdAt)} · Diperbarui: {fmtDate(detailRole.updatedAt)}
                    </p>
                  </TabsContent>

                  <TabsContent value="users" className="flex-1 overflow-y-auto mt-4 min-h-0">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-sm font-semibold">Pengguna dengan role ini</h4>
                      <Button size="sm" onClick={() => { setDetailRole(null); setAssignRole(detailRole); }}>
                        <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign
                      </Button>
                    </div>
                    {detailUsersLoading ? (
                      <div className="space-y-2">{Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                    ) : !detailUsers?.length ? (
                      <p className="text-sm text-muted-foreground text-center py-10">Belum ada pengguna dengan role ini.</p>
                    ) : (
                      <div className="space-y-1">
                        {detailUsers.map((u) => (
                          <div key={u.userId} className="flex items-center gap-3 rounded-lg border p-2.5">
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarImage src={u.avatar ?? undefined} />
                              <AvatarFallback className="text-xs">{u.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{u.username}</p>
                              <p className="text-xs text-muted-foreground">Diberikan {fmtDate(u.assignedAt)}</p>
                            </div>
                            <Button
                              size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 h-7"
                              onClick={() => revokeFromDetail.mutate({ roleId: detailRole.id, userId: u.userId })}
                              disabled={revokeFromDetail.isPending}
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setDetailRole(null); setEditRole(detailRole); }}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Role
                  </Button>
                  <Button onClick={() => setDetailRole(null)}>Tutup</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Create / Edit Form ── */}
        <RoleFormDialog
          open={createOpen || Boolean(editRole)}
          onClose={() => { setCreateOpen(false); setEditRole(null); }}
          existing={editRole ?? undefined}
        />

        {/* ── Assign Dialog ── */}
        {assignRole && (
          <AssignUserDialog
            role={assignRole}
            open={Boolean(assignRole)}
            onClose={() => setAssignRole(null)}
          />
        )}

        {/* ── Delete Confirm ── */}
        <AlertDialog open={Boolean(deleteRole)} onOpenChange={(v) => !v && setDeleteRole(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Role?</AlertDialogTitle>
              <AlertDialogDescription>
                Role <strong>{deleteRole?.name}</strong> akan dihapus permanen. Semua user yang
                memiliki role ini akan kehilangan assignment-nya secara otomatis.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteMutation.mutate(deleteRole!.id)}
                disabled={deleteMutation.isPending}
              >
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
