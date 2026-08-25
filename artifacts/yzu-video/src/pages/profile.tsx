import { ProtectedRoute } from "@/lib/protected-route";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateUser, useGetMe } from "@workspace/api-client-react";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Loader2, Camera, Wallet, ChevronRight, LogOut, Settings,
  Bell, Shield, HelpCircle, Heart, Video, Star, Users, Gift,
  History, User, Lock, Moon, Sun, Award, Plus, Minus,
  TrendingUp, Trophy, Flame, MessageCircle, Upload,
} from "lucide-react";
import { useGamificationProfile } from "@/lib/gamification-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ROLE_STYLE: Record<string, { label: string; className: string }> = {
  owner: { label: "👑 Owner", className: "bg-amber-100 text-amber-700 border border-amber-200" },
  admin: { label: "🛡️ Admin", className: "bg-blue-100 text-blue-700 border border-blue-200" },
  meril: { label: "⭐ Member", className: "bg-purple-100 text-purple-700 border border-purple-200" },
};

function getRoleInfo(role?: string) {
  return ROLE_STYLE[role ?? "meril"] ?? ROLE_STYLE.meril;
}

// ─── Menu Item ────────────────────────────────────────────────────────────────
function MenuItem({
  icon: Icon, label, href, onClick, badge, danger, iconBg,
}: {
  icon: React.ElementType; label: string; href?: string; onClick?: () => void;
  badge?: string | number; danger?: boolean; iconBg?: string;
}) {
  const cls = `flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-100 transition-colors w-full text-left cursor-pointer`;
  const inner = (
    <>
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center shadow-sm ${iconBg ?? "bg-slate-100"}`}>
        <Icon className={`h-4.5 w-4.5 ${danger ? "text-red-500" : iconBg ? "text-white" : "text-slate-600"}`} />
      </div>
      <span className={`flex-1 text-sm font-semibold ${danger ? "text-red-500" : "text-slate-800"}`}>{label}</span>
      {badge && (
        <span className="text-[10px] font-extrabold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
          {badge}
        </span>
      )}
      {!danger && <ChevronRight className="h-4 w-4 text-slate-300" />}
    </>
  );

  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <button className={cls} onClick={onClick}>{inner}</button>;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string | number; color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className={`h-10 w-10 rounded-xl ${color} flex items-center justify-center shadow-sm`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <p className="font-extrabold text-slate-800 text-sm">{value}</p>
      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">{label}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user: authUser, token, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: freshUser, refetch } = useGetMe();
  const updateUser = useUpdateUser();
  const { data: gamification } = useGamificationProfile();

  const currentUser = freshUser || authUser;

  const [username, setUsername] = useState(currentUser?.username || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark") || localStorage.getItem("theme") === "dark");
  }, []);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("image", file);
    formData.append("assetType", "avatar");
    try {
      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      updateUser.mutate({ id: currentUser.id, data: { avatar: data.url } }, {
        onSuccess: () => { toast({ title: "✅ Foto profil diperbarui!" }); refetch(); },
      });
    } catch (err: any) {
      toast({ title: "Gagal upload", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const data: any = { username };
    if (currentPassword && newPassword) {
      data.currentPassword = currentPassword;
      data.newPassword = newPassword;
    }
    updateUser.mutate({ id: currentUser.id, data }, {
      onSuccess: () => {
        toast({ title: "✅ Profil berhasil diperbarui!" });
        setCurrentPassword(""); setNewPassword("");
        refetch();
      },
      onError: (err: any) => {
        toast({ title: "Update gagal", description: err.message, variant: "destructive" });
      },
    });
  };

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  if (!currentUser) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="container mx-auto px-4 py-12 max-w-lg">
            <div className="space-y-4">
              <Skeleton className="h-48 rounded-3xl" />
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-48 rounded-2xl" />
            </div>
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  const roleInfo = getRoleInfo(currentUser.role);

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="max-w-lg mx-auto pb-8">
          {/* Compact Hero Header */}
          <div
            className="relative overflow-hidden gradient-funplus pt-5 pb-5 px-4"
            style={{ borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}
          >
            {/* Subtle decorative blobs — smaller and softer */}
            <div className="absolute top-0 left-0 w-24 h-24 bg-white/8 rounded-full blur-2xl -translate-x-1/2" />
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-purple-300/15 rounded-full blur-2xl translate-x-1/4 translate-y-1/4" />

            <div className="relative z-10 flex items-center gap-4 px-1">
              {/* Avatar — left-aligned in a row layout */}
              <div className="relative flex-shrink-0">
                <div className="h-[84px] w-[84px] rounded-full p-0.5 bg-gradient-to-br from-yellow-300 via-pink-400 to-purple-500 shadow-lg">
                  <Avatar className="w-full h-full border-[3px] border-white">
                    <AvatarImage src={currentUser.avatar || ""} alt={currentUser.username} />
                    <AvatarFallback className="bg-purple-100 text-purple-700 font-extrabold text-xl">
                      {currentUser.username.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <button
                  onClick={() => !isUploading && avatarRef.current?.click()}
                  className="absolute -bottom-0.5 -right-0.5 h-7 w-7 bg-white rounded-full flex items-center justify-center shadow-md border-2 border-purple-100 hover:scale-110 transition-transform"
                >
                  {isUploading ? <Loader2 className="h-3 w-3 animate-spin text-purple-500" /> : <Camera className="h-3 w-3 text-purple-600" />}
                </button>
                <input type="file" ref={avatarRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
              </div>

              {/* Name & role — right of avatar */}
              <div className="flex flex-col min-w-0">
                <h2 className="text-base font-heading font-extrabold text-white leading-tight truncate">{currentUser.username}</h2>
                {currentUser.email && (
                  <p className="text-white/65 text-xs font-medium mt-0.5 truncate">{currentUser.email}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${roleInfo.className}`}>
                    {roleInfo.label}
                  </span>
                </div>
                {currentUser.createdAt && (
                  <p className="text-white/45 text-[9px] font-medium mt-1">
                    Member sejak {new Date(currentUser.createdAt).toLocaleDateString("id-ID", { year: "numeric", month: "long" })}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 mt-3 space-y-3">
            {/* Wallet Card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-5 shadow-lg border border-slate-100"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-sm">
                    <Wallet className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Saldo Wallet</p>
                    <p className="text-xl font-extrabold text-slate-800">
                      Rp {currentUser.walletBalance?.toLocaleString("id-ID") ?? 0}
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Top Up", icon: Plus, href: "/topup", color: "bg-purple-500" },
                  { label: "Riwayat", icon: History, href: "/history", color: "bg-blue-500" },
                  { label: "Shop", icon: Gift, href: "/shop", color: "bg-pink-500" },
                ].map((a) => (
                  <Link key={a.label} href={a.href}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-purple-50 hover:border-purple-100 transition-colors"
                  >
                    <div className={`h-8 w-8 rounded-xl ${a.color} flex items-center justify-center`}>
                      <a.icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-[10px] font-bold text-slate-600">{a.label}</span>
                  </Link>
                ))}
              </div>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-3xl p-4 shadow-sm border border-slate-100"
            >
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-4 px-1">Statistik</p>
              <div className="flex gap-2 justify-around flex-wrap">
                <StatCard icon={Video} label="Video" value={0} color="bg-purple-500" />
                <StatCard icon={Heart} label="Like" value={0} color="bg-pink-500" />
                <StatCard icon={Star} label="Favorit" value={0} color="bg-amber-500" />
                <StatCard icon={Users} label="Follower" value={0} color="bg-blue-500" />
                <StatCard icon={Gift} label="Shop" value={0} color="bg-emerald-500" />
                <StatCard icon={Award} label="Badge" value={0} color="bg-orange-500" />
              </div>
            </motion.div>

            {/* Menu */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden"
            >
              <div className="px-4 pt-4 pb-2">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Akun</p>
              </div>
              <div className="divide-y divide-slate-50">
                <MenuItem icon={User} label="Edit Profil" onClick={() => setShowEdit(!showEdit)} iconBg="bg-gradient-to-br from-purple-500 to-purple-400" />
                <MenuItem icon={Wallet} label="Wallet & Saldo" href="/topup" iconBg="bg-gradient-to-br from-amber-500 to-orange-400" />
                <MenuItem icon={History} label="Riwayat Transaksi" href="/history" iconBg="bg-gradient-to-br from-blue-500 to-sky-400" />
                <MenuItem icon={Gift} label="Shop Video" href="/shop" iconBg="bg-gradient-to-br from-pink-500 to-rose-400" />
              </div>

              <div className="px-4 pt-4 pb-2 border-t border-slate-50">
                <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Lainnya</p>
              </div>
              <div className="divide-y divide-slate-50">
                <MenuItem icon={Award} label="Leaderboard" href="/leaderboard" iconBg="bg-gradient-to-br from-yellow-500 to-amber-400" />
                <MenuItem icon={Bell} label="Notifikasi" href="/notifications" iconBg="bg-gradient-to-br from-red-500 to-pink-400" />
                <MenuItem icon={Shield} label="Keamanan" onClick={() => setShowEdit(true)} iconBg="bg-gradient-to-br from-slate-500 to-slate-400" />
              </div>

              {/* Dark mode toggle */}
              <div className="divide-y divide-slate-50 border-t border-slate-50">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center shadow-sm bg-gradient-to-br from-slate-700 to-slate-500">
                    {isDark ? <Moon className="h-4 w-4 text-white" /> : <Sun className="h-4 w-4 text-white" />}
                  </div>
                  <span className="flex-1 text-sm font-semibold text-slate-800">Mode Gelap</span>
                  <button
                    onClick={toggleDark}
                    className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${isDark ? "bg-purple-500" : "bg-slate-200"}`}
                  >
                    <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${isDark ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>

              {/* Admin panel (if admin/owner) */}
              {(currentUser.role === "admin" || currentUser.role === "owner") && (
                <div className="border-t border-slate-50 divide-y divide-slate-50">
                  <MenuItem
                    icon={Settings}
                    label="Panel Admin"
                    href="/admin"
                    iconBg="bg-gradient-to-br from-indigo-500 to-blue-500"
                  />
                </div>
              )}

              <div className="border-t border-slate-50 divide-y divide-slate-50">
                <MenuItem icon={HelpCircle} label="Bantuan" href="/search" iconBg="bg-gradient-to-br from-cyan-500 to-teal-400" />
                <MenuItem icon={LogOut} label="Keluar" onClick={handleLogout} danger />
              </div>
            </motion.div>

            {/* Edit Profile section */}
            {showEdit && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden"
              >
                <div className="p-5">
                  <h3 className="font-heading font-extrabold text-slate-800 mb-5 flex items-center gap-2">
                    <User className="h-4 w-4 text-purple-500" /> Edit Profil
                  </h3>
                  <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-sm font-bold text-slate-700">Username</Label>
                      <Input
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="rounded-xl bg-slate-50 border-slate-200 focus-visible:ring-purple-500"
                      />
                    </div>
                    <div className="pt-4 border-t border-slate-100">
                      <h4 className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 text-slate-500" /> Ganti Password
                      </h4>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="current" className="text-xs font-bold text-slate-600">Password Sekarang</Label>
                          <Input
                            id="current" type="password" placeholder="••••••••"
                            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                            className="rounded-xl bg-slate-50 border-slate-200"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="new" className="text-xs font-bold text-slate-600">Password Baru</Label>
                          <Input
                            id="new" type="password" placeholder="••••••••"
                            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                            className="rounded-xl bg-slate-50 border-slate-200"
                          />
                        </div>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-500 font-extrabold text-sm gap-2 border-none shadow-lg shadow-purple-500/20"
                      disabled={updateUser.isPending}
                    >
                      {updateUser.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Simpan Perubahan
                    </Button>
                  </form>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
