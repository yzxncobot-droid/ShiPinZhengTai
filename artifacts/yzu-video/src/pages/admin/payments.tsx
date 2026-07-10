import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDateTime } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Eye, CreditCard, RefreshCw, Clock, Copy, ZoomIn, ZoomOut, Download, Maximize2, ImageOff } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  pending: { label: "Menunggu", class: "bg-yellow-500/10 text-yellow-600 border-yellow-200" },
  confirmed: { label: "Dikonfirmasi", class: "bg-green-500/10 text-green-600 border-green-200" },
  denied: { label: "Ditolak", class: "bg-red-500/10 text-red-600 border-red-200" },
};

export default function AdminPayments() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [viewPayment, setViewPayment] = useState<any | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ id: number; action: "confirm" | "deny"; user: string; amount: number } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-payments", statusFilter, page],
    queryFn: () => adminFetch(`/topups/all?${statusFilter !== "all" ? `status=${statusFilter}&` : ""}page=${page}&limit=15`),
    placeholderData: (prev) => prev,
  });

  const confirmMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/topups/${id}/confirm`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-payments"] }); toast({ title: "Pembayaran dikonfirmasi" }); setConfirmAction(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const denyMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/topups/${id}/deny`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-payments"] }); toast({ title: "Pembayaran ditolak" }); setConfirmAction(null); },
    onError: (e: any) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const payments = (data as any)?.data ?? [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 15);
  const pending = payments.filter((p: any) => p.status === "pending").length;

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Manajemen Pembayaran</h1>
              <p className="text-sm text-muted-foreground">{total} pembayaran · {pending} menunggu konfirmasi</p>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-4">
            {["pending", "confirmed", "denied"].map((s) => {
              const count = payments.filter((p: any) => p.status === s).length;
              const cfg = STATUS_CONFIG[s];
              return (
                <button key={s} onClick={() => setStatusFilter(s === statusFilter ? "all" : s)}
                  className={`p-4 rounded-xl border text-left transition-all ${statusFilter === s ? "ring-2 ring-primary" : "hover:bg-muted/30"} bg-card`}>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-sm text-muted-foreground">{cfg.label}</p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="pending">Menunggu</SelectItem>
                <SelectItem value="confirmed">Dikonfirmasi</SelectItem>
                <SelectItem value="denied">Ditolak</SelectItem>
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
                    <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Bukti</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Waktu</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading
                    ? Array(6).fill(0).map((_, i) => <tr key={i}><td colSpan={7} className="p-3"><Skeleton className="h-10 w-full" /></td></tr>)
                    : payments.length === 0
                    ? (
                      <tr><td colSpan={7} className="py-16 text-center text-muted-foreground">
                        <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p>Tidak ada pembayaran</p>
                      </td></tr>
                    )
                    : payments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="p-3 text-muted-foreground font-mono text-xs">#{p.id}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarImage src={p.user?.avatar} />
                              <AvatarFallback className="text-xs">{p.user?.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">{p.user?.username ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">{p.user?.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 font-bold text-green-600">{fmtRp(p.amount)}</td>
                        <td className="p-3">
                          <Badge className={`border text-xs ${STATUS_CONFIG[p.status]?.class ?? ""}`}>
                            {STATUS_CONFIG[p.status]?.label ?? p.status}
                          </Badge>
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          {p.paymentProof ? (
                            <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={() => { setViewPayment(p); setImageZoom(1); setImageFailed(false); }}>
                              <Eye className="h-3 w-3" />Lihat
                            </Button>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">{fmtDateTime(p.createdAt)}</td>
                        <td className="p-3">
                          {p.status === "pending" && (
                            <div className="flex items-center justify-center gap-1">
                              <Button size="sm" variant="ghost" className="h-7 gap-1 text-green-600 hover:bg-green-500/10"
                                onClick={() => setConfirmAction({ id: p.id, action: "confirm", user: p.user?.username, amount: p.amount })}>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:block text-xs">Konfirmasi</span>
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive hover:bg-red-500/10"
                                onClick={() => setConfirmAction({ id: p.id, action: "deny", user: p.user?.username, amount: p.amount })}>
                                <XCircle className="h-3.5 w-3.5" />
                                <span className="hidden sm:block text-xs">Tolak</span>
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

        {/* Proof Image Dialog */}
        <Dialog open={!!viewPayment} onOpenChange={() => setViewPayment(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Bukti Pembayaran #{viewPayment?.id}</DialogTitle></DialogHeader>
            {viewPayment && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm bg-muted/30 rounded-lg p-3">
                  <div><p className="text-muted-foreground text-xs">Pengguna</p><p className="font-medium">{viewPayment.user?.username ?? "—"}</p></div>
                  <div><p className="text-muted-foreground text-xs">Email</p><p className="font-medium truncate">{viewPayment.user?.email ?? "—"}</p></div>
                  <div><p className="text-muted-foreground text-xs">Nominal</p><p className="font-bold text-green-600">{fmtRp(viewPayment.amount)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Waktu</p><p className="font-medium">{fmtDateTime(viewPayment.createdAt)}</p></div>
                  <div className="col-span-2">
                    <Badge className={`border text-xs ${STATUS_CONFIG[viewPayment.status]?.class ?? ""}`}>
                      {STATUS_CONFIG[viewPayment.status]?.label ?? viewPayment.status}
                    </Badge>
                  </div>
                </div>

                <div className="relative bg-black/5 rounded-lg overflow-hidden flex items-center justify-center min-h-[240px]">
                  {viewPayment.paymentProof && !imageFailed ? (
                    <div className="overflow-auto max-h-[420px] w-full flex items-center justify-center p-2">
                      <img
                        src={viewPayment.paymentProof}
                        alt="Bukti transfer"
                        style={{ transform: `scale(${imageZoom})`, transition: "transform 0.15s ease" }}
                        className="max-w-full rounded-md"
                        onError={() => setImageFailed(true)}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                      <ImageOff className="h-10 w-10 opacity-40" />
                      <p className="text-sm font-medium">Gagal memuat bukti transfer</p>
                      <p className="text-xs">Gambar tidak ditemukan atau URL tidak valid.</p>
                    </div>
                  )}
                </div>

                {viewPayment.paymentProof && !imageFailed && (
                  <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut className="h-4 w-4" /></Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}><ZoomIn className="h-4 w-4" /></Button>
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => window.open(viewPayment.paymentProof, "_blank")}>
                      <Maximize2 className="h-3.5 w-3.5" />Layar Penuh
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" asChild>
                      <a href={viewPayment.paymentProof} download target="_blank" rel="noreferrer">
                        <Download className="h-3.5 w-3.5" />Unduh
                      </a>
                    </Button>
                  </div>
                )}

                {viewPayment.status === "pending" && (
                  <div className="flex gap-2 pt-2 border-t">
                    <Button className="flex-1 gap-1 bg-green-600 hover:bg-green-700" onClick={() => { setConfirmAction({ id: viewPayment.id, action: "confirm", user: viewPayment.user?.username, amount: viewPayment.amount }); setViewPayment(null); }}>
                      <CheckCircle2 className="h-4 w-4" />Konfirmasi
                    </Button>
                    <Button variant="destructive" className="flex-1 gap-1" onClick={() => { setConfirmAction({ id: viewPayment.id, action: "deny", user: viewPayment.user?.username, amount: viewPayment.amount }); setViewPayment(null); }}>
                      <XCircle className="h-4 w-4" />Tolak
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Confirm Dialog */}
        <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmAction?.action === "confirm" ? "Konfirmasi Pembayaran?" : "Tolak Pembayaran?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmAction?.action === "confirm"
                  ? `Saldo ${confirmAction.user} akan ditambah ${fmtRp(confirmAction?.amount)}.`
                  : `Pembayaran ${fmtRp(confirmAction?.amount)} dari ${confirmAction?.user} akan ditolak.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                className={confirmAction?.action === "deny" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                onClick={() => {
                  if (!confirmAction) return;
                  if (confirmAction.action === "confirm") confirmMut.mutate(confirmAction.id);
                  else denyMut.mutate(confirmAction.id);
                }}
              >
                {confirmAction?.action === "confirm" ? "Ya, Konfirmasi" : "Ya, Tolak"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AdminLayout>
    </ProtectedRoute>
  );
}
