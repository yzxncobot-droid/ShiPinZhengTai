import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminFetch, fmtDateTime } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Gift,
  Plus,
  Loader2,
  Search,
  Pencil,
  Trash2,
  Copy,
  Download,
  ToggleLeft,
  ToggleRight,
  Eye,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Coins,
  Star,
  Package,
  BadgeCheck,
  Ticket,
  Users,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RedeemCode {
  id: string;
  code: string;
  rewardType: string;
  rewardValue: number;
  rewardName: string;
  description?: string | null;
  maxUse: number;
  usedCount: number;
  expiresAt?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RedeemCodePage {
  data: RedeemCode[];
  total: number;
  page: number;
  limit: number;
}

interface HistoryRow {
  id: string;
  userId: string;
  username: string;
  avatar?: string;
  status: string;
  claimedReward?: string;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REWARD_TYPES = [
  { value: "coin", label: "🪙 Koin" },
  { value: "wallet_balance", label: "💰 Saldo Wallet" },
  { value: "bundle", label: "📦 Bundle" },
  { value: "premium_membership", label: "⭐ Premium Membership" },
  { value: "video_unlock", label: "🎬 Video Unlock" },
  { value: "badge", label: "🏅 Badge" },
  { value: "coupon", label: "🎟️ Kupon" },
  { value: "discount", label: "💸 Diskon" },
  { value: "custom", label: "🎁 Custom" },
];

const REWARD_ICONS: Record<string, React.ReactNode> = {
  coin: <Coins className="w-4 h-4 text-yellow-500" />,
  wallet_balance: <Coins className="w-4 h-4 text-green-500" />,
  bundle: <Package className="w-4 h-4 text-blue-500" />,
  premium_membership: <Star className="w-4 h-4 text-purple-500" />,
  video_unlock: <BadgeCheck className="w-4 h-4 text-pink-500" />,
  badge: <BadgeCheck className="w-4 h-4 text-orange-500" />,
  coupon: <Ticket className="w-4 h-4 text-teal-500" />,
  discount: <Ticket className="w-4 h-4 text-indigo-500" />,
  custom: <Gift className="w-4 h-4 text-violet-500" />,
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  success: { label: "Berhasil", className: "bg-green-100 text-green-700 border-green-200" },
  expired: { label: "Kedaluwarsa", className: "bg-slate-100 text-slate-500 border-slate-200" },
  used: { label: "Sudah Dipakai", className: "bg-orange-100 text-orange-600 border-orange-200" },
  not_found: { label: "Tidak Ditemukan", className: "bg-red-100 text-red-600 border-red-200" },
  not_active: { label: "Belum Aktif", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  limit_reached: { label: "Habis", className: "bg-red-100 text-red-600 border-red-200" },
  pending: { label: "Pending", className: "bg-blue-100 text-blue-700 border-blue-200" },
};

const EXAMPLE_CODES = [
  { code: "WELCOMEFUN", rewardType: "coin", rewardValue: 10000, rewardName: "10000 Koin" },
  { code: "FUNPLUS100", rewardType: "premium_membership", rewardValue: 30, rewardName: "Premium 30 Hari" },
  { code: "BUNDLE2025", rewardType: "bundle", rewardValue: 1, rewardName: "Bundle Anak" },
  { code: "BADGEVIP", rewardType: "badge", rewardValue: 1, rewardName: "Exclusive VIP Badge" },
  { code: "TOPUP5000", rewardType: "wallet_balance", rewardValue: 5000, rewardName: "Saldo Rp5.000" },
];

// ── Form blank ────────────────────────────────────────────────────────────────

const BLANK_FORM = {
  code: "",
  rewardType: "coin",
  rewardValue: "",
  rewardName: "",
  description: "",
  maxUse: "1",
  expiresAt: "",
  isActive: true,
};

function toDatetimeLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(codes: RedeemCode[]) {
  const header = ["Code", "Reward Name", "Reward Type", "Value", "Used", "Max Use", "Active", "Expires At", "Created At"];
  const rows = codes.map((c) => [
    c.code,
    c.rewardName,
    c.rewardType,
    c.rewardValue,
    c.usedCount,
    c.maxUse || "∞",
    c.isActive ? "Yes" : "No",
    c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("id-ID") : "-",
    new Date(c.createdAt).toLocaleDateString("id-ID"),
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `redeem-codes-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminRedeemPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RedeemCode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RedeemCode | null>(null);
  const [historyTarget, setHistoryTarget] = useState<RedeemCode | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const setF = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data, isLoading, refetch } = useQuery<RedeemCodePage>({
    queryKey: ["admin-redeem", search, page],
    queryFn: () =>
      adminFetch(`/admin/redeem?search=${encodeURIComponent(search)}&page=${page}&limit=20`),
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<HistoryRow[]>({
    queryKey: ["admin-redeem-history", historyTarget?.id],
    queryFn: () => adminFetch(`/admin/redeem/${historyTarget!.id}/history`),
    enabled: !!historyTarget,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: typeof BLANK_FORM) =>
      adminFetch("/admin/redeem", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          rewardValue: parseFloat(body.rewardValue) || 0,
          maxUse: parseInt(body.maxUse) || 1,
          expiresAt: body.expiresAt || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Kode berhasil dibuat!");
      qc.invalidateQueries({ queryKey: ["admin-redeem"] });
      setCreateOpen(false);
      setForm({ ...BLANK_FORM });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: typeof BLANK_FORM }) =>
      adminFetch(`/admin/redeem/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...body,
          rewardValue: parseFloat(body.rewardValue) || 0,
          maxUse: parseInt(body.maxUse) || 1,
          expiresAt: body.expiresAt || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Kode berhasil diperbarui!");
      qc.invalidateQueries({ queryKey: ["admin-redeem"] });
      setEditTarget(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/admin/redeem/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Kode dihapus.");
      qc.invalidateQueries({ queryKey: ["admin-redeem"] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminFetch(`/admin/redeem/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.isActive ? "Kode diaktifkan." : "Kode dinonaktifkan.");
      qc.invalidateQueries({ queryKey: ["admin-redeem"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function openEdit(rc: RedeemCode) {
    setForm({
      code: rc.code,
      rewardType: rc.rewardType,
      rewardValue: String(rc.rewardValue),
      rewardName: rc.rewardName,
      description: rc.description ?? "",
      maxUse: String(rc.maxUse),
      expiresAt: toDatetimeLocal(rc.expiresAt),
      isActive: rc.isActive,
    });
    setEditTarget(rc);
  }

  function openDuplicate(rc: RedeemCode) {
    setForm({
      code: rc.code + "_2",
      rewardType: rc.rewardType,
      rewardValue: String(rc.rewardValue),
      rewardName: rc.rewardName,
      description: rc.description ?? "",
      maxUse: String(rc.maxUse),
      expiresAt: toDatetimeLocal(rc.expiresAt),
      isActive: rc.isActive,
    });
    setCreateOpen(true);
  }

  const codes = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  // ── Code form shared UI ───────────────────────────────────────────────────────

  function CodeForm({ onSubmit, pending }: { onSubmit: () => void; pending: boolean }) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>Kode *</Label>
            <div className="flex gap-2">
              <Input
                value={form.code}
                onChange={(e) => setF("code", e.target.value.toUpperCase())}
                placeholder="WELCOMEFUN"
                className="font-mono tracking-widest uppercase"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
                  setF("code", `FUN${rand}`);
                }}
                className="shrink-0"
              >
                Generate
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Tipe Reward *</Label>
            <Select value={form.rewardType} onValueChange={(v) => setF("rewardType", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REWARD_TYPES.map((rt) => (
                  <SelectItem key={rt.value} value={rt.value}>
                    {rt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Nilai Reward *</Label>
            <Input
              type="number"
              min={0}
              value={form.rewardValue}
              onChange={(e) => setF("rewardValue", e.target.value)}
              placeholder="10000"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Nama Reward *</Label>
            <Input
              value={form.rewardName}
              onChange={(e) => setF("rewardName", e.target.value)}
              placeholder="10.000 Koin"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Deskripsi</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setF("description", e.target.value)}
              placeholder="Kode eksklusif untuk member baru..."
              rows={2}
            />
          </div>
          <div className="space-y-1">
            <Label>Maks. Penggunaan</Label>
            <Input
              type="number"
              min={1}
              value={form.maxUse}
              onChange={(e) => setF("maxUse", e.target.value)}
              placeholder="1"
            />
          </div>
          <div className="space-y-1">
            <Label>Tanggal Kedaluwarsa</Label>
            <Input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setF("expiresAt", e.target.value)}
            />
          </div>
          <div className="col-span-2 flex items-center gap-3">
            <Label>Status Aktif</Label>
            <button
              type="button"
              onClick={() => setF("isActive", !form.isActive)}
              className="text-purple-600"
            >
              {form.isActive ? (
                <ToggleRight className="w-8 h-8" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-slate-400" />
              )}
            </button>
            <span className="text-sm text-slate-500">
              {form.isActive ? "Aktif" : "Nonaktif"}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={onSubmit}
            disabled={pending || !form.code.trim() || !form.rewardName.trim()}
            className="rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-extrabold hover:opacity-90 w-full"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
              <Gift className="w-6 h-6 text-purple-500" />
              Manajemen Kode Redeem
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Buat, kelola, dan pantau kode redeem untuk pengguna KIDZOO
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(codes)}
              className="rounded-xl border-slate-200 font-bold gap-1.5"
              disabled={codes.length === 0}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setForm({ ...BLANK_FORM });
                setCreateOpen(true);
              }}
              className="rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-extrabold hover:opacity-90 gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Buat Kode
            </Button>
          </div>
        </div>

        {/* Quick example codes */}
        <div className="rounded-2xl border border-dashed border-purple-200 bg-purple-50/50 p-4">
          <p className="text-xs font-extrabold text-purple-600 uppercase tracking-wider mb-3">
            Contoh Kode Cepat
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_CODES.map((ex) => (
              <button
                key={ex.code}
                onClick={() => {
                  setForm({
                    ...BLANK_FORM,
                    code: ex.code,
                    rewardType: ex.rewardType,
                    rewardValue: String(ex.rewardValue),
                    rewardName: ex.rewardName,
                  });
                  setCreateOpen(true);
                }}
                className="px-3 py-1.5 rounded-full bg-white border border-purple-200 text-xs font-bold text-purple-700 hover:bg-purple-100 transition-colors"
              >
                {ex.code}
              </button>
            ))}
          </div>
        </div>

        {/* Search + stats */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari kode atau nama reward..."
              className="pl-9 rounded-xl"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            className="rounded-xl shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <span className="text-sm text-slate-500 font-medium shrink-0">
            {total} kode
          </span>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : codes.length === 0 ? (
            <div className="text-center py-16">
              <Gift className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">Belum ada kode redeem</p>
              <p className="text-slate-300 text-sm">Buat kode pertama kamu!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-3 font-extrabold text-slate-500 text-xs uppercase tracking-wider">
                      Kode
                    </th>
                    <th className="text-left px-4 py-3 font-extrabold text-slate-500 text-xs uppercase tracking-wider">
                      Reward
                    </th>
                    <th className="text-left px-4 py-3 font-extrabold text-slate-500 text-xs uppercase tracking-wider hidden md:table-cell">
                      Penggunaan
                    </th>
                    <th className="text-left px-4 py-3 font-extrabold text-slate-500 text-xs uppercase tracking-wider hidden lg:table-cell">
                      Kedaluwarsa
                    </th>
                    <th className="text-left px-4 py-3 font-extrabold text-slate-500 text-xs uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {codes.map((rc) => {
                    const isExpired = rc.expiresAt && new Date(rc.expiresAt) < new Date();
                    const isFull = rc.maxUse > 0 && rc.usedCount >= rc.maxUse;
                    return (
                      <tr key={rc.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-extrabold text-slate-800 tracking-wider">
                              {rc.code}
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(rc.code);
                                toast.success("Kode disalin!");
                              }}
                              className="text-slate-300 hover:text-purple-500"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {REWARD_ICONS[rc.rewardType] ?? <Gift className="w-4 h-4" />}
                            <div>
                              <p className="font-bold text-slate-700 text-xs">{rc.rewardName}</p>
                              <p className="text-[10px] text-slate-400">
                                {REWARD_TYPES.find((r) => r.value === rc.rewardType)?.label ?? rc.rewardType}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                            <span className={`text-xs font-bold ${isFull ? "text-red-500" : "text-slate-600"}`}>
                              {rc.usedCount}/{rc.maxUse === 0 ? "∞" : rc.maxUse}
                            </span>
                            {isFull && (
                              <Badge className="text-[10px] px-1 py-0 bg-red-100 text-red-600 border-red-200">
                                Habis
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className={`text-xs ${isExpired ? "text-red-500 font-bold" : "text-slate-500"}`}>
                            {rc.expiresAt
                              ? fmtDateTime(rc.expiresAt)
                              : <span className="text-slate-300">Tidak ada</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={`text-[10px] border ${
                              rc.isActive && !isExpired && !isFull
                                ? "bg-green-100 text-green-700 border-green-200"
                                : isExpired
                                ? "bg-slate-100 text-slate-500 border-slate-200"
                                : isFull
                                ? "bg-red-100 text-red-600 border-red-200"
                                : "bg-yellow-100 text-yellow-700 border-yellow-200"
                            }`}
                          >
                            {rc.isActive && !isExpired && !isFull
                              ? "Aktif"
                              : isExpired
                              ? "Kedaluwarsa"
                              : isFull
                              ? "Habis"
                              : "Nonaktif"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => setHistoryTarget(rc)}
                              title="Lihat Riwayat"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-purple-600"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => toggleMutation.mutate({ id: rc.id, isActive: !rc.isActive })}
                              title={rc.isActive ? "Nonaktifkan" : "Aktifkan"}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-yellow-600"
                            >
                              {rc.isActive ? (
                                <ToggleRight className="w-4 h-4 text-green-500" />
                              ) : (
                                <ToggleLeft className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={() => openDuplicate(rc)}
                              title="Duplikat"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-blue-600"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openEdit(rc)}
                              title="Edit"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-purple-600"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(rc)}
                              title="Hapus"
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-xl"
              >
                Sebelumnya
              </Button>
              <span className="text-sm text-slate-500">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-xl"
              >
                Berikutnya
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold flex items-center gap-2">
              <Plus className="w-5 h-5 text-purple-500" /> Buat Kode Redeem
            </DialogTitle>
          </DialogHeader>
          <CodeForm
            onSubmit={() => createMutation.mutate(form)}
            pending={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold flex items-center gap-2">
              <Pencil className="w-5 h-5 text-purple-500" /> Edit Kode Redeem
            </DialogTitle>
          </DialogHeader>
          {editTarget && (
            <CodeForm
              onSubmit={() => updateMutation.mutate({ id: editTarget.id, body: form })}
              pending={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold text-red-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Hapus Kode?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-slate-600 text-sm">
              Kode{" "}
              <span className="font-mono font-extrabold text-slate-800">
                {deleteTarget?.code}
              </span>{" "}
              akan dihapus permanen beserta riwayat penggunaannya. Tindakan ini tidak
              dapat dibatalkan.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => setDeleteTarget(null)}
              >
                Batal
              </Button>
              <Button
                className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white font-extrabold"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Hapus"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── History Dialog ── */}
      <Dialog open={!!historyTarget} onOpenChange={() => setHistoryTarget(null)}>
        <DialogContent className="max-w-lg rounded-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-extrabold flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-500" />
              Riwayat — {historyTarget?.code}
            </DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Belum ada pengguna yang memakai kode ini</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((h) => {
                const sc = STATUS_BADGE[h.status] ?? STATUS_BADGE.pending;
                return (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100"
                  >
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-extrabold text-purple-600 shrink-0">
                      {h.username?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-700">{h.username}</p>
                      <p className="text-xs text-slate-400">{fmtDateTime(h.createdAt)}</p>
                    </div>
                    <Badge className={`text-[10px] border ${sc.className}`}>
                      {sc.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
