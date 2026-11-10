import { ProtectedRoute } from "@/lib/protected-route";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetMe } from "@workspace/api-client-react";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Camera, Wallet, ChevronRight, LogOut, Settings,
  Video, Star, Award, TrendingUp, Trophy, CheckCircle2,
  Sparkles, ShieldCheck, X, Check, Lock, Moon, Sun, ShoppingBag, Eye,
  HelpCircle, Shield, Bell,
} from "lucide-react";
import { useGamificationProfile } from "@/lib/gamification-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ── Achievement Modal ──────────────────────────────────────────────────────────
interface AchievementDetailModalProps {
  achievement: any | null;
  onClose: () => void;
}

function AchievementDetailModal({ achievement, onClose }: AchievementDetailModalProps) {
  if (!achievement) return null;
  return (
    <Dialog open={!!achievement} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xs sm:max-w-sm rounded-3xl bg-white p-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-purple-100 flex items-center justify-center text-3xl mx-auto shadow-sm">
          {achievement.icon || "🏆"}
        </div>
        <DialogHeader className="mt-3">
          <DialogTitle className="text-base font-extrabold text-slate-800">
            {achievement.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium mt-1">
            {achievement.description}
          </DialogDescription>
        </DialogHeader>

        <div className="my-3 p-3 bg-purple-50/70 rounded-2xl border border-purple-100 text-xs space-y-2 text-left">
          <div className="flex justify-between">
            <span className="text-slate-500">Hadiah EXP:</span>
            <span className="font-extrabold text-purple-600">+{achievement.expReward} EXP</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Status:</span>
            <span className={`font-bold ${achievement.unlocked ? "text-emerald-600" : "text-amber-600"}`}>
              {achievement.unlocked ? "✓ Terbuka" : "Terkunci"}
            </span>
          </div>
          {achievement.unlockedAt && (
            <div className="flex justify-between">
              <span className="text-slate-500">Tanggal Terbuka:</span>
              <span className="font-medium text-slate-700">
                {new Date(achievement.unlockedAt).toLocaleDateString("id-ID")}
              </span>
            </div>
          )}
          <div className="pt-1">
            <div className="flex justify-between text-[11px] text-slate-400 font-bold mb-1">
              <span>Progres</span>
              <span>{achievement.progress} / {achievement.requirementValue}</span>
            </div>
            <div className="h-2 w-full bg-purple-200/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
                style={{ width: `${achievement.progressPercent || 0}%` }}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={onClose}
            className="w-full rounded-2xl h-10 bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs"
          >
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Verified Creator Application Modal ─────────────────────────────────────────
interface VerifiedCreatorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token?: string | null;
  onSubmitted: () => void;
}

function VerifiedCreatorModal({ open, onOpenChange, token, onSubmitted }: VerifiedCreatorModalProps) {
  const { toast } = useToast();
  const [channelName, setChannelName] = useState("");
  const [category, setCategory] = useState("");
  const [socialLinks, setSocialLinks] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!channelName.trim()) {
      toast({ title: "Nama channel wajib diisi", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/creator-verifications/apply", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelName,
          category,
          socialLinks,
          portfolioUrl,
          description,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mengajukan verifikasi");

      toast({
        title: "🎉 Pengajuan Terkirim!",
        description: "Pengajuan verifikasi telah dikirim ke tim admin untuk ditinjau.",
      });
      onOpenChange(false);
      onSubmitted();
    } catch (err: any) {
      toast({
        title: "Gagal Mengajukan",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md rounded-3xl bg-white p-6">
        <DialogHeader className="text-center sm:text-center space-y-1">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <DialogTitle className="text-base font-extrabold text-slate-800">
            Daftar Verified Creator
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium">
            Dapatkan lencana centang biru (✓ Terverifikasi) dan akses fitur monetisasi eksklusif.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label className="text-xs font-bold text-slate-700">Nama Channel / Kreator *</Label>
            <Input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Contoh: Anime Kids Studio"
              className="rounded-xl text-xs h-10 border-slate-200"
              required
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-slate-700">Kategori Konten</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Contoh: Edukasi, Cerita Animasi, Lagu"
              className="rounded-xl text-xs h-10 border-slate-200"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-slate-700">Link Media Sosial / YouTube</Label>
            <Input
              value={socialLinks}
              onChange={(e) => setSocialLinks(e.target.value)}
              placeholder="https://youtube.com/@channel, https://instagram.com/..."
              className="rounded-xl text-xs h-10 border-slate-200"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-slate-700">Portofolio / Video Contoh</Label>
            <Input
              value={portfolioUrl}
              onChange={(e) => setPortfolioUrl(e.target.value)}
              placeholder="https://drive.google.com/... atau link video"
              className="rounded-xl text-xs h-10 border-slate-200"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-slate-700">Catatan / Deskripsi Singkat</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ceritakan pengalamanmu sebagai kreator..."
              rows={2}
              className="rounded-xl text-xs border-slate-200 resize-none"
            />
          </div>

          <DialogFooter className="pt-2 flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="flex-1 rounded-2xl h-10 font-bold text-xs"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-2xl h-10 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-extrabold text-xs shadow-md shadow-blue-500/20"
            >
              {isSubmitting ? "Mengirim..." : "Kirim Pengajuan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Profile Modal ─────────────────────────────────────────────────────────
interface EditProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: any;
  token?: string | null;
  onUpdated: () => void;
}

function EditProfileModal({ open, onOpenChange, currentUser, token, onUpdated }: EditProfileModalProps) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(currentUser?.displayName || "");
  const [username, setUsername] = useState(currentUser?.username || "");
  const [bio, setBio] = useState(currentUser?.bio || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(currentUser?.avatar || null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDisplayName(currentUser?.displayName || "");
      setUsername(currentUser?.username || "");
      setBio(currentUser?.bio || "");
      setAvatarPreview(currentUser?.avatar || null);
      setSelectedFile(null);
    }
  }, [open, currentUser]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Format tidak didukung", description: "Hanya file gambar yang diperbolehkan.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Ukuran terlalu besar", description: "Maksimal ukuran file foto adalah 5MB.", variant: "destructive" });
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !currentUser) return;
    setIsSaving(true);

    try {
      let finalAvatarUrl = currentUser.avatar;

      // Upload avatar first if a new file was chosen
      if (selectedFile) {
        const formData = new FormData();
        formData.append("image", selectedFile);
        formData.append("assetType", "avatar");

        const uploadRes = await fetch("/api/upload/image", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json();
          throw new Error(errData.error || "Gagal mengunggah foto profil");
        }

        const uploadData = await uploadRes.json();
        finalAvatarUrl = uploadData.url;
      }

      // Update user profile
      const patchRes = await fetch(`/api/users/${currentUser.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName,
          username,
          bio,
          avatar: finalAvatarUrl,
        }),
      });

      const patchData = await patchRes.json();
      if (!patchRes.ok) {
        throw new Error(patchData.error || "Gagal memperbarui profil");
      }

      toast({ title: "✅ Profil Berhasil Diperbarui!" });
      onOpenChange(false);
      onUpdated();
    } catch (err: any) {
      toast({
        title: "Gagal Menyimpan",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md rounded-3xl bg-white p-6">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-base font-extrabold text-slate-800">
            Edit Profil
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-medium">
            Sesuaikan foto, nama tampilan, dan bio profilmu.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          {/* Avatar Preview & Upload Trigger */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="h-20 w-20 rounded-full p-0.5 bg-gradient-to-br from-purple-400 via-pink-400 to-indigo-500 shadow-md">
                <Avatar className="w-full h-full border-2 border-white">
                  <AvatarImage src={avatarPreview || ""} />
                  <AvatarFallback className="bg-purple-100 text-purple-700 font-black text-xl">
                    {(displayName || username || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white border border-purple-200 text-purple-600 flex items-center justify-center shadow-md hover:scale-110 transition-transform"
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
            <p className="text-[11px] font-bold text-slate-400">Klik ikon kamera untuk ganti foto</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Nama Tampilan</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Contoh: Jules Anime"
              className="rounded-xl text-xs h-10 border-slate-200"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Username (@)</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username_anda"
              className="rounded-xl text-xs h-10 border-slate-200"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Biografi</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tuliskan cerita singkat tentang dirimu..."
              rows={2}
              className="rounded-xl text-xs border-slate-200 resize-none"
            />
          </div>

          <DialogFooter className="pt-2 flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="flex-1 rounded-2xl h-10 font-bold text-xs"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="flex-1 rounded-2xl h-10 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs shadow-md shadow-purple-500/20"
            >
              {isSaving ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Profile Page Component ───────────────────────────────────────────────
export default function ProfilePage() {
  const { user: authUser, token, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: freshUser, refetch: refetchUser } = useGetMe();
  const { data: gamification, refetch: refetchGamification } = useGamificationProfile();

  const currentUser: any = freshUser || authUser;

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [vcModalOpen, setVcModalOpen] = useState(false);
  const [selectedAch, setSelectedAch] = useState<any | null>(null);
  const [myApplication, setMyApplication] = useState<any | null>(null);
  const [achievementsList, setAchievementsList] = useState<any[]>([]);

  // Fetch my verification application status
  const loadMyApplication = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/creator-verifications/my-application", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMyApplication(data);
      }
    } catch {
      // ignore
    }
  };

  // Fetch full achievements
  const loadAchievements = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/gamification/achievements", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAchievementsList(data.achievements || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadMyApplication();
    loadAchievements();
  }, [token]);

  const handleLogout = () => {
    logout();
    setLocation("/login");
  };

  if (!currentUser) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="container mx-auto px-4 py-12 max-w-lg space-y-4">
            <Skeleton className="h-48 rounded-3xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  const level = gamification?.level ?? 1;
  const currentExp = gamification?.currentLevelExp ?? 0;
  const nextExp = gamification?.nextLevelExp ?? 250;
  const expPercent = nextExp > 0 ? Math.min(100, Math.floor((currentExp / nextExp) * 100)) : 0;
  const expRemaining = Math.max(0, nextExp - currentExp);

  // Quick stats values
  const statsWatched = gamification?.statistics?.videosWatched ?? 0;
  const statsCoins = currentUser?.walletBalance ?? 0;
  const statsAchievements = gamification?.achievementCount ?? 0;

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="max-w-md sm:max-w-lg mx-auto px-4 py-4 pb-16 space-y-4">
          {/* Top Bar with Settings */}
          <div className="flex items-center justify-between px-1">
            <h1 className="text-lg font-black text-slate-800">Profil Saya</h1>
            <button
              onClick={() => setEditModalOpen(true)}
              className="h-9 w-9 rounded-full bg-white border border-purple-100 flex items-center justify-center text-slate-600 shadow-sm hover:text-purple-600 hover:border-purple-200 transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          {/* Profile Header Card matching Reference 2 */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden bg-gradient-to-br from-purple-500/10 via-indigo-500/10 to-pink-500/10 rounded-3xl p-5 border border-purple-100 shadow-sm"
          >
            <div className="flex flex-col items-center text-center">
              {/* Circular Avatar with Camera edit trigger */}
              <div className="relative mb-3">
                <div className="h-20 w-20 rounded-full p-0.5 bg-gradient-to-tr from-purple-500 via-pink-400 to-indigo-500 shadow-lg">
                  <Avatar className="w-full h-full border-2 border-white">
                    <AvatarImage src={currentUser.avatar || ""} alt={currentUser.username} />
                    <AvatarFallback className="bg-purple-100 text-purple-700 font-black text-2xl">
                      {(currentUser.displayName || currentUser.username).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <button
                  onClick={() => setEditModalOpen(true)}
                  className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white border border-purple-200 text-purple-600 flex items-center justify-center shadow-md hover:scale-110 transition-transform"
                >
                  <Camera className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Display Name */}
              <h2 className="text-base sm:text-lg font-black text-slate-800 leading-tight">
                {currentUser.displayName || currentUser.username}
              </h2>
              {/* Username Handle */}
              <p className="text-xs font-bold text-slate-400 mt-0.5">@{currentUser.username}</p>

              {/* Badges Container matching reference: ★ Kreator (purple) & ✓ Terverifikasi (blue) */}
              <div className="flex items-center justify-center gap-2 mt-2.5 flex-wrap">
                {currentUser.creatorBadge && (
                  <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-extrabold px-3 py-1 rounded-full shadow-sm">
                    ★ Kreator
                  </span>
                )}
                {currentUser.verifiedCreator && (
                  <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-extrabold px-3 py-1 rounded-full shadow-sm">
                    ✓ Terverifikasi
                  </span>
                )}
                {!currentUser.creatorBadge && !currentUser.verifiedCreator && (
                  <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-[10px] font-extrabold px-3 py-1 rounded-full">
                    Member
                  </span>
                )}
              </div>

              {/* Bio quote */}
              <p className="text-xs text-slate-600 font-medium italic mt-2.5 max-w-xs px-2">
                "{currentUser.bio || "Pecinta anime & kreator video seru di Yzu视频!"}"
              </p>

              {/* Edit Profile Button */}
              <Button
                onClick={() => setEditModalOpen(true)}
                size="sm"
                className="mt-3.5 h-8 px-5 rounded-full bg-white text-purple-600 hover:bg-purple-50 border border-purple-200 font-extrabold text-xs shadow-sm gap-1.5 transition-transform active:scale-95"
              >
                Edit Profil
              </Button>
            </div>
          </motion.div>

          {/* Level & EXP Progress Card matching Reference 2 */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white rounded-3xl p-5 border border-purple-100/80 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center font-black text-sm shadow-md shadow-amber-500/20">
                  Lv.{level}
                </div>
                <div>
                  <p className="text-xs font-black text-slate-800">Level {level}</p>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-purple-600">
                    {gamification?.levelBadge?.name || "Explorer"}
                  </p>
                </div>
              </div>
              <span className="text-xs font-black text-slate-700">
                {currentExp} / {nextExp} EXP
              </span>
            </div>

            {/* Pastel animated progress bar */}
            <div className="relative h-3 w-full bg-purple-100/70 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 rounded-full transition-all duration-700"
                style={{ width: `${expPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 pt-0.5">
              <span>{expRemaining} EXP lagi untuk naik level</span>
              <span>Total: {gamification?.lifetimeExp?.toLocaleString() ?? 0} EXP</span>
            </div>
          </motion.div>

          {/* Quick Stats Grid (4 cards) matching Reference 2 */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Ditonton", value: statsWatched, icon: Eye, color: "text-purple-600 bg-purple-50" },
              { label: "Pembelian", value: statsAchievements > 0 ? "Aktif" : "0", icon: ShoppingBag, color: "text-pink-600 bg-pink-50" },
              { label: "Koin", value: statsCoins.toLocaleString("id-ID"), icon: Wallet, color: "text-amber-600 bg-amber-50" },
              { label: "Pencapaian", value: statsAchievements, icon: Trophy, color: "text-indigo-600 bg-indigo-50" },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div
                  key={i}
                  className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white border border-purple-50 shadow-sm text-center"
                >
                  <div className={`h-8 w-8 rounded-xl ${stat.color} flex items-center justify-center mb-1.5`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-black text-slate-800 truncate w-full">{stat.value}</p>
                  <p className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400 mt-0.5 truncate w-full">{stat.label}</p>
                </div>
              );
            })}
          </div>

          {/* Achievements Section matching Reference 2 */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-3xl p-5 border border-purple-100/80 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-purple-600" />
                <h3 className="text-xs font-black text-slate-800">Pencapaian & Hadiah</h3>
              </div>
              <Link href="/achievements" className="text-[10px] font-extrabold text-purple-600 hover:underline">
                Lihat Semua →
              </Link>
            </div>

            <div className="space-y-2.5">
              {achievementsList.slice(0, 4).map((ach) => (
                <div
                  key={ach.id}
                  onClick={() => setSelectedAch(ach)}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-purple-50/50 hover:bg-purple-50 border border-purple-100/60 cursor-pointer transition-colors"
                >
                  <div className="h-10 w-10 rounded-2xl bg-white text-xl flex items-center justify-center shadow-sm shrink-0">
                    {ach.icon || "🏆"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-black text-slate-800 truncate">{ach.name}</p>
                      <span className="text-[10px] font-extrabold text-purple-600 bg-white px-2 py-0.5 rounded-full border border-purple-100">
                        +{ach.expReward} EXP
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">{ach.description}</p>
                    <div className="h-1.5 w-full bg-white rounded-full overflow-hidden mt-1.5 border border-purple-100">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
                        style={{ width: `${ach.progressPercent || 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-slate-300">
                    {ach.unlocked ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Creator & Verified Creator Status Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Creator Badge Box */}
            <div className="p-4 rounded-3xl bg-white border border-purple-100/80 shadow-sm flex flex-col justify-between space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-black">
                  ★
                </div>
                <div>
                  <p className="text-xs font-black text-slate-800">Status Kreator</p>
                  <p className="text-[10px] font-bold text-slate-400">
                    {currentUser.creatorBadge ? "Aktif (Bisa Upload Video)" : "Dikelola oleh Admin"}
                  </p>
                </div>
              </div>
              {currentUser.creatorBadge ? (
                <div className="pt-2">
                  <Link href="/upload">
                    <Button size="sm" className="w-full h-8 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-[11px]">
                      Mulai Upload Video
                    </Button>
                  </Link>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 font-medium pt-1">
                  Status kreator diberikan langsung oleh admin / owner untuk mengunggah konten.
                </p>
              )}
            </div>

            {/* Verified Creator Box */}
            <div className="p-4 rounded-3xl bg-white border border-blue-100/80 shadow-sm flex flex-col justify-between space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black">
                  ✓
                </div>
                <div>
                  <p className="text-xs font-black text-slate-800">Verified Creator</p>
                  <p className="text-[10px] font-bold text-slate-400">
                    {currentUser.verifiedCreator
                      ? "Terverifikasi (Centang Biru)"
                      : myApplication?.status === "pending"
                      ? "Sedang Ditinjau Admin"
                      : myApplication?.status === "rejected"
                      ? "Pengajuan Ditolak"
                      : "Belum Diajukan"}
                  </p>
                </div>
              </div>
              <div className="pt-2">
                {currentUser.verifiedCreator ? (
                  <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100">
                    <ShieldCheck className="h-4 w-4" /> Akun Kreator Resmi
                  </div>
                ) : myApplication?.status === "pending" ? (
                  <Button size="sm" disabled className="w-full h-8 rounded-xl bg-slate-100 text-slate-400 font-bold text-[11px]">
                    Menunggu Peninjauan
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setVcModalOpen(true)}
                    className="w-full h-8 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-[11px] shadow-sm"
                  >
                    Ajukan Verifikasi
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Account Settings List */}
          <div className="bg-white rounded-3xl border border-purple-100/70 shadow-sm overflow-hidden divide-y divide-slate-50">
            <Link href="/topup" className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Wallet className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-slate-700">Top Up & Saldo</span>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </Link>

            <Link href="/history" className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <ShoppingBag className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-slate-700">Riwayat Pembelian & Transaksi</span>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </Link>

            {(currentUser.role === "admin" || currentUser.role === "owner") && (
              <Link href="/admin" className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Shield className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-700">Panel Admin & Dashboard</span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </Link>
            )}

            <button
              onClick={handleLogout}
              className="flex items-center justify-between w-full p-4 hover:bg-red-50 text-red-600 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-red-50 text-red-500 flex items-center justify-center">
                  <LogOut className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold">Keluar dari Akun</span>
              </div>
              <ChevronRight className="h-4 w-4 text-red-300" />
            </button>
          </div>
        </div>

        {/* Edit Profile Modal */}
        <EditProfileModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          currentUser={currentUser}
          token={token}
          onUpdated={() => {
            refetchUser();
            refetchGamification();
          }}
        />

        {/* Verified Creator Application Modal */}
        <VerifiedCreatorModal
          open={vcModalOpen}
          onOpenChange={setVcModalOpen}
          token={token}
          onSubmitted={() => {
            loadMyApplication();
          }}
        />

        {/* Achievement Detail Modal */}
        <AchievementDetailModal
          achievement={selectedAch}
          onClose={() => setSelectedAch(null)}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}
