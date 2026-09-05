import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { AppLayout } from "@/components/layout/AppLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus, UserCheck, MessageCircle, Users, Video,
  ArrowLeft, MoreVertical, ShieldOff, Flag, Crown,
  BadgeCheck, Star, Calendar,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  bio?: string;
  role: string;
  verificationBadge?: string;
  creatorBadge: boolean;
  verifiedCreator: boolean;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  isMe: boolean;
  isBlocked: boolean;
  isOnline: boolean;
  lastSeenAt?: string;
  createdAt: string;
}

interface VideoItem {
  id: string;
  title: string;
  thumbnail?: string;
  views: number;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BADGE: Record<string, string> = {
  blue:    "text-blue-500",
  gold:    "text-amber-500",
  sulthan: "text-purple-500",
};

function VerifBadge({ badge }: { badge?: string }) {
  if (!badge) return null;
  return <BadgeCheck className={`h-4 w-4 ${BADGE[badge] ?? "text-blue-500"}`} />;
}

// ─── Stat block ───────────────────────────────────────────────────────────────

function StatBlock({ value, label, href }: { value: number; label: string; href?: string }) {
  const inner = (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-lg font-extrabold text-slate-800 leading-none">{value.toLocaleString()}</span>
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</span>
    </div>
  );
  if (href) return <Link href={href} className="flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity">{inner}</Link>;
  return inner;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [, setLocation] = useLocation();
  const { user: me } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showMenu, setShowMenu] = useState(false);

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ["user-profile", username],
    queryFn: () => adminFetch<UserProfile>(`/users/profile/${username}`),
    enabled: !!username,
    retry: false,
  });

  const followMut = useMutation({
    mutationFn: () => profile!.isFollowing
      ? adminFetch(`/social/follow/${profile!.id}`, { method: "DELETE" })
      : adminFetch(`/social/follow/${profile!.id}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-profile", username] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const blockMut = useMutation({
    mutationFn: () => profile!.isBlocked
      ? adminFetch(`/social/block/${profile!.id}`, { method: "DELETE" })
      : adminFetch(`/social/block/${profile!.id}`, { method: "POST" }),
    onSuccess: (_, _vars) => {
      qc.invalidateQueries({ queryKey: ["user-profile", username] });
      toast({ title: profile!.isBlocked ? "Pengguna di-unblock" : "Pengguna diblokir" });
      setShowMenu(false);
    },
  });

  const startDm = useMutation({
    mutationFn: () => adminFetch<{ conversationId: string }>("/dm/conversations/start", {
      method: "POST",
      body: JSON.stringify({ targetUserId: profile!.id }),
    }),
    onSuccess: (data) => setLocation(`/chat/dm/${data.conversationId}`),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto pb-24">
          <Skeleton className="h-40 w-full" />
          <div className="px-4 -mt-8 space-y-3">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!profile) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-24 text-center px-4">
          <Users className="h-16 w-16 text-slate-200 mb-4" />
          <h2 className="text-xl font-extrabold text-slate-600 mb-2">Pengguna tidak ditemukan</h2>
          <p className="text-sm text-slate-400 mb-6">Akun ini tidak ada atau sudah dihapus</p>
          <Button variant="outline" onClick={() => setLocation(-1 as any)} className="rounded-xl">
            <ArrowLeft className="h-4 w-4 mr-2" /> Kembali
          </Button>
        </div>
      </AppLayout>
    );
  }

  const isMe = profile.isMe;
  const onlineDot = profile.isOnline;

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto pb-24">
        {/* Banner */}
        <div className="relative">
          <div
            className="h-40 w-full gradient-kidzoo"
            style={profile.banner ? { backgroundImage: `url(${profile.banner})`, backgroundSize: "cover", backgroundPosition: "center" } : {}}
          />
          {/* Back button */}
          <button
            onClick={() => setLocation(-1 as any)}
            className="absolute top-4 left-4 h-9 w-9 bg-black/30 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-black/50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          {/* Menu */}
          {!isMe && me && (
            <div className="absolute top-4 right-4">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="h-9 w-9 bg-black/30 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-black/50 transition-colors"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-20">
                  <button
                    onClick={() => blockMut.mutate()}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <ShieldOff className="h-4 w-4" />
                    {profile.isBlocked ? "Unblock" : "Blokir"} Pengguna
                  </button>
                  <button
                    onClick={() => setShowMenu(false)}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    <Flag className="h-4 w-4" />
                    Laporkan
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 -mt-12 space-y-4">
          {/* Avatar + action buttons */}
          <div className="flex items-end justify-between">
            <div className="relative">
              <Avatar className="h-20 w-20 border-4 border-white shadow-lg">
                <AvatarImage src={profile.avatar ?? ""} />
                <AvatarFallback className="gradient-kidzoo text-white text-2xl font-extrabold">
                  {profile.username.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {onlineDot && (
                <div className="absolute bottom-1 right-1 h-4 w-4 bg-green-400 rounded-full border-2 border-white shadow-sm" />
              )}
            </div>
            {/* Action buttons */}
            {!isMe && me && !profile.isBlocked && (
              <div className="flex items-center gap-2 mb-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs font-bold border-slate-200"
                  onClick={() => startDm.mutate()}
                  disabled={startDm.isPending}
                >
                  <MessageCircle className="h-3.5 w-3.5 mr-1" /> Pesan
                </Button>
                <Button
                  size="sm"
                  onClick={() => followMut.mutate()}
                  disabled={followMut.isPending}
                  className={`rounded-xl text-xs font-bold gap-1 ${
                    profile.isFollowing
                      ? "bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-500 border border-slate-200"
                      : "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm shadow-purple-200"
                  }`}
                >
                  {profile.isFollowing
                    ? <><UserCheck className="h-3.5 w-3.5" /> Mengikuti</>
                    : <><UserPlus className="h-3.5 w-3.5" /> Ikuti</>
                  }
                </Button>
              </div>
            )}
            {isMe && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-xs font-bold mb-1"
                onClick={() => setLocation("/profile")}
              >
                Edit Profil
              </Button>
            )}
          </div>

          {/* Name + badges */}
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <h1 className="text-xl font-extrabold text-slate-800">
                {profile.displayName ?? profile.username}
              </h1>
              <VerifBadge badge={profile.verificationBadge} />
              {profile.role === "admin" && <Crown className="h-4 w-4 text-amber-500" />}
              {profile.role === "owner" && <Star className="h-4 w-4 text-amber-500" />}
            </div>
            <p className="text-sm text-slate-400 font-medium">@{profile.username}</p>
            {onlineDot ? (
              <div className="flex items-center gap-1 mt-1">
                <div className="h-2 w-2 rounded-full bg-green-400" />
                <span className="text-xs text-green-500 font-bold">Online</span>
              </div>
            ) : profile.lastSeenAt ? (
              <p className="text-xs text-slate-400 mt-1">
                Terakhir aktif {new Date(profile.lastSeenAt).toLocaleDateString("id-ID", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            ) : null}
          </div>

          {/* Bio */}
          {profile.bio && (
            <p className="text-sm text-slate-600 leading-relaxed">{profile.bio}</p>
          )}

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100"
          >
            <div className="flex justify-around divide-x divide-slate-100">
              <StatBlock value={profile.followerCount} label="Pengikut" />
              <div className="w-px" />
              <StatBlock value={profile.followingCount} label="Mengikuti" />
              <div className="w-px" />
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  {new Date(profile.createdAt).getFullYear()}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Member since */}
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
            <Calendar className="h-3.5 w-3.5" />
            Member sejak {new Date(profile.createdAt).toLocaleDateString("id-ID", { month: "long", year: "numeric" })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
