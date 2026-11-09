import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDateTime } from "@/lib/admin-api";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Eye,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Download,
  Maximize2,
  ImageOff,
  AlertTriangle,
  Clock,
  QrCode,
  Upload,
  Trash2,
  Loader2,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────

const MANUAL_STATUS: Record<string, { label: string; class: string }> = {
  pending: { label: "Menunggu", class: "bg-amber-500/10 text-amber-600 border-amber-200" },
  paid: { label: "Disetujui", class: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
  confirmed: { label: "Disetujui", class: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
  rejected: { label: "Ditolak", class: "bg-rose-500/10 text-rose-600 border-rose-200" },
  denied: { label: "Ditolak", class: "bg-rose-500/10 text-rose-600 border-rose-200" },
};

export default function AdminPayments() {
  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2.5">
              <QrCode className="h-7 w-7 text-primary" /> Manajemen QRIS & Pembayaran Manual
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Kelola gambar QRIS aktif dan lakukan verifikasi persetujuan/penolakan top up pengguna secara manual.
            </p>
          </div>

          {/* ── QRIS Management Section ── */}
          <QrisManagementCard />

          {/* ── Payment Verification Table ── */}
          <ManualPaymentsSection />
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

// ─── QRIS Management Card ─────────────────────────────────────────────────────

function QrisManagementCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => adminFetch("/settings"),
  });

  const currentQrisUrl = (settings as any)?.qrisImage || null;

  const updateSettingsMut = useMutation({
    mutationFn: (newUrl: string | null) =>
      adminFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({ qrisImage: newUrl || "" }),
      }),
    onSuccess: (_, newUrl) => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["settings-qris"] });
      toast({
        title: newUrl ? "Gambar QRIS berhasil diperbarui" : "Gambar QRIS berhasil dihapus",
      });
      setDeleteAlertOpen(false);
    },
    onError: (e: any) =>
      toast({ title: "Gagal menyimpan QRIS", description: e.message, variant: "destructive" }),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({
        title: "Format tidak didukung",
        description: "Gunakan format JPG, PNG, atau WEBP.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Ukuran file terlalu besar",
        description: "Maksimal ukuran gambar adalah 10MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    const fd = new FormData();
    fd.append("image", file);
    fd.append("assetType", "qris");

    try {
      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.message || "Upload gagal");

      updateSettingsMut.mutate(data.url);
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Konfigurasi Gambar QRIS</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {currentQrisUrl ? "QRIS Aktif" : "Belum Ada QRIS"}
          </Badge>
        </div>
        <CardDescription>
          Gambar QRIS ini akan ditampilkan kepada seluruh pengguna saat melakukan Top Up Saldo.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        {isLoading ? (
          <Skeleton className="h-44 w-full rounded-xl" />
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* Preview Box */}
            <div className="relative group border-2 border-dashed border-border rounded-2xl p-4 bg-muted/10 w-56 h-56 flex flex-col items-center justify-center shrink-0 overflow-hidden">
              {currentQrisUrl ? (
                <>
                  <img
                    src={currentQrisUrl}
                    alt="Active QRIS"
                    className="w-full h-full object-contain rounded-lg"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full text-xs h-8 gap-1.5"
                      onClick={() => window.open(currentQrisUrl, "_blank")}
                    >
                      <Eye className="h-3.5 w-3.5" /> Lihat Ukuran Penuh
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      className="w-full text-xs h-8 gap-1.5"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      <Upload className="h-3.5 w-3.5" /> Ganti QRIS
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center p-4">
                  <QrCode className="h-12 w-12 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs font-medium text-muted-foreground">Belum ada QRIS aktif</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">Upload gambar untuk mengaktifkan</p>
                </div>
              )}
            </div>

            {/* Actions & Instructions */}
            <div className="space-y-4 flex-1 w-full">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Upload atau Ganti Gambar QRIS</h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Pastikan kode QRIS jelas dan dapat dipindai oleh semua aplikasi bank dan e-wallet (BCA, Mandiri, BRI, GoPay, OVO, Dana, ShopeePay, dll).
                  Format yang didukung: <strong>JPG, JPEG, PNG, WEBP</strong> (maks. 10MB).
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileUpload}
              />

              <div className="flex flex-wrap gap-2.5">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || updateSettingsMut.isPending}
                  className="gap-2 text-xs h-9"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {currentQrisUrl ? "Ganti Gambar QRIS" : "Upload Gambar QRIS"}
                </Button>

                {currentQrisUrl && (
                  <Button
                    variant="outline"
                    className="gap-2 text-xs h-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteAlertOpen(true)}
                    disabled={uploading || updateSettingsMut.isPending}
                  >
                    <Trash2 className="h-4 w-4" /> Hapus QRIS
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* Delete confirmation alert */}
      <AlertDialog open={deleteAlertOpen} onOpenChange={setDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Gambar QRIS Aktif?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini akan menghapus QRIS aktif. Pengguna tidak akan melihat gambar QRIS saat melakukan top up sampai Anda mengupload gambar baru.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => updateSettingsMut.mutate(null)}
            >
              Ya, Hapus QRIS
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── Manual payments table ────────────────────────────────────────────────────

function ManualPaymentsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [viewPayment, setViewPayment] = useState<any | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    action: "confirm" | "deny";
    user: string;
    amount: number;
  } | null>(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-payments-manual", statusFilter, page],
    queryFn: () =>
      adminFetch(
        `/topups/all?${statusFilter !== "all" ? `status=${statusFilter}&` : ""}page=${page}&limit=15`,
      ),
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const confirmMut = useMutation({
    mutationFn: (id: string) => adminFetch(`/topups/${id}/confirm`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-payments-manual"] });
      toast({ title: "Pembayaran berhasil disetujui ✅", description: "Saldo pengguna telah ditambahkan." });
      setConfirmAction(null);
    },
    onError: (e: any) =>
      toast({ title: "Gagal menyetujui pembayaran", description: e.message, variant: "destructive" }),
  });

  const denyMut = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/topups/${id}/deny`, {
        method: "PATCH",
        body: JSON.stringify({ note: "Bukti pembayaran tidak sesuai atau tidak valid." }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-payments-manual"] });
      toast({ title: "Pembayaran berhasil ditolak", description: "Saldo pengguna tidak berubah." });
      setConfirmAction(null);
    },
    onError: (e: any) =>
      toast({ title: "Gagal menolak pembayaran", description: e.message, variant: "destructive" }),
  });

  const rawPayments = (data as any)?.data;
  const payments = Array.isArray(rawPayments) ? rawPayments : [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 15);
  const pending = payments.filter((p: any) => p.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Daftar Verifikasi Top Up</h2>
        <div className="flex flex-wrap items-center gap-2">
          {["all", "pending", "paid", "rejected"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className="text-xs h-8"
            >
              {s === "all" ? "Semua" : MANUAL_STATUS[s]?.label ?? s}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="gap-1.5 h-8 text-xs ml-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {pending > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-200 px-4 py-3 text-sm">
          <Clock className="h-4 w-4 text-amber-600" />
          <span className="text-amber-800 font-medium">
            Terdapat <strong>{pending}</strong> permintaan top up yang menunggu verifikasi Anda.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="p-3.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Transaction ID
                </th>
                <th className="p-3.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Pengguna
                </th>
                <th className="p-3.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Nominal
                </th>
                <th className="p-3.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Bukti Pembayaran
                </th>
                <th className="p-3.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Status
                </th>
                <th className="p-3.5 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">
                  Waktu Diajukan
                </th>
                <th className="p-3.5 text-center font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading ? (
                Array(6)
                  .fill(0)
                  .map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="p-3">
                        <Skeleton className="h-10 w-full" />
                      </td>
                    </tr>
                  ))
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <AlertTriangle className="h-8 w-8 text-destructive opacity-70" />
                      <p className="font-medium">Data gagal dimuat</p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        {(error as any)?.message}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 gap-1.5"
                        onClick={() => refetch()}
                        disabled={isRefetching}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />{" "}
                        Coba Lagi
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-muted-foreground">
                    <QrCode className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p>Tidak ada data transaksi top up</p>
                  </td>
                </tr>
              ) : (
                payments.map((p: any) => (
                  <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                    <td className="p-3.5 font-mono text-xs text-muted-foreground">
                      #{p.id?.slice(0, 8)}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarImage src={p.user?.avatar} />
                          <AvatarFallback className="text-xs">
                            {p.user?.username?.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold text-sm">{p.user?.username ?? "—"}</p>
                          <p className="font-mono text-[10px] text-muted-foreground truncate max-w-[120px]">
                            {p.userId}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5 font-extrabold text-emerald-600">{fmtRp(p.amount)}</td>
                    <td className="p-3.5">
                      {p.paymentProof ? (
                        <div className="flex items-center gap-2">
                          <img
                            src={p.paymentProof}
                            alt="Proof thumbnail"
                            className="h-8 w-8 object-cover rounded border cursor-pointer hover:opacity-80 transition"
                            onClick={() => {
                              setViewPayment(p);
                              setImageZoom(1);
                              setImageFailed(false);
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 h-7 text-xs text-primary"
                            onClick={() => {
                              setViewPayment(p);
                              setImageZoom(1);
                              setImageFailed(false);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" /> Lihat Bukti
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">Tanpa bukti</span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <Badge className={`border text-xs ${MANUAL_STATUS[p.status]?.class ?? ""}`}>
                        {MANUAL_STATUS[p.status]?.label ?? p.status}
                      </Badge>
                    </td>
                    <td className="p-3.5 hidden md:table-cell text-muted-foreground text-xs">
                      {fmtDateTime(p.createdAt)}
                    </td>
                    <td className="p-3.5">
                      {p.status === "pending" ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                            onClick={() =>
                              setConfirmAction({
                                id: p.id,
                                action: "confirm",
                                user: p.user?.username ?? "Pengguna",
                                amount: p.amount,
                              })
                            }
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Setujui</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10 text-xs"
                            onClick={() =>
                              setConfirmAction({
                                id: p.id,
                                action: "deny",
                                user: p.user?.username ?? "Pengguna",
                                amount: p.amount,
                              })
                            }
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Tolak</span>
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center text-xs text-muted-foreground">
                          {p.status === "paid" || p.status === "confirmed" ? "Selesai" : "Ditolak"}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Halaman {page} dari {totalPages} ({total} total transaksi)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Proof Image Viewer Modal ── */}
      <Dialog open={!!viewPayment} onOpenChange={() => setViewPayment(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Bukti Pembayaran #{viewPayment?.id?.slice(0, 8)}</DialogTitle>
          </DialogHeader>
          {viewPayment && (
            <div className="space-y-4">
              {/* Payment info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm bg-muted/40 rounded-xl p-3 border">
                <div>
                  <p className="text-muted-foreground text-xs">Pengguna</p>
                  <p className="font-semibold">{viewPayment.user?.username ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Waktu Diajukan</p>
                  <p className="font-medium">{fmtDateTime(viewPayment.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Nominal Transfer</p>
                  <p className="font-bold text-emerald-600">{fmtRp(viewPayment.amount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Status</p>
                  <Badge className={`border text-xs ${MANUAL_STATUS[viewPayment.status]?.class ?? ""}`}>
                    {MANUAL_STATUS[viewPayment.status]?.label ?? viewPayment.status}
                  </Badge>
                </div>
              </div>

              {/* Proof image */}
              <div className="relative bg-black/5 rounded-xl overflow-hidden flex items-center justify-center min-h-[260px] border">
                {viewPayment.paymentProof && !imageFailed ? (
                  <div className="overflow-auto max-h-[440px] w-full flex items-center justify-center p-2">
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
                  </div>
                )}
              </div>

              {/* Image controls */}
              {viewPayment.paymentProof && !imageFailed && (
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setImageZoom((z) => Math.max(0.5, z - 0.25))}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setImageZoom((z) => Math.min(3, z + 0.25))}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => window.open(viewPayment.paymentProof, "_blank")}
                  >
                    <Maximize2 className="h-3.5 w-3.5" /> Layar Penuh
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" asChild>
                    <a href={viewPayment.paymentProof} download target="_blank" rel="noreferrer">
                      <Download className="h-3.5 w-3.5" /> Unduh
                    </a>
                  </Button>
                </div>
              )}

              {/* Action buttons inside viewer */}
              {viewPayment.status === "pending" && (
                <div className="flex gap-2 pt-3 border-t">
                  <Button
                    className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => {
                      setConfirmAction({
                        id: viewPayment.id,
                        action: "confirm",
                        user: viewPayment.user?.username ?? "Pengguna",
                        amount: viewPayment.amount,
                      });
                      setViewPayment(null);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Setujui Pembayaran
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 gap-1.5"
                    onClick={() => {
                      setConfirmAction({
                        id: viewPayment.id,
                        action: "deny",
                        user: viewPayment.user?.username ?? "Pengguna",
                        amount: viewPayment.amount,
                      });
                      setViewPayment(null);
                    }}
                  >
                    <XCircle className="h-4 w-4" /> Tolak Pembayaran
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Confirm/Deny Dialog with Confirmation ── */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.action === "confirm" ? "Konfirmasi Persetujuan Pembayaran" : "Konfirmasi Penolakan"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === "confirm"
                ? `Apakah Anda yakin ingin menyetujui top up ${fmtRp(confirmAction.amount)} untuk ${confirmAction.user}? Saldo pengguna akan langsung bertambah dan riwayat transaksi dicatat.`
                : `Apakah Anda yakin ingin menolak top up ${fmtRp(confirmAction?.amount ?? 0)} dari ${confirmAction?.user}? Saldo tidak akan ditambahkan.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmAction?.action === "deny"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }
              onClick={() => {
                if (!confirmAction) return;
                if (confirmAction.action === "confirm") confirmMut.mutate(confirmAction.id);
                else denyMut.mutate(confirmAction.id);
              }}
            >
              {confirmAction?.action === "confirm" ? "Ya, Setujui & Tambah Saldo" : "Ya, Tolak Pembayaran"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
