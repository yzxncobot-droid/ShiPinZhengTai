import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminFetch } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Gift, Plus, Loader2, Users, XCircle, Eye, Coins, Star,
  Ticket, Zap, Package, BadgeCheck, AlertTriangle, Clock, CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";

interface Drop {
  id: string;
  title: string;
  description?: string;
  rewardType: string;
  rewardValue: string;
  rewardAmount?: number | null;
  maxWinners: number;
  currentClaims: number;
  claimCount?: number;
  startTime: string;
  endTime: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  buttonColor: string;
  createdAt: string;
}

interface Claim {
  id: string;
  userId: string;
  username: string;
  avatar?: string;
  claimedAt: string;
  rewardGranted: boolean;
  rewardDetails?: string;
}

const REWARD_TYPES = [
  { value: "wallet_balance", label: "💰 Saldo Wallet", icon: Coins },
  { value: "coins", label: "🪙 Koin", icon: Coins },
  { value: "premium_subscription", label: "⭐ Langganan Premium", icon: Star },
  { value: "premium_video", label: "🎬 Video Premium", icon: BadgeCheck },
  { value: "bundle", label: "📦 Bundle", icon: Package },
  { value: "coupon", label: "🎟️ Kupon", icon: Ticket },
  { value: "redeem_code", label: "🔑 Kode Redeem", icon: Ticket },
  { value: "xp", label: "⚡ XP", icon: Zap },
  { value: "badge", label: "🏅 Badge", icon: BadgeCheck },
  { value: "custom", label: "🎁 Hadiah Custom", icon: Gift },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Terjadwal", className: "bg-blue-100 text-blue-700 border-blue-200" },
  active:    { label: "Aktif",     className: "bg-green-100 text-green-700 border-green-200" },
  completed: { label: "Selesai",   className: "bg-slate-100 text-slate-600 border-slate-200" },
  cancelled: { label: "Dibatalkan", className: "bg-red-100 text-red-600 border-red-200" },
};

function toLocalDatetimeInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function nowPlusMinutes(n: number) {
  return toLocalDatetimeInput(new Date(Date.now() + n * 60000).toISOString());
}

export default function AdminDropsPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [claimsDropId, setClaimsDropId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<Drop | null>(null);

  // Form state
  const [form, setForm] = useState({
    title: "",
    description: "",
    rewardType: "wallet_balance",
    rewardValue: "",
    rewardAmount: "",
    maxWinners: "100",
    startTime: nowPlusMinutes(0),
    endTime: nowPlusMinutes(60),
    buttonColor: "#8b5cf6",
  });

  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const { data: drops = [], isLoading } = useQuery({
    queryKey: ["admin-drops"],
    queryFn: () => adminFetch<Drop[]>("/drops"),
    refetchInterval: 5000,
  });

  const { data: claims = [] } = useQuery({
    queryKey: ["drop-claims", claimsDropId],
    queryFn: () => adminFetch<Claim[]>(`/drops/${claimsDropId}/claims`),
    enabled: !!claimsDropId,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => adminFetch("/drops", {
      method: "POST",
      body: JSON.stringify({
        ...data,
        rewardAmount: data.rewardAmount ? parseFloat(data.rewardAmount) : null,
        maxWinners: parseInt(data.maxWinners),
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-drops"] });
      setCreateOpen(false);
      setForm({
        title: "", description: "", rewardType: "wallet_balance",
        rewardValue: "", rewardAmount: "", maxWinners: "100",
        startTime: nowPlusMinutes(0), endTime: nowPlusMinutes(60), buttonColor: "#8b5cf6",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => adminFetch(`/drops/${id}/cancel`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-drops"] }); setConfirmCancel(null); },
  });

  const activeDrop = drops.find((d) => d.status === "active");

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Gift className="h-7 w-7 text-purple-500" />
              Drop System
            </h1>
            <p className="text-sm text-slate-500 mt-1">Buat dan kelola drop reward di Public Chat</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-purple-600 hover:bg-purple-700 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            Buat Drop
          </Button>
        </div>

        {/* Active drop highlight */}
        {activeDrop && (
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-4 text-white shadow-lg shadow-purple-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider opacity-80">🔴 LIVE DROP</p>
                <p className="text-xl font-extrabold mt-0.5">{activeDrop.title}</p>
                <p className="text-sm opacity-80 mt-0.5">
                  {activeDrop.currentClaims} / {activeDrop.maxWinners} diklaim
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm opacity-80">Berakhir</p>
                <p className="text-sm font-bold">{format(new Date(activeDrop.endTime), "HH:mm, d MMM")}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setConfirmCancel(activeDrop)}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Batalkan
                </Button>
              </div>
            </div>
            <div className="mt-3 h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all"
                style={{ width: `${Math.min(100, (activeDrop.currentClaims / activeDrop.maxWinners) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* All Drops Table */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-50">
            <h2 className="font-extrabold text-slate-800">Semua Drop ({drops.length})</h2>
          </div>
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : drops.length === 0 ? (
            <div className="py-16 text-center">
              <Gift className="h-10 w-10 text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 font-medium">Belum ada drop</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {drops.map((drop) => {
                const st = STATUS_BADGE[drop.status];
                const progress = drop.maxWinners > 0 ? drop.currentClaims / drop.maxWinners : 0;
                return (
                  <div key={drop.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/50 transition-colors">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${drop.buttonColor}22` }}
                    >
                      <Gift className="h-5 w-5" style={{ color: drop.buttonColor }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 text-sm truncate">{drop.title}</span>
                        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 shrink-0 ${st.className}`}>
                          {st.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-slate-400">{drop.rewardType}</span>
                        <span className="text-[11px] text-slate-400">
                          {drop.currentClaims}/{drop.maxWinners} klaim
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {format(new Date(drop.startTime), "d MMM HH:mm")}
                        </span>
                      </div>
                      {drop.status === "active" && (
                        <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden w-32">
                          <div className="h-full bg-purple-500 rounded-full" style={{ width: `${progress * 100}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5 text-slate-500"
                        onClick={() => setClaimsDropId(drop.id)}
                      >
                        <Users className="h-3.5 w-3.5 mr-1" />
                        {drop.claimCount ?? drop.currentClaims}
                      </Button>
                      {(drop.status === "active" || drop.status === "scheduled") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => setConfirmCancel(drop)}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Create Drop Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-purple-500" />
              Buat Drop Baru
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-1.5">
              <Label>Judul Drop *</Label>
              <Input placeholder="100K Coins untuk semua!" value={form.title} onChange={(e) => setF("title", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Deskripsi</Label>
              <Textarea placeholder="Keterangan drop..." value={form.description} onChange={(e) => setF("description", e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Tipe Reward *</Label>
                <Select value={form.rewardType} onValueChange={(v) => setF("rewardType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REWARD_TYPES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Nilai Reward *</Label>
                <Input
                  placeholder={form.rewardType === "premium_subscription" ? "30 (hari)" : "50000"}
                  value={form.rewardValue}
                  onChange={(e) => setF("rewardValue", e.target.value)}
                />
              </div>
            </div>
            {(form.rewardType === "wallet_balance" || form.rewardType === "coins") && (
              <div className="grid gap-1.5">
                <Label>Jumlah Numerik</Label>
                <Input type="number" placeholder="50000" value={form.rewardAmount} onChange={(e) => setF("rewardAmount", e.target.value)} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Maks. Pemenang</Label>
              <Input type="number" value={form.maxWinners} onChange={(e) => setF("maxWinners", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Mulai *</Label>
                <Input type="datetime-local" value={form.startTime} onChange={(e) => setF("startTime", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Berakhir *</Label>
                <Input type="datetime-local" value={form.endTime} onChange={(e) => setF("endTime", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Warna Tombol</Label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.buttonColor} onChange={(e) => setF("buttonColor", e.target.value)} className="h-10 w-16 rounded cursor-pointer border" />
                <Input value={form.buttonColor} onChange={(e) => setF("buttonColor", e.target.value)} className="flex-1" />
              </div>
            </div>
            {createMutation.isError && (
              <p className="text-sm text-red-500">{(createMutation.error as any)?.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button
              disabled={!form.title || !form.rewardValue || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Membuat...</> : "Buat Drop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Claims Modal */}
      <Dialog open={!!claimsDropId} onOpenChange={() => setClaimsDropId(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Daftar Klaim</DialogTitle>
          </DialogHeader>
          {claims.length === 0 ? (
            <p className="text-center text-slate-400 py-8">Belum ada klaim</p>
          ) : (
            <div className="divide-y divide-slate-50 -mx-6">
              {claims.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 px-6 py-2.5">
                  <span className="text-xs font-bold text-slate-400 w-5 text-right">{i + 1}</span>
                  {c.avatar
                    ? <img src={c.avatar} className="h-8 w-8 rounded-full object-cover" />
                    : <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-xs">{c.username[0]?.toUpperCase()}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{c.username}</p>
                    <p className="text-[10px] text-slate-400">{format(new Date(c.claimedAt), "d MMM HH:mm:ss")}</p>
                  </div>
                  {c.rewardGranted
                    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                  }
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Confirm */}
      <Dialog open={!!confirmCancel} onOpenChange={() => setConfirmCancel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Batalkan Drop?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Drop <strong>{confirmCancel?.title}</strong> akan dibatalkan dan tidak bisa diklaim lagi.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => confirmCancel && cancelMutation.mutate(confirmCancel.id)}
            >
              {cancelMutation.isPending ? "Membatalkan..." : "Ya, Batalkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
