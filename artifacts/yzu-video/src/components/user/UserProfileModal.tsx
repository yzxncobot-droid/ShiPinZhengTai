/**
 * UserProfileModal
 * Opens when clicking a username in chat or anywhere in the app.
 * Owner sees full management panel.
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { adminFetch, fmtDate, fmtRp } from "@/lib/admin-api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import {
  Crown, ShieldCheck, Star, Wallet, BadgeCheck, Ban, Volume2,
  VolumeX, RotateCcw, LogOut, ChevronDown, Plus, Trash2,
  Calendar, AlertTriangle, Loader2, Clock, Check, X,
} from "lucide-react";

// ── Badge config ──────────────────────────────────────────────────────────────

const BADGES: Record<string, { label: string; color: string; icon: string }> = {
  verified:       { label: "Verified",        color: "#3b82f6", icon: "✓" },
  developer:      { label: "Developer",       color: "#8b5cf6", icon: "⚡" },
  staff:          { label: "Staff",           color: "#6366f1", icon: "🛡️" },
  owner:          { label: "Owner",           color: "#f59e0b", icon: "👑" },
  admin:          { label: "Admin",           color: "#ef4444", icon: "🔴" },
  moderator:      { label: "Moderator",       color: "#10b981", icon: "🟢" },
  creator:        { label: "Creator",         color: "#f97316", icon: "✨" },
  vip:            { label: "VIP",             color: "#ec4899", icon: "💎" },
  premium:        { label: "Premium",         color: "#f59e0b", icon: "⭐" },
  official:       { label: "Official",        color: "#0ea5e9", icon: "🏅" },
  early_supporter:{ label: "Early Supporter", color: "#84cc16", icon: "🌱" },
  beta_tester:    { label: "Beta Tester",     color: "#a78bfa", icon: "🔬" },
  custom:         { label: "Custom",          color: "#64748b", icon: "🏷️" },
};

const ROLES = [
  { value: "owner",            label: "Owner",            color: "text-amber-600" },
  { value: "admin",            label: "Admin",            color: "text-red-600" },
  { value: "moderator",        label: "Moderator",        color: "text-green-600" },
  { value: "verified_creator", label: "Verified Creator", color: "text-blue-600" },
  { value: "meril",            label: "User",             color: "text-slate-600" },
];

const MUTE_PRESETS = [
  { label: "1 Hour",    seconds: 3600 },
  { label: "24 Hours",  seconds: 86400 },
  { label: "7 Days",    seconds: 604800 },
  { label: "Permanent", seconds: null },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Badge {
  id: string;
  badge: string;
  label?: string;
  color?: string;
  assignedAt: string;
}

interface Ban {
  id: string;
  banType: string;
  reason?: string;
  expiresAt?: string;
  createdAt: string;
}

interface Mute {
  id: string;
  reason?: string;
  expiresAt?: string;
  createdAt: string;
}

interface PublicUser {
  id: string;
  username: string;
  displayName?: string;
  bio?: string;
  banner?: string;
  avatar?: string;
  role: string;
  verificationBadge?: string;
  subscriptionStatus: string;
  createdAt: string;
  isBanned: boolean;
  walletBalance?: number;
  badges: Badge[];
  activeBan?: Ban | null;
  activeMute?: Mute | null;
}

interface WalletTx {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

interface Props {
  userId: string;
  open: boolean;
  onClose: () => void;
}

// ── Badge display ─────────────────────────────────────────────────────────────

function BadgePill({ badge, label, color }: { badge: string; label?: string; color?: string }) {
  const conf = BADGES[badge] ?? { label: badge, color: "#64748b", icon: "🏷️" };
  const displayLabel = label || conf.label;
  const displayColor = color || conf.color;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
      style={{ backgroundColor: displayColor }}
    >
      {conf.icon} {displayLabel}
    </span>
  );
}

function RolePill({ role }: { role: string }) {
  const conf = ROLES.find(r => r.value === role) ?? { label: role, color: "text-slate-500" };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 ${conf.color}`}>
      {conf.label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function UserProfileModal({ userId, open, onClose }: Props) {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const isOwner = me?.role === "owner";

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  // Management state
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletMode, setWalletMode] = useState<"add" | "reduce" | "set">("add");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletReason, setWalletReason] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);

  const [selectedRole, setSelectedRole] = useState("");
  const [roleLoading, setRoleLoading] = useState(false);

  const [selectedBadge, setSelectedBadge] = useState("");
  const [customBadgeLabel, setCustomBadgeLabel] = useState("");
  const [badgeLoading, setBadgeLoading] = useState(false);

  const [banType, setBanType] = useState<"permanent" | "temporary">("permanent");
  const [banReason, setBanReason] = useState("");
  const [banExpiry, setBanExpiry] = useState("");
  const [banLoading, setBanLoading] = useState(false);

  const [mutePreset, setMutePreset] = useState<number | null>(3600);
  const [muteReason, setMuteReason] = useState("");
  const [muteLoading, setMuteLoading] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    adminFetch<PublicUser>(`/users/${userId}/public`)
      .then(data => {
        setProfile(data);
        setSelectedRole(data.role);
        setWalletBalance(data.walletBalance ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, userId]);

  const loadWalletHistory = async () => {
    if (!isOwner) return;
    try {
      const { transactions, balance } = await adminFetch<{ transactions: WalletTx[]; balance: number }>(
        `/users/${userId}/wallet-history`
      );
      setWalletTxs(transactions);
      setWalletBalance(balance);
    } catch {}
  };

  const refreshProfile = () => {
    adminFetch<PublicUser>(`/users/${userId}/public`)
      .then(data => { setProfile(data); setSelectedRole(data.role); setWalletBalance(data.walletBalance ?? 0); })
      .catch(() => {});
  };

  const handleRoleChange = async () => {
    if (!selectedRole || selectedRole === profile?.role) return;
    setRoleLoading(true);
    try {
      await adminFetch(`/users/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role: selectedRole }) });
      toast({ title: "Role updated" });
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setRoleLoading(false); }
  };

  const handleWalletAction = async () => {
    const amount = parseFloat(walletAmount);
    if (isNaN(amount) || amount < 0) { toast({ title: "Invalid amount", variant: "destructive" }); return; }
    setWalletLoading(true);
    try {
      if (walletMode === "set") {
        await adminFetch(`/users/${userId}/wallet-set`, {
          method: "PATCH", body: JSON.stringify({ amount, reason: walletReason || undefined }),
        });
      } else {
        const delta = walletMode === "add" ? amount : -amount;
        await adminFetch(`/users/${userId}/wallet`, {
          method: "PATCH", body: JSON.stringify({ delta, reason: walletReason || undefined }),
        });
      }
      toast({ title: "Wallet updated" });
      setWalletAmount("");
      setWalletReason("");
      refreshProfile();
      loadWalletHistory();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setWalletLoading(false); }
  };

  const handleAssignBadge = async () => {
    if (!selectedBadge) return;
    setBadgeLoading(true);
    try {
      await adminFetch(`/users/${userId}/badges`, {
        method: "POST",
        body: JSON.stringify({
          badge: selectedBadge,
          label: selectedBadge === "custom" ? customBadgeLabel : undefined,
        }),
      });
      toast({ title: "Badge assigned" });
      setSelectedBadge("");
      setCustomBadgeLabel("");
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setBadgeLoading(false); }
  };

  const handleRemoveBadge = async (badgeId: string) => {
    try {
      await adminFetch(`/users/${userId}/badges/${badgeId}`, { method: "DELETE" });
      toast({ title: "Badge removed" });
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const handleBan = async () => {
    setBanLoading(true);
    try {
      await adminFetch(`/users/${userId}/ban-detail`, {
        method: "POST",
        body: JSON.stringify({
          banType, reason: banReason || undefined,
          expiresAt: banType === "temporary" ? new Date(banExpiry).toISOString() : undefined,
        }),
      });
      toast({ title: `User ${banType === "permanent" ? "permanently " : "temporarily "}banned` });
      setBanReason(""); setBanExpiry("");
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setBanLoading(false); }
  };

  const handleUnban = async () => {
    setBanLoading(true);
    try {
      await adminFetch(`/users/${userId}/unban`, { method: "POST" });
      toast({ title: "User unbanned" });
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setBanLoading(false); }
  };

  const handleMute = async () => {
    setMuteLoading(true);
    try {
      await adminFetch(`/users/${userId}/mute`, {
        method: "POST",
        body: JSON.stringify({ durationSeconds: mutePreset, reason: muteReason || undefined }),
      });
      toast({ title: `User muted${mutePreset ? ` for ${MUTE_PRESETS.find(p => p.seconds === mutePreset)?.label}` : " permanently"}` });
      setMuteReason("");
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setMuteLoading(false); }
  };

  const handleUnmute = async () => {
    setMuteLoading(true);
    try {
      await adminFetch(`/users/${userId}/unmute`, { method: "POST" });
      toast({ title: "User unmuted" });
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setMuteLoading(false); }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: "Min 6 characters", variant: "destructive" }); return;
    }
    setPwLoading(true);
    try {
      await adminFetch(`/users/${userId}/reset-password`, {
        method: "PATCH", body: JSON.stringify({ newPassword }),
      });
      toast({ title: "Password reset" });
      setNewPassword("");
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setPwLoading(false); }
  };

  const handleForceLogout = async () => {
    setLogoutLoading(true);
    try {
      await adminFetch(`/users/${userId}/force-logout`, { method: "POST" });
      toast({ title: "All sessions terminated" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setLogoutLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
          </div>
        ) : !profile ? (
          <div className="flex items-center justify-center h-48 text-slate-400">User not found</div>
        ) : (
          <>
            {/* Banner + Avatar */}
            <div className="relative">
              <div
                className="h-28 w-full bg-gradient-to-br from-purple-500 to-pink-500"
                style={profile.banner ? { backgroundImage: `url(${profile.banner})`, backgroundSize: "cover", backgroundPosition: "center" } : {}}
              />
              <div className="absolute -bottom-8 left-5">
                <div className="relative">
                  <Avatar className="h-16 w-16 border-4 border-white shadow-lg">
                    <AvatarImage src={profile.avatar || ""} />
                    <AvatarFallback className="text-xl bg-gradient-to-br from-purple-400 to-pink-400 text-white font-bold">
                      {profile.username[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {profile.isBanned && (
                    <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 border-2 border-white flex items-center justify-center">
                      <Ban className="h-3 w-3 text-white" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Profile info */}
            <div className="pt-10 px-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-extrabold text-lg text-slate-800">
                    {profile.displayName || profile.username}
                  </h3>
                  {profile.displayName && (
                    <p className="text-sm text-slate-500">@{profile.username}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <RolePill role={profile.role} />
                    {profile.subscriptionStatus === "active" && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-0.5">
                        <Star className="h-2.5 w-2.5" /> Premium
                      </span>
                    )}
                  </div>
                </div>
                {isOwner && (
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {profile.isBanned && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-100 text-red-600 flex items-center gap-0.5">
                        <Ban className="h-3 w-3" /> Banned
                      </span>
                    )}
                    {profile.activeMute && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-orange-100 text-orange-600 flex items-center gap-0.5">
                        <VolumeX className="h-3 w-3" /> Muted
                      </span>
                    )}
                  </div>
                )}
              </div>

              {profile.bio && (
                <p className="text-sm text-slate-600 mt-2">{profile.bio}</p>
              )}

              {/* Badges */}
              {profile.badges && profile.badges.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {profile.badges.map(b => (
                    <BadgePill key={b.id} badge={b.badge} label={b.label ?? undefined} color={b.color ?? undefined} />
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Joined {fmtDate(profile.createdAt)}
                </span>
                {isOwner && (
                  <span className="flex items-center gap-1 text-green-600 font-medium">
                    <Wallet className="h-3 w-3" />
                    {fmtRp(walletBalance)}
                  </span>
                )}
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v === "wallet") loadWalletHistory(); }}>
              <div className="border-b border-slate-100 px-5">
                <TabsList className="bg-transparent h-auto p-0 gap-4">
                  <TabsTrigger value="profile" className="pb-2 px-0 text-xs font-bold data-[state=active]:text-purple-600 data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none bg-transparent">
                    Profile
                  </TabsTrigger>
                  {isOwner && userId !== me?.id && (
                    <>
                      <TabsTrigger value="role" className="pb-2 px-0 text-xs font-bold data-[state=active]:text-purple-600 data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none bg-transparent">
                        Role
                      </TabsTrigger>
                      <TabsTrigger value="wallet" className="pb-2 px-0 text-xs font-bold data-[state=active]:text-purple-600 data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none bg-transparent">
                        Wallet
                      </TabsTrigger>
                      <TabsTrigger value="badge" className="pb-2 px-0 text-xs font-bold data-[state=active]:text-purple-600 data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none bg-transparent">
                        Badge
                      </TabsTrigger>
                      <TabsTrigger value="moderation" className="pb-2 px-0 text-xs font-bold data-[state=active]:text-purple-600 data-[state=active]:border-b-2 data-[state=active]:border-purple-500 rounded-none bg-transparent">
                        Moderate
                      </TabsTrigger>
                    </>
                  )}
                </TabsList>
              </div>

              {/* Profile Tab */}
              <TabsContent value="profile" className="px-5 py-4 space-y-3 mt-0">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-0.5">Username</p>
                    <p className="font-bold text-slate-700">@{profile.username}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-0.5">Role</p>
                    <p className="font-bold text-slate-700 capitalize">{profile.role}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-0.5">Status</p>
                    <p className={`font-bold ${profile.isBanned ? "text-red-600" : "text-green-600"}`}>
                      {profile.isBanned ? "Banned" : "Active"}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-0.5">Subscription</p>
                    <p className={`font-bold ${profile.subscriptionStatus === "active" ? "text-amber-600" : "text-slate-500"}`}>
                      {profile.subscriptionStatus === "active" ? "Premium" : "Free"}
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* Role Tab */}
              {isOwner && userId !== me?.id && (
                <TabsContent value="role" className="px-5 py-4 mt-0">
                  <p className="text-xs text-slate-500 mb-3">Current: <strong className="text-slate-700 capitalize">{profile.role}</strong></p>
                  <div className="space-y-2 mb-4">
                    {ROLES.map(r => (
                      <label key={r.value} className="flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all hover:border-purple-200"
                        style={{ borderColor: selectedRole === r.value ? "#8b5cf6" : "#f1f5f9" }}>
                        <input type="radio" name="role" value={r.value} checked={selectedRole === r.value}
                          onChange={() => setSelectedRole(r.value)} className="hidden" />
                        <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors
                          ${selectedRole === r.value ? "border-purple-500 bg-purple-500" : "border-slate-300"}`}>
                          {selectedRole === r.value && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>
                        <span className={`text-sm font-bold ${r.color}`}>{r.label}</span>
                      </label>
                    ))}
                  </div>
                  <Button onClick={handleRoleChange} disabled={roleLoading || selectedRole === profile.role}
                    className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                    {roleLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Save Role
                  </Button>
                </TabsContent>
              )}

              {/* Wallet Tab */}
              {isOwner && userId !== me?.id && (
                <TabsContent value="wallet" className="px-5 py-4 mt-0 space-y-4">
                  <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl p-4 text-white">
                    <p className="text-xs opacity-75">Current Balance</p>
                    <p className="text-2xl font-black">{fmtRp(walletBalance)}</p>
                  </div>

                  {/* Mode selector */}
                  <div className="flex gap-2">
                    {(["add", "reduce", "set"] as const).map(mode => (
                      <button key={mode} onClick={() => setWalletMode(mode)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2
                          ${walletMode === mode ? "border-purple-500 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-500"}`}>
                        {mode === "add" ? "Add" : mode === "reduce" ? "Reduce" : "Set"}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-slate-500">Amount (Rp)</Label>
                      <Input value={walletAmount} onChange={e => setWalletAmount(e.target.value)}
                        placeholder="e.g. 50000" type="number" min="0" className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Reason (optional)</Label>
                      <Input value={walletReason} onChange={e => setWalletReason(e.target.value)}
                        placeholder="Reason for adjustment..." className="mt-1" />
                    </div>
                    <Button onClick={handleWalletAction} disabled={walletLoading || !walletAmount}
                      className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                      {walletLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      {walletMode === "add" ? "Add Balance" : walletMode === "reduce" ? "Reduce Balance" : "Set Balance"}
                    </Button>
                  </div>

                  {/* Transaction history */}
                  {walletTxs.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 mb-2">Recent Transactions</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {walletTxs.map(tx => (
                          <div key={tx.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl text-xs">
                            <div>
                              <p className="font-medium text-slate-700 truncate max-w-[180px]">{tx.description}</p>
                              <p className="text-slate-400">{fmtDate(tx.createdAt)}</p>
                            </div>
                            <span className={`font-black ${tx.amount >= 0 ? "text-green-600" : "text-red-500"}`}>
                              {tx.amount >= 0 ? "+" : ""}{fmtRp(tx.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>
              )}

              {/* Badge Tab */}
              {isOwner && userId !== me?.id && (
                <TabsContent value="badge" className="px-5 py-4 mt-0 space-y-4">
                  {/* Current badges */}
                  {profile.badges && profile.badges.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 mb-2">Assigned Badges</p>
                      <div className="space-y-2">
                        {profile.badges.map(b => (
                          <div key={b.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                            <BadgePill badge={b.badge} label={b.label ?? undefined} color={b.color ?? undefined} />
                            <button onClick={() => handleRemoveBadge(b.id)}
                              className="text-slate-400 hover:text-red-500 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assign badge */}
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-2">Assign Badge</p>
                    <div className="grid grid-cols-2 gap-1.5 mb-3">
                      {Object.entries(BADGES).map(([key, conf]) => (
                        <button key={key} onClick={() => setSelectedBadge(key)}
                          className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold border-2 transition-all text-left
                            ${selectedBadge === key ? "border-purple-500 bg-purple-50" : "border-slate-200 hover:border-slate-300"}`}>
                          <span>{conf.icon}</span>
                          <span className="truncate" style={{ color: conf.color }}>{conf.label}</span>
                        </button>
                      ))}
                    </div>

                    {selectedBadge === "custom" && (
                      <Input value={customBadgeLabel} onChange={e => setCustomBadgeLabel(e.target.value)}
                        placeholder="Custom badge label..." className="mb-3" />
                    )}

                    <Button onClick={handleAssignBadge} disabled={badgeLoading || !selectedBadge}
                      className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white">
                      {badgeLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      <Plus className="h-3.5 w-3.5 mr-1" /> Assign Badge
                    </Button>
                  </div>
                </TabsContent>
              )}

              {/* Moderation Tab */}
              {isOwner && userId !== me?.id && (
                <TabsContent value="moderation" className="px-5 py-4 mt-0 space-y-5">
                  {/* Ban section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                        <Ban className="h-4 w-4 text-red-500" /> Ban System
                      </p>
                      {profile.isBanned && (
                        <Button variant="outline" size="sm" onClick={handleUnban} disabled={banLoading}
                          className="text-xs border-green-200 text-green-700 hover:bg-green-50">
                          {banLoading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          Unban
                        </Button>
                      )}
                    </div>

                    {profile.activeBan && (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs">
                        <p className="font-bold text-red-700">Currently Banned ({profile.activeBan.banType})</p>
                        {profile.activeBan.reason && <p className="text-red-500 mt-0.5">Reason: {profile.activeBan.reason}</p>}
                        {profile.activeBan.expiresAt && (
                          <p className="text-red-400 mt-0.5 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Expires: {fmtDate(profile.activeBan.expiresAt)}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      {(["permanent", "temporary"] as const).map(t => (
                        <button key={t} onClick={() => setBanType(t)}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all
                            ${banType === t ? "border-red-400 bg-red-50 text-red-700" : "border-slate-200 text-slate-500"}`}>
                          {t === "permanent" ? "Permanent" : "Temporary"}
                        </button>
                      ))}
                    </div>

                    {banType === "temporary" && (
                      <div>
                        <Label className="text-xs text-slate-500">Expiry Date & Time</Label>
                        <Input type="datetime-local" value={banExpiry} onChange={e => setBanExpiry(e.target.value)} className="mt-1" />
                      </div>
                    )}

                    <div>
                      <Label className="text-xs text-slate-500">Ban Reason (optional)</Label>
                      <Input value={banReason} onChange={e => setBanReason(e.target.value)}
                        placeholder="Reason for ban..." className="mt-1" />
                    </div>

                    <Button onClick={handleBan} disabled={banLoading}
                      className="w-full bg-red-500 hover:bg-red-600 text-white">
                      {banLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      <Ban className="h-3.5 w-3.5 mr-1.5" />
                      {banType === "permanent" ? "Permanently Ban" : "Temporarily Ban"}
                    </Button>
                  </div>

                  <div className="border-t border-slate-100" />

                  {/* Mute section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                        <VolumeX className="h-4 w-4 text-orange-500" /> Mute System
                      </p>
                      {profile.activeMute && (
                        <Button variant="outline" size="sm" onClick={handleUnmute} disabled={muteLoading}
                          className="text-xs border-green-200 text-green-700 hover:bg-green-50">
                          {muteLoading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          Unmute
                        </Button>
                      )}
                    </div>

                    {profile.activeMute && (
                      <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-xs">
                        <p className="font-bold text-orange-700">Currently Muted</p>
                        {profile.activeMute.reason && <p className="text-orange-500 mt-0.5">Reason: {profile.activeMute.reason}</p>}
                        {profile.activeMute.expiresAt && (
                          <p className="text-orange-400 mt-0.5 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Until: {fmtDate(profile.activeMute.expiresAt)}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      {MUTE_PRESETS.map(p => (
                        <button key={p.label} onClick={() => setMutePreset(p.seconds)}
                          className={`py-2 rounded-xl text-xs font-bold border-2 transition-all
                            ${mutePreset === p.seconds ? "border-orange-400 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-500"}`}>
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <div>
                      <Label className="text-xs text-slate-500">Mute Reason (optional)</Label>
                      <Input value={muteReason} onChange={e => setMuteReason(e.target.value)}
                        placeholder="Reason for mute..." className="mt-1" />
                    </div>

                    <Button onClick={handleMute} disabled={muteLoading}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white">
                      {muteLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      <VolumeX className="h-3.5 w-3.5 mr-1.5" /> Mute User
                    </Button>
                  </div>

                  <div className="border-t border-slate-100" />

                  {/* Password reset + force logout */}
                  <div className="space-y-3">
                    <p className="text-sm font-bold text-slate-700">Account Actions</p>

                    <div>
                      <Label className="text-xs text-slate-500">Reset Password</Label>
                      <div className="flex gap-2 mt-1">
                        <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                          placeholder="New password..." className="flex-1" />
                        <Button variant="outline" onClick={handleResetPassword} disabled={pwLoading} className="shrink-0">
                          {pwLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <Button variant="outline" onClick={handleForceLogout} disabled={logoutLoading}
                      className="w-full border-slate-200 text-slate-700 hover:bg-slate-50">
                      {logoutLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      <LogOut className="h-3.5 w-3.5 mr-1.5" /> Force Logout All Devices
                    </Button>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
