import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch as apiFetch } from "@/lib/admin-api";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { adminFetch, fmtDate } from "@/lib/admin-api";
import { motion, AnimatePresence } from "framer-motion";
import {
  Video, Plus, Search, MoreVertical, Edit, Trash2, Copy, BarChart2,
  Eye, Heart, Upload, ShieldAlert, Loader2, TrendingUp, Film, Star,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CreatorVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  visibility: "public" | "premium" | "hidden_bundle";
  status: string;
  views: number;
  likes: number;
  duration: number | null;
  categoryName: string | null;
  createdAt: string;
}

interface StatsData {
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
}

// ─── Visibility badge ─────────────────────────────────────────────────────────
const VIS: Record<string, { label: string; cls: string }> = {
  public:        { label: "Gratis",   cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  premium:       { label: "Premium",  cls: "bg-amber-100 text-amber-700 border-amber-200" },
  hidden_bundle: { label: "Bundle",   cls: "bg-violet-100 text-violet-700 border-violet-200" },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  published: { label: "Aktif",      cls: "bg-green-100 text-green-700" },
  draft:     { label: "Draft",      cls: "bg-yellow-100 text-yellow-700" },
  hidden:    { label: "Tersembunyi", cls: "bg-gray-100 text-gray-600" },
  scheduled: { label: "Terjadwal",  cls: "bg-blue-100 text-blue-700" },
};

function fmtViews(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, gradient }: {
  icon: React.ElementType; label: string; value: number | string; gradient: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-4">
      <div className={`h-12 w-12 rounded-2xl ${gradient} flex items-center justify-center shrink-0 shadow-sm`}>
        <Icon className="h-6 w-6 text-white" />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-400">{label}</p>
        <p className="text-xl font-extrabold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

// ─── Not Authorized ───────────────────────────────────────────────────────────
function NotAuthorized({ currentRole }: { currentRole?: { name: string; emoji?: string | null } | null }) {
  const [, setLocation] = useLocation();
  return (
    <AppLayout>
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="h-20 w-20 bg-purple-100 rounded-full flex items-center justify-center">
          <ShieldAlert className="h-10 w-10 text-purple-500" />
        </div>
        <h2 className="text-xl font-heading font-extrabold text-slate-800">Akses Ditolak</h2>
        <p className="text-slate-500 text-sm max-w-sm">
          Role kamu belum memiliki permission <strong>My Video</strong>.
          Hubungi admin untuk mendapatkan akses.
        </p>
        {currentRole && (
          <div className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-full text-sm font-semibold text-slate-600">
            {currentRole.emoji && <span>{currentRole.emoji}</span>}
            <span>Role saat ini: {currentRole.name}</span>
          </div>
        )}
        <Button onClick={() => setLocation("/profile")} className="rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold">
          Kembali ke Profil
        </Button>
      </div>
    </AppLayout>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MyVideoPage() {
  const { user, token, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const LIMIT = 10;

  // ── Permission: read from active custom roles (source of truth) ──────────────
  const { data: customRoles, isLoading: rolesLoading } = useQuery<any[]>({
    queryKey: ["my-custom-roles"],
    queryFn: () => apiFetch("/users/me/custom-roles"),
    enabled: !!token,
    staleTime: 60_000,
  });

  const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";
  const isBaseUser = user?.role === "user" || user?.role === "meril";
  const hasMyVideoPermission = isAdminOrOwner || isBaseUser || (customRoles?.some((r: any) => r.permMyVideo) ?? false);

  // Top-priority custom role for display in the access-denied screen
  const topCustomRole = customRoles?.[0] ?? null;

  const { data: videosData, isLoading: videosLoading } = useQuery({
    queryKey: ["creator-videos", page],
    queryFn: () => apiFetch<{ data: CreatorVideo[]; total: number; page: number; limit: number }>(
      `/creator/my-videos?page=${page}&limit=${LIMIT}`
    ),
    enabled: !!token && hasMyVideoPermission,
  });

  const { data: stats } = useQuery({
    queryKey: ["creator-stats"],
    queryFn: () => apiFetch<StatsData>("/creator/stats"),
    enabled: !!token && hasMyVideoPermission,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminFetch(`/creator/videos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Video dihapus" });
      qc.invalidateQueries({ queryKey: ["creator-videos"] });
      qc.invalidateQueries({ queryKey: ["creator-stats"] });
      setDeleteId(null);
    },
    onError: (err: any) => {
      toast({ title: "Gagal menghapus", description: err.message, variant: "destructive" });
    },
  });

  // ── Auth guards ──────────────────────────────────────────────────────────────
  if (authLoading || rolesLoading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        </div>
      </AppLayout>
    );
  }
  if (!token || !user) { setLocation("/login"); return null; }
  // Permission check: read from active custom roles (never badge flags)
  if (!hasMyVideoPermission) {
    return <NotAuthorized currentRole={topCustomRole} />;
  }

  const videos: CreatorVideo[] = videosData?.data ?? [];
  const total = videosData?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const filtered = search
    ? videos.filter((v) => v.title.toLowerCase().includes(search.toLowerCase()))
    : videos;

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/videos/${id}`);
    toast({ title: "Link disalin! 📋" });
  };

  return (
    <AppLayout>
      <div className="px-4 py-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-2 shadow-sm">
              <Film className="h-3 w-3" /> Creator Studio
            </div>
            <h1 className="text-2xl font-heading font-extrabold text-slate-800">My Video</h1>
            <p className="text-slate-400 text-sm">Kelola dan pantau konten kamu</p>
          </div>
          <Link href="/upload">
            <Button className="rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-extrabold gap-2 shadow-md shadow-purple-500/20 h-10 px-5">
              <Plus className="h-4 w-4" /> Upload
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard icon={Video} label="Total Video" value={stats?.totalVideos ?? 0} gradient="bg-gradient-to-br from-purple-500 to-pink-500" />
          <StatCard icon={Eye} label="Total Tayangan" value={fmtViews(stats?.totalViews ?? 0)} gradient="bg-gradient-to-br from-sky-500 to-blue-500" />
          <StatCard icon={Heart} label="Total Suka" value={fmtViews(stats?.totalLikes ?? 0)} gradient="bg-gradient-to-br from-rose-500 to-pink-500" />
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari video..."
            className="pl-9 rounded-full border-slate-200 bg-white"
          />
        </div>

        {/* Video List */}
        {videosLoading ? (
          <div className="space-y-3">
            {Array(4).fill(0).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 flex gap-3 animate-pulse">
                <div className="w-24 h-16 bg-slate-200 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-20 w-20 bg-purple-100 rounded-full flex items-center justify-center mb-4">
              <Upload className="h-10 w-10 text-purple-400" />
            </div>
            <h3 className="text-lg font-heading font-extrabold text-slate-700">
              {search ? "Video tidak ditemukan" : "Belum ada video"}
            </h3>
            <p className="text-sm text-slate-400 mt-1 max-w-xs">
              {search ? "Coba kata kunci lain." : "Upload video pertamamu sekarang!"}
            </p>
            {!search && (
              <Link href="/upload">
                <Button className="mt-4 rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold gap-2">
                  <Plus className="h-4 w-4" /> Upload Video
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-3">
              {filtered.map((video, i) => {
                const vis    = VIS[video.visibility]   ?? VIS.public;
                const status = STATUS[video.status]    ?? STATUS.published;
                return (
                  <motion.div
                    key={video.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ delay: i * 0.04 }}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex gap-3 p-3">
                      {/* Thumbnail */}
                      <div className="relative w-24 h-16 rounded-xl overflow-hidden bg-slate-200 shrink-0">
                        {video.thumbnail
                          ? <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><Video className="h-6 w-6 text-slate-400" /></div>
                        }
                        {video.duration && (
                          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                            {fmtDuration(video.duration)}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-sm text-slate-800 line-clamp-1 leading-snug">{video.title}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Badge variant="outline" className={`text-[10px] border ${vis.cls}`}>{vis.label}</Badge>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                          {video.categoryName && (
                            <span className="text-[10px] text-slate-400 font-medium">{video.categoryName}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400 font-medium">
                          <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {fmtViews(video.views)}</span>
                          <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" /> {fmtViews(video.likes)}</span>
                          <span>{fmtDate(video.createdAt)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-700 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl p-1.5 w-44">
                          <DropdownMenuItem onClick={() => copyLink(video.id)} className="rounded-xl gap-2 font-medium cursor-pointer">
                            <Copy className="h-3.5 w-3.5 text-slate-400" /> Salin Link
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild className="rounded-xl gap-2 font-medium cursor-pointer">
                            <Link href={`/videos/${video.id}`}>
                              <Eye className="h-3.5 w-3.5 text-slate-400" /> Lihat Video
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteId(video.id)}
                            className="rounded-xl gap-2 font-medium cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Hapus
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-full font-bold border-slate-200"
            >
              ← Sebelumnya
            </Button>
            <span className="flex items-center text-sm text-slate-500 font-medium px-3">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-full font-bold border-slate-200"
            >
              Selanjutnya →
            </Button>
          </div>
        )}
      </div>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus video ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Video akan dihapus secara permanen dan tidak bisa dikembalikan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="rounded-full bg-red-500 hover:bg-red-600"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
