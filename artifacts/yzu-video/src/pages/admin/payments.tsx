import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDateTime } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, Eye, CreditCard,
  RefreshCw, ZoomIn, ZoomOut, Download, Maximize2, ImageOff, AlertTriangle,
  ShieldCheck, ShieldX, Zap, Clock,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────

const AUTO_STATUS: Record<string, { label: string; class: string }> = {
  pending:   { label: "Pending",      class: "bg-yellow-500/10 text-yellow-600 border-yellow-200" },
  paid:      { label: "Paid",         class: "bg-green-500/10 text-green-600 border-green-200" },
  confirmed: { label: "Paid",         class: "bg-green-500/10 text-green-600 border-green-200" },
  expired:   { label: "Expired",      class: "bg-red-500/10 text-red-600 border-red-200" },
  failed:    { label: "Failed",       class: "bg-red-500/10 text-red-600 border-red-200" },
  cancelled: { label: "Cancelled",   class: "bg-slate-500/10 text-slate-600 border-slate-200" },
};

const MANUAL_STATUS: Record<string, { label: string; class: string }> = {
  pending:   { label: "Menunggu",      class: "bg-yellow-500/10 text-yellow-600 border-yellow-200" },
  paid:      { label: "Dibayar",       class: "bg-green-500/10 text-green-600 border-green-200" },
  confirmed: { label: "Dibayar",      class: "bg-green-500/10 text-green-600 border-green-200" },
  rejected:  { label: "Ditolak",      class: "bg-red-500/10 text-red-600 border-red-200" },
  denied:    { label: "Ditolak",      class: "bg-red-500/10 text-red-600 border-red-200" },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPayments() {
  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
          <div>
            <h1 className="text-2xl font-bold">Manajemen Pembayaran</h1>
            <p className="text-sm text-muted-foreground">
              Kelola pembayaran otomatis (BuatQris) dan manual.
            </p>
          </div>

          <Tabs defaultValue="automatic">
            <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
              <TabsTrigger value="automatic" className="gap-1.5">
                <Zap className="h-4 w-4" /> Otomatis
              </TabsTrigger>
              <TabsTrigger value="manual" className="gap-1.5">
                <CreditCard className="h-4 w-4" /> Manual
              </TabsTrigger>
            </TabsList>

            <TabsContent value="automatic">
              <AutomaticPaymentsTab />
            </TabsContent>

            <TabsContent value="manual">
              <ManualPaymentsTab />
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

// ─── Automatic payments tab ───────────────────────────────────────────────────

function AutomaticPaymentsTab() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-payments-automatic", statusFilter, page],
    queryFn: () => adminFetch(
      `/topups/all?payment_method=automatic&${statusFilter !== "all" ? `status=${statusFilter}&` : ""}page=${page}&limit=15`,
    ),
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const rawPayments = (data as any)?.data;
  const payments = Array.isArray(rawPayments) ? rawPayments : [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {["all", "pending", "paid", "expired", "failed"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s === "all" ? "Semua" : AUTO_STATUS[s]?.label ?? s}
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-1.5 ml-auto">
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="p-3 text-left font-medium text-muted-foreground">Order ID</th>
                <th className="p-3 text-left font-medium text-muted-foreground">User</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Amount</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Provider</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Transaction ID</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Created</th>
                <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Paid At</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading
                ? Array(6).fill(0).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="p-3"><Skeleton className="h-10 w-full" /></td></tr>
                ))
                : isError
                ? (
                  <tr><td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <AlertTriangle className="h-8 w-8 text-destructive opacity-70" />
                      <p className="font-medium">Data gagal dimuat</p>
                      <p className="text-xs text-muted-foreground max-w-sm">{(error as any)?.message}</p>
                      <Button size="sm" variant="outline" className="mt-1 gap-1.5" onClick={() => refetch()} disabled={isRefetching}>
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} /> Coba Lagi
                      </Button>
                    </div>
                  </td></tr>
                )
                : payments.length === 0
                ? (
                  <tr><td colSpan={8} className="py-16 text-center text-muted-foreground">
                    <Zap className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p>Tidak ada pembayaran otomatis</p>
                  </td></tr>
                )
                : payments.map((p: any) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="p-3 font-mono text-xs">{p.orderId ?? "—"}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarImage src={p.user?.avatar} />
                          <AvatarFallback className="text-xs">{p.user?.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <p className="font-medium text-sm">{p.user?.username ?? "—"}</p>
                      </div>
                    </td>
                    <td className="p-3 font-bold text-green-600">{fmtRp(p.amount)}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{p.provider ?? "buatqris"}</Badge>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{p.providerTransactionId ?? "—"}</td>
                    <td className="p-3">
                      <Badge className={`border text-xs ${AUTO_STATUS[p.status]?.class ?? ""}`}>
                        {AUTO_STATUS[p.status]?.label ?? p.status}
                      </Badge>
                    </td>
                    <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">{fmtDateTime(p.createdAt)}</td>
                    <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">{p.paidAt ? fmtDateTime(p.paidAt) : "—"}</td>
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
          <p className="text-sm text-muted-foreground">Halaman {page} dari {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" />
        Pembayaran otomatis dikonfirmasi via webhook BuatQris. Tidak ada konfirmasi manual.
      </p>
    </div>
  );
}

// ─── Manual payments tab ──────────────────────────────────────────────────────

function ManualPaymentsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [viewPayment, setViewPayment] = useState<any | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ id: string; action: "confirm" | "deny"; user: string; amount: number } | null>(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-payments-manual", statusFilter, page],
    queryFn: () => adminFetch(
      `/topups/all?payment_method=manual&${statusFilter !== "all" ? `status=${statusFilter}&` : ""}page=${page}&limit=15`,
    ),
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const confirmMut = useMutation({
    mutationFn: (id: string) => adminFetch(`/topups/${id}/confirm`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-payments-manual"] }); toast({ title: "Pembayaran dikonfirmasi ✅" }); setConfirmAction(null); },
    onError: (e: any) => toast({ title: "Gagal konfirmasi", description: e.message, variant: "destructive" }),
  });

  const denyMut = useMutation({
    mutationFn: (id: string) => adminFetch(`/topups/${id}/deny`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-payments-manual"] }); toast({ title: "Pembayaran ditolak" }); setConfirmAction(null); },
    onError: (e: any) => toast({ title: "Gagal tolak", description: e.message, variant: "destructive" }),
  });

  const rawPayments = (data as any)?.data;
  const payments = Array.isArray(rawPayments) ? rawPayments : [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 15);
  const pending = payments.filter((p: any) => p.status === "pending").length;

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {["all", "pending", "paid", "rejected"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s === "all" ? "Semua" : MANUAL_STATUS[s]?.label ?? s}
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-1.5 ml-auto">
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {pending > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-2 text-sm">
          <Clock className="h-4 w-4 text-yellow-600" />
          <span className="text-yellow-700 font-medium">{pending} pembayaran menunggu verifikasi</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="p-3 text-left font-medium text-muted-foreground">Order ID</th>
                <th className="p-3 text-left font-medium text-muted-foreground">User</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Amount</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Bukti</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Tanggal</th>
                <th className="p-3 text-center font-medium text-muted-foreground">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading
                ? Array(6).fill(0).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="p-3"><Skeleton className="h-10 w-full" /></td></tr>
                ))
                : isError
                ? (
                  <tr><td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <AlertTriangle className="h-8 w-8 text-destructive opacity-70" />
                      <p className="font-medium">Data gagal dimuat</p>
                      <p className="text-xs text-muted-foreground max-w-sm">{(error as any)?.message}</p>
                      <Button size="sm" variant="outline" className="mt-1 gap-1.5" onClick={() => refetch()} disabled={isRefetching}>
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} /> Coba Lagi
                      </Button>
                    </div>
                  </td></tr>
                )
                : payments.length === 0
                ? (
                  <tr><td colSpan={7} className="py-16 text-center text-muted-foreground">
                    <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p>Tidak ada pembayaran manual</p>
                  </td></tr>
                )
                : payments.map((p: any) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="p-3 font-mono text-xs text-muted-foreground">#{p.id?.slice(0, 8)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarImage src={p.user?.avatar} />
                          <AvatarFallback className="text-xs">{p.user?.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <p className="font-medium text-sm">{p.user?.username ?? "—"}</p>
                      </div>
                    </td>
                    <td className="p-3 font-bold text-green-600">{fmtRp(p.amount)}</td>
                    <td className="p-3">
                      {p.paymentProof ? (
                        <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs"
                          onClick={() => { setViewPayment(p); setImageZoom(1); setImageFailed(false); }}>
                          <Eye className="h-3 w-3" /> Lihat
                        </Button>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="p-3">
                      <Badge className={`border text-xs ${MANUAL_STATUS[p.status]?.class ?? ""}`}>
                        {MANUAL_STATUS[p.status]?.label ?? p.status}
                      </Badge>
                    </td>
                    <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">{fmtDateTime(p.createdAt)}</td>
                    <td className="p-3">
                      {p.status === "pending" && (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 gap-1 text-green-600 hover:bg-green-500/10"
                            onClick={() => setConfirmAction({ id: p.id, action: "confirm", user: p.user?.username, amount: p.amount })}
                          >
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Halaman {page} dari {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Proof Image Dialog ── */}
      <Dialog open={!!viewPayment} onOpenChange={() => setViewPayment(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bukti Pembayaran #{viewPayment?.id?.slice(0, 8)}</DialogTitle>
          </DialogHeader>
          {viewPayment && (
            <div className="space-y-4">
              {/* Payment info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm bg-muted/30 rounded-lg p-3">
                <div>
                  <p className="text-muted-foreground text-xs">Pengguna</p>
                  <p className="font-medium">{viewPayment.user?.username ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Waktu</p>
                  <p className="font-medium">{fmtDateTime(viewPayment.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Nominal</p>
                  <p className="font-bold text-green-600">{fmtRp(viewPayment.amount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Status</p>
                  <Badge className={`border text-xs ${MANUAL_STATUS[viewPayment.status]?.class ?? ""}`}>
                    {MANUAL_STATUS[viewPayment.status]?.label ?? viewPayment.status}
                  </Badge>
                </div>
              </div>

              {/* Proof image */}
              <div className="relative bg-black/5 rounded-lg overflow-hidden flex items-center justify-center min-h-[240px]">
                {viewPayment.paymentProof && !imageFailed ? (
                  <div className="overflow-auto max-h-[420px] w-full flex items-center justify-center p-2">
                    <img
                      src={viewPayment.paymentProof} alt="Bukti transfer"
                      style={{ transform: `scale(${imageZoom})`, transition: "transform 0.15s ease" }}
                      className="max-w-full rounded-md"
                      onError={() => setImageFailed(true)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                    <ImageOff className="h-10 w-10 opacity-40" />
                    <p className="text-sm font-medium">Gagal memuat bukti transfer</p>
                  </div>
                )}
              </div>

              {/* Image controls */}
              {viewPayment.paymentProof && !imageFailed && (
                <div className="flex items-center justify-center gap-2">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setImageZoom(z => Math.max(0.5, z - 0.25))}><ZoomOut className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setImageZoom(z => Math.min(3, z + 0.25))}><ZoomIn className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => window.open(viewPayment.paymentProof, "_blank")}>
                    <Maximize2 className="h-3.5 w-3.5" /> Layar Penuh
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" asChild>
                    <a href={viewPayment.paymentProof} download target="_blank" rel="noreferrer">
                      <Download className="h-3.5 w-3.5" /> Unduh
                    </a>
                  </Button>
                </div>
              )}

              {/* Action buttons */}
              {viewPayment.status === "pending" && (
                <div className="flex gap-2 pt-2 border-t">
                  <Button className="flex-1 gap-1 bg-green-600 hover:bg-green-700"
                    onClick={() => { setConfirmAction({ id: viewPayment.id, action: "confirm", user: viewPayment.user?.username, amount: viewPayment.amount }); setViewPayment(null); }}>
                    <CheckCircle2 className="h-4 w-4" /> Konfirmasi
                  </Button>
                  <Button variant="destructive" className="flex-1 gap-1"
                    onClick={() => { setConfirmAction({ id: viewPayment.id, action: "deny", user: viewPayment.user?.username, amount: viewPayment.amount }); setViewPayment(null); }}>
                    <XCircle className="h-4 w-4" /> Tolak
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Confirm/Deny Alert ── */}
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
    </div>
  );
}
