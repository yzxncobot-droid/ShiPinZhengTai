import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDateTime } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, ArrowUpFromLine, RefreshCw } from "lucide-react";

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending: { label: "Menunggu", cls: "bg-yellow-500/10 text-yellow-600 border-yellow-200" },
  approved: { label: "Disetujui", cls: "bg-green-500/10 text-green-600 border-green-200" },
  rejected: { label: "Ditolak", cls: "bg-red-500/10 text-red-600 border-red-200" },
  processing: { label: "Diproses", cls: "bg-blue-500/10 text-blue-600 border-blue-200" },
  completed: { label: "Selesai", cls: "bg-gray-500/10 text-gray-600 border-gray-200" },
};

export default function AdminWithdrawals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [rejectDialog, setRejectDialog] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-withdrawals", statusFilter, page],
    queryFn: () => adminFetch(`/withdrawals/all?${statusFilter !== "all" ? `status=${statusFilter}&` : ""}page=${page}&limit=15`),
    placeholderData: (prev) => prev,
  });

  const approveMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/withdrawals/${id}/approve`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-withdrawals"] }); toast({ title: "Penarikan disetujui dan saldo dipotong" }); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      adminFetch(`/withdrawals/${id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-withdrawals"] }); toast({ title: "Penarikan ditolak" }); setRejectDialog(null); setRejectReason(""); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const withdrawals = (data as any)?.data ?? [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Manajemen Penarikan</h1>
              <p className="text-sm text-muted-foreground">{total} permintaan penarikan</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </div>

          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 text-left font-medium text-muted-foreground">ID</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Pengguna</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Nominal</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Metode</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Rekening</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden xl:table-cell">Waktu</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading
                    ? Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={8} className="p-3"><Skeleton className="h-10 w-full" /></td></tr>)
                    : withdrawals.length === 0
                    ? (
                      <tr><td colSpan={8} className="py-16 text-center text-muted-foreground">
                        <ArrowUpFromLine className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p>Tidak ada permintaan penarikan</p>
                      </td></tr>
                    )
                    : withdrawals.map((w: any) => (
                      <tr key={w.id} className="hover:bg-muted/20">
                        <td className="p-3 font-mono text-xs text-muted-foreground">#{w.id}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarImage src={w.user?.avatar} />
                              <AvatarFallback className="text-xs">{w.user?.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{w.user?.username ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">{w.user?.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 font-bold text-orange-600">{fmtRp(w.amount)}</td>
                        <td className="p-3 hidden md:table-cell text-muted-foreground capitalize">{w.method ?? "bank"}</td>
                        <td className="p-3 hidden lg:table-cell">
                          <div>
                            <p className="text-sm font-medium">{w.accountName ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{w.bankName ?? ""} {w.accountNumber ?? ""}</p>
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge className={`border text-xs ${STATUS_CFG[w.status]?.cls ?? ""}`}>{STATUS_CFG[w.status]?.label ?? w.status}</Badge>
                        </td>
                        <td className="p-3 hidden xl:table-cell text-muted-foreground text-xs">{fmtDateTime(w.createdAt)}</td>
                        <td className="p-3">
                          {w.status === "pending" && (
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Setujui"
                                onClick={() => approveMut.mutate(w.id)} disabled={approveMut.isPending}>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Tolak"
                                onClick={() => setRejectDialog(w)}>
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Halaman {page} dari {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </div>

        <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tolak Penarikan</DialogTitle>
              <DialogDescription>Penarikan {fmtRp(rejectDialog?.amount)} dari {rejectDialog?.user?.username}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label>Alasan Penolakan (opsional)</Label>
              <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Rekening tidak valid, dll." />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectDialog(null)}>Batal</Button>
              <Button variant="destructive" onClick={() => rejectMut.mutate({ id: rejectDialog.id, reason: rejectReason })} disabled={rejectMut.isPending}>
                {rejectMut.isPending ? "Menolak..." : "Tolak Penarikan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
