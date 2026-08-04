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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search, ChevronLeft, ChevronRight, Users, RefreshCw,
  Wallet, Crown, Ban, CheckCircle2,
} from "lucide-react";
import { Label } from "@/components/ui/label";

// ── Custom Role Badge ──────────────────────────────────────────────────────────
function CustomRoleBadge({ customRole, systemRole }: { customRole?: { id: string; name: string; emoji?: string | null; color: string } | null; systemRole?: string }) {
  if (customRole) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap"
        style={{
          backgroundColor: `${customRole.color}20`,
          color: customRole.color,
          borderColor: `${customRole.color}50`,
        }}
      >
        {customRole.emoji && <span>{customRole.emoji}</span>}
        {customRole.name}
      </span>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      {systemRole ?? "—"}
    </Badge>
  );
}

const SUB_STATUS_COLORS: Record<string, string> = {
  active:  "bg-green-500/10 text-green-600 border-green-200",
  expired: "bg-orange-500/10 text-orange-600 border-orange-200",
  none:    "bg-gray-500/10 text-gray-400 border-gray-100",
};

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOwner = currentUser?.role === "owner";

  const [search, setSearch] = useState("");
  const [customRoleFilter, setCustomRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [walletUser, setWalletUser] = useState<any>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletReason, setWalletReason] = useState("");
  const [confirmBan, setConfirmBan] = useState<{ user: any; ban: boolean } | null>(null);
  const [roleUser, setRoleUser] = useState<any>(null);
  const [newCustomRoleId, setNewCustomRoleId] = useState<string | null>(null);

  // ── Fetch dynamic custom roles ─────────────────────────────────────────────
  const { data: allCustomRoles = [] } = useQuery<any[]>({
    queryKey: ["admin-custom-roles"],
    queryFn: () => adminFetch("/admin/badge-roles"),
    staleTime: 60_000,
  });
  const activeCustomRoles = (allCustomRoles as any[]).filter((r) => r.isActive);

  // ── Users list ─────────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-users", search, customRoleFilter, page],
    queryFn: () =>
      adminFetch(
        `/users?search=${encodeURIComponent(search)}&customRoleId=${customRoleFilter !== "all" ? customRoleFilter : ""}&page=${page}&limit=15`,
      ),
    placeholderData: (prev) => prev,
  });

  const banMut = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) =>
      adminFetch(`/users/${id}/ban`, { method: "POST", body: JSON.stringify({ banned }) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: vars.banned ? "User dibanned" : "User diaktifkan kembali" });
      setConfirmBan(null);
    },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const customRoleMut = useMutation({
    mutationFn: ({ id, customRoleId }: { id: string; customRoleId: string | null }) =>
      adminFetch(`/users/${id}/custom-role`, {
        method: "PATCH",
        body: JSON.stringify({ customRoleId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Role berhasil diperbarui." });
      setRoleUser(null);
    },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const walletMut = useMutation({
    mutationFn: ({ id, delta, reason }: { id: string; delta: number; reason: string }) =>
      adminFetch(`/users/${id}/wallet`, { method: "PATCH", body: JSON.stringify({ delta, reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Wallet diperbarui" });
      setWalletUser(null);
      setWalletAmount("");
      setWalletReason("");
    },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const users: any[] = (data as any)?.data ?? [];
  const total: number = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  // Helper: open role dialog and set current role as pre-selected
  function openRoleDialog(u: any) {
    setRoleUser(u);
    setNewCustomRoleId(u.customRole?.id ?? null);
  }

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Manajemen Pengguna</h1>
              <p className="text-sm text-muted-foreground">{total} pengguna terdaftar</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari username atau email..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>

            {/* Dynamic role filter */}
            <Select
              value={customRoleFilter}
              onValueChange={(v) => { setCustomRoleFilter(v); setPage(1); }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Semua Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Role</SelectItem>
                {activeCustomRoles.map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.emoji ? `${r.emoji} ` : ""}{r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* Table */}
          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 text-left font-medium text-muted-foreground">Pengguna</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Email</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Role</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Wallet</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden xl:table-cell">Langganan</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden xl:table-cell">Kode Ref</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Daftar</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading
                    ? Array(8).fill(0).map((_, i) => (
                      <tr key={i}><td colSpan={9} className="p-3"><Skeleton className="h-10 w-full" /></td></tr>
                    ))
                    : users.length === 0
                    ? (
                      <tr><td colSpan={9} className="py-16 text-center text-muted-foreground">
                        <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p>Tidak ada pengguna</p>
                      </td></tr>
                    )
                    : users.map((u: any) => (
                      <tr key={u.id} className="hover:bg-muted/20">
                        <td className="p-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarImage src={u.avatar} />
                              <AvatarFallback className="text-xs">{u.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{u.username}</p>
                              <p className="text-xs text-muted-foreground">ID: {u.id?.slice(0, 8)}…</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground hidden md:table-cell text-xs">
                          {u.email ?? <span className="italic opacity-40">—</span>}
                        </td>
                        <td className="p-3">
                          <CustomRoleBadge customRole={u.customRole} systemRole={u.role} />
                        </td>
                        <td className="p-3 hidden lg:table-cell text-sm font-medium">{fmtRp(u.walletBalance)}</td>
                        <td className="p-3 hidden xl:table-cell">
                          {u.activeSubscription ? (
                            <Badge variant="default" className="text-xs">{u.activeSubscription.subscription?.name ?? "Aktif"}</Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className={`text-xs border ${SUB_STATUS_COLORS[u.subscriptionStatus ?? "none"]}`}
                            >
                              {u.subscriptionStatus ?? "none"}
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 hidden xl:table-cell">
                          {u.referralCode ? (
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                              {u.referralCode}
                            </code>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {u.isBanned ? (
                            <Badge variant="destructive" className="text-xs">Dibanned</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border border-green-200">Aktif</Badge>
                          )}
                        </td>
                        <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">{fmtDate(u.createdAt)}</td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1">
                            {isOwner && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Ubah Role"
                                  onClick={() => openRoleDialog(u)}>
                                  <Crown className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Atur Wallet"
                                  onClick={() => setWalletUser(u)}>
                                  <Wallet className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon"
                                  className={`h-7 w-7 ${u.isBanned ? "text-green-600" : "text-destructive"}`}
                                  title={u.isBanned ? "Aktifkan" : "Ban"}
                                  onClick={() => setConfirmBan({ user: u, ban: !u.isBanned })}
                                >
                                  {u.isBanned ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                                </Button>
                              </>
                            )}
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

        {/* ── Role Dialog ───────────────────────────────────────────────────── */}
        <Dialog open={!!roleUser} onOpenChange={(v) => !v && setRoleUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ubah Role: {roleUser?.username}</DialogTitle>
              <DialogDescription>
                Role saat ini:{" "}
                <strong>
                  {roleUser?.customRole
                    ? `${roleUser.customRole.emoji ?? ""} ${roleUser.customRole.name}`.trim()
                    : (roleUser?.role ?? "—")}
                </strong>
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 space-y-3">
              <Label className="block">Role Baru</Label>
              <Select
                value={newCustomRoleId ?? "__none__"}
                onValueChange={(v) => setNewCustomRoleId(v === "__none__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih custom role..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Tanpa custom role</span>
                  </SelectItem>
                  {activeCustomRoles.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-1.5">
                        {r.emoji && <span>{r.emoji}</span>}
                        <span>{r.name}</span>
                        {r.description && (
                          <span className="text-xs text-muted-foreground hidden sm:inline">— {r.description}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {activeCustomRoles.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Belum ada custom role aktif. Buat di halaman Badge & Role Management.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setRoleUser(null)}>Batal</Button>
              <Button
                onClick={() => customRoleMut.mutate({ id: roleUser.id, customRoleId: newCustomRoleId })}
                disabled={
                  customRoleMut.isPending ||
                  newCustomRoleId === (roleUser?.customRole?.id ?? null)
                }
              >
                {customRoleMut.isPending ? "Mengubah..." : "Ubah Role"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Wallet Dialog ──────────────────────────────────────────────────── */}
        <Dialog open={!!walletUser} onOpenChange={() => setWalletUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Atur Wallet: {walletUser?.username}</DialogTitle>
              <DialogDescription>
                Saldo saat ini: <strong>{fmtRp(walletUser?.walletBalance)}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Jumlah (positif = kredit, negatif = debit)</Label>
                <Input
                  type="number"
                  placeholder="Contoh: 50000 atau -20000"
                  value={walletAmount}
                  onChange={(e) => setWalletAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Alasan</Label>
                <Input
                  placeholder="Contoh: Bonus referral, koreksi manual"
                  value={walletReason}
                  onChange={(e) => setWalletReason(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWalletUser(null)}>Batal</Button>
              <Button
                onClick={() => walletMut.mutate({ id: walletUser.id, delta: parseFloat(walletAmount), reason: walletReason })}
                disabled={walletMut.isPending || !walletAmount || isNaN(parseFloat(walletAmount))}
              >
                {walletMut.isPending ? "Memperbarui..." : "Terapkan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Ban Confirm ────────────────────────────────────────────────────── */}
        <AlertDialog open={!!confirmBan} onOpenChange={() => setConfirmBan(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmBan?.ban ? "Ban User?" : "Aktifkan User?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmBan?.ban
                  ? `${confirmBan.user?.username} tidak akan bisa mengakses platform.`
                  : `${confirmBan?.user?.username} akan dapat mengakses platform kembali.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                className={confirmBan?.ban ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                onClick={() => confirmBan && banMut.mutate({ id: confirmBan.user.id, banned: confirmBan.ban })}
              >
                {confirmBan?.ban ? "Ya, Ban" : "Ya, Aktifkan"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
