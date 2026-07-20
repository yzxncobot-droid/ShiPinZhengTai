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
import {
  Search, CheckCircle2, Crown, Trash2, History, Plus, ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { VerificationBadge } from "@/components/ui/VerificationBadge";
import { format } from "date-fns";

interface Verification {
  id: string;
  userId: string;
  username: string;
  avatar?: string;
  badgeType: string;
  status: string;
  verifiedAt: string;
  revokedAt?: string;
  reason?: string;
}

interface SearchUser {
  id: string;
  username: string;
  avatar?: string;
  role: string;
  verificationBadge?: string | null;
}

interface HistoryEntry {
  id: string;
  action: string;
  badgeType?: string;
  note?: string;
  createdAt: string;
  targetUsername: string;
  targetId: string;
}

const BADGE_OPTIONS = [
  { value: "blue", label: "✓ Blue Verified", desc: "For official creators" },
  { value: "gold", label: "✓ Gold Verified", desc: "For official brands / partners" },
];

const BADGE_COLOR: Record<string, string> = {
  blue:    "bg-blue-100 text-blue-700 border-blue-200",
  gold:    "bg-amber-100 text-amber-700 border-amber-200",
  sulthan: "bg-gradient-to-r from-yellow-100 to-amber-100 text-amber-800 border-amber-200",
};

const ACTION_COLOR: Record<string, string> = {
  granted:         "text-green-600",
  revoked:         "text-red-600",
  sulthan_granted: "text-amber-600",
  sulthan_removed: "text-slate-500",
};

function Avatar({ username, avatar }: { username: string; avatar?: string }) {
  return avatar
    ? <img src={avatar} alt={username} className="h-9 w-9 rounded-full object-cover" />
    : <div className="h-9 w-9 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm">{username[0]?.toUpperCase()}</div>;
}

export default function AdminVerificationsPage() {
  const qc = useQueryClient();
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [badgeType, setBadgeType] = useState("blue");
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<Verification | null>(null);

  // Fetch all verified users
  const { data: verifications = [], isLoading } = useQuery({
    queryKey: ["verifications"],
    queryFn: () => adminFetch<Verification[]>("/verifications"),
    refetchInterval: 15000,
  });

  // Fetch verification history
  const { data: history = [] } = useQuery({
    queryKey: ["verification-history"],
    queryFn: () => adminFetch<HistoryEntry[]>("/verifications/history"),
    enabled: showHistory,
  });

  const assignMutation = useMutation({
    mutationFn: ({ userId, badgeType, reason }: { userId: string; badgeType: string; reason: string }) =>
      adminFetch("/verifications", { method: "POST", body: JSON.stringify({ userId, badgeType, reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["verifications"] });
      setAssignOpen(false);
      setSelectedUser(null);
      setReason("");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFetch(`/verifications/${id}/revoke`, { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["verifications"] });
      setConfirmRevoke(null);
    },
  });

  const searchUsers = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const results = await adminFetch<SearchUser[]>(`/verifications/search-users?q=${encodeURIComponent(searchQ)}`);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  };

  const activeVerifications = verifications.filter((v) => v.status === "active");

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="h-7 w-7 text-blue-500" />
              Verifikasi Creator
            </h1>
            <p className="text-sm text-slate-500 mt-1">Kelola badge verifikasi untuk kreator dan brand</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-4 w-4 mr-1.5" />
              {showHistory ? "Sembunyikan" : "Riwayat"}
            </Button>
            <Button size="sm" onClick={() => setAssignOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Assign Badge
            </Button>
          </div>
        </div>

        {/* Active Verifications */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between">
            <h2 className="font-extrabold text-slate-800">Badge Aktif ({activeVerifications.length})</h2>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : activeVerifications.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="h-10 w-10 text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 font-medium">Belum ada kreator terverifikasi</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {activeVerifications.map((v) => (
                <div key={v.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/50 transition-colors">
                  <Avatar username={v.username} avatar={v.avatar} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-800 text-sm">{v.username}</span>
                      <VerificationBadge verificationBadge={v.badgeType} size="sm" />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 px-1.5 ${BADGE_COLOR[v.badgeType] ?? ""}`}
                      >
                        {v.badgeType === "sulthan" ? "👑 Sulthan" : v.badgeType === "gold" ? "✓ Gold" : "✓ Blue"}
                      </Badge>
                      {v.reason && (
                        <span className="text-[11px] text-slate-400 truncate max-w-[200px]">{v.reason}</span>
                      )}
                      <span className="text-[10px] text-slate-300">
                        {format(new Date(v.verifiedAt), "d MMM yyyy")}
                      </span>
                    </div>
                  </div>
                  {v.badgeType !== "sulthan" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:bg-red-50 hover:text-red-600 h-8 px-2.5"
                      onClick={() => setConfirmRevoke(v)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Cabut
                    </Button>
                  )}
                  {v.badgeType === "sulthan" && (
                    <span className="text-[10px] text-amber-500 font-bold bg-amber-50 px-2 py-0.5 rounded-full">Auto</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History */}
        {showHistory && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-50">
              <h2 className="font-extrabold text-slate-800">Riwayat Verifikasi</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {history.length === 0 ? (
                <p className="py-8 text-center text-slate-400 text-sm">Belum ada riwayat</p>
              ) : history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className={`font-bold ${ACTION_COLOR[h.action] ?? "text-slate-600"}`}>
                    {h.action === "granted" ? "✓ Assigned" :
                     h.action === "revoked" ? "✗ Revoked" :
                     h.action === "sulthan_granted" ? "👑 Sulthan Granted" :
                     h.action === "sulthan_removed" ? "👑 Sulthan Removed" : h.action}
                  </div>
                  <span className="font-semibold text-slate-700">{h.targetUsername}</span>
                  {h.badgeType && (
                    <Badge variant="outline" className={`text-[10px] h-4 px-1 ${BADGE_COLOR[h.badgeType] ?? ""}`}>
                      {h.badgeType}
                    </Badge>
                  )}
                  {h.note && <span className="text-slate-400 truncate flex-1">{h.note}</span>}
                  <span className="text-slate-300 text-[10px] shrink-0">
                    {format(new Date(h.createdAt), "d MMM yyyy HH:mm")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Assign Badge Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-blue-500" />
              Assign Badge Verifikasi
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Search user */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Cari Pengguna</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Masukkan username..."
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchUsers()}
                  className="flex-1"
                />
                <Button variant="outline" onClick={searchUsers} disabled={searching}>
                  {searching ? <div className="h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {searchResults.length > 0 && (
                <div className="border rounded-xl overflow-hidden">
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => { setSelectedUser(u); setSearchResults([]); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors ${selectedUser?.id === u.id ? "bg-purple-50" : ""}`}
                    >
                      <Avatar username={u.username} avatar={u.avatar} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm">{u.username}</span>
                          <VerificationBadge verificationBadge={u.verificationBadge} size="xs" />
                        </div>
                        <span className="text-[11px] text-slate-400">{u.role}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedUser && (
              <>
                <div className="flex items-center gap-3 bg-purple-50 rounded-xl p-3">
                  <Avatar username={selectedUser.username} avatar={selectedUser.avatar} />
                  <div>
                    <p className="font-bold text-sm">{selectedUser.username}</p>
                    <p className="text-xs text-slate-500">{selectedUser.role}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Tipe Badge</label>
                  <Select value={badgeType} onValueChange={setBadgeType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BADGE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <VerificationBadge verificationBadge={opt.value} size="sm" showTooltip={false} />
                            <div>
                              <p className="font-medium text-sm">{opt.label}</p>
                              <p className="text-xs text-slate-400">{opt.desc}</p>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Alasan (opsional)</label>
                  <Textarea
                    placeholder="Mis: Official partner, top content creator..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignOpen(false); setSelectedUser(null); }}>
              Batal
            </Button>
            <Button
              disabled={!selectedUser || assignMutation.isPending}
              onClick={() => selectedUser && assignMutation.mutate({ userId: selectedUser.id, badgeType, reason })}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {assignMutation.isPending ? "Menyimpan..." : "Assign Badge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation */}
      <Dialog open={!!confirmRevoke} onOpenChange={() => setConfirmRevoke(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Cabut Badge?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Yakin ingin mencabut badge <strong>{confirmRevoke?.badgeType}</strong> dari{" "}
            <strong>{confirmRevoke?.username}</strong>?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={revokeMutation.isPending}
              onClick={() => confirmRevoke && revokeMutation.mutate({ id: confirmRevoke.id, reason: "Revoked by owner" })}
            >
              {revokeMutation.isPending ? "Mencabut..." : "Ya, Cabut"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
