import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bell, MoreVertical, Play, Flame, Film, Smile, Tv, Sparkles, ChevronRight, Share2, Heart } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { adminFetch } from "@/lib/admin-api";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/layout/BottomNav";
import { useGetSettings } from "@workspace/api-client-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface VideoItem {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  views?: number;
  likes?: number;
  createdAt?: string;
  displayOn?: string;
  price?: number;
}

// Category Pills with icons & emojis matching Reference Image 2
const CATEGORIES = [
  { id: "all", label: "Popular", emoji: "🔥" },
  { id: "kids", label: "Kids", emoji: "👦" },
  { id: "animation", label: "Animation", emoji: "🎬" },
  { id: "movies", label: "Movies", emoji: "🎞️" },
  { id: "cartoons", label: "Cartoons", emoji: "🦄" },
  { id: "educational", label: "Edukasi", emoji: "📚" },
];

function formatTime(seconds?: number): string {
  if (!seconds || seconds <= 0) return "03:45";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "Baru saja";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("id-ID", { month: "short", day: "numeric" });
  } catch {
    return "Baru saja";
  }
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: settings } = useGetSettings();
  const [activeCategory, setActiveCategory] = useState("all");

  // Fetch free videos assigned to Home (or displayOn !== 'Shop')
  const { data: videosData, isLoading } = useQuery<{ data: VideoItem[]; total: number }>({
    queryKey: ["home-videos", activeCategory],
    queryFn: () => adminFetch<{ data: VideoItem[]; total: number }>(`/videos?displayOn=Home&visibility=public&limit=50`),
  });

  const videos = videosData?.data ?? [];

  const handleShare = (video: VideoItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (navigator.share) {
      navigator.share({
        title: video.title,
        url: `${window.location.origin}/videos/${video.id}`,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(`${window.location.origin}/videos/${video.id}`);
      toast({ title: "Link video disalin!" });
    }
  };

  return (
    <div className="min-h-screen bg-[#fbf9ff] pb-24 text-slate-800">
      {/* ── Cute Cloud-Themed Top Header Matching Reference Image 2 ── */}
      <div className="relative overflow-hidden bg-gradient-to-b from-purple-100/90 via-violet-50/60 to-[#fbf9ff] pt-3 pb-4 px-4 border-b border-purple-100/50">
        {/* Playful cartoon clouds & sparkles in the background */}
        <div className="absolute top-0 right-10 w-28 h-12 bg-white/70 rounded-full blur-[1px] pointer-events-none" />
        <div className="absolute top-2 right-6 w-16 h-10 bg-white/80 rounded-full blur-[1px] pointer-events-none" />
        <div className="absolute top-4 left-40 w-20 h-9 bg-white/50 rounded-full blur-[1px] pointer-events-none" />
        <div className="absolute top-1 left-2 h-2 w-2 rounded-full bg-amber-300 animate-ping opacity-60" />
        <div className="absolute top-5 right-28 h-2 w-2 rounded-full bg-purple-300 animate-pulse" />

        <div className="relative z-10 flex items-center justify-between">
          {/* Logo: Yzu视频 with Play badge */}
          <Link href="/" className="flex items-center gap-2 select-none group">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-tr from-purple-600 to-violet-500 flex items-center justify-center shadow-md shadow-purple-500/20 group-hover:scale-105 transition-transform">
              <Play className="h-4.5 w-4.5 text-white fill-white ml-0.5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tight text-slate-900 leading-none">
                Yzu<span className="text-purple-600 font-extrabold ml-0.5">视频</span>
              </span>
              <span className="text-[9px] font-bold text-purple-500 tracking-wider uppercase leading-tight mt-0.5">
                Play • Learn • Fun
              </span>
            </div>
          </Link>

          {/* Right Header: Notification Bell + User Avatar */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation(user ? "/notifications" : "/login")}
              className="relative h-9 w-9 rounded-full bg-white/80 hover:bg-white border border-purple-100 flex items-center justify-center text-slate-600 hover:text-purple-600 transition-colors shadow-sm"
              aria-label="Notifikasi"
            >
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
            </button>

            <button
              onClick={() => setLocation(user ? "/profile" : "/login")}
              className="h-9 w-9 rounded-full overflow-hidden border-2 border-purple-200 bg-white shadow-sm hover:border-purple-400 transition-colors"
              aria-label="Profil"
            >
              <Avatar className="h-full w-full">
                <AvatarImage src={user?.avatar ?? undefined} />
                <AvatarFallback className="h-full w-full text-xs font-black text-white bg-gradient-to-tr from-purple-600 to-violet-500">
                  {user?.username?.charAt(0).toUpperCase() ?? "Y"}
                </AvatarFallback>
              </Avatar>
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-5 pt-3 max-w-lg mx-auto">
        {/* ── Hero Promotional Banner Matching Reference Image 2 ── */}
        <section className="relative">
          <div className="relative w-full aspect-[2.1/1] sm:aspect-[2.5/1] rounded-3xl overflow-hidden shadow-lg shadow-purple-500/10 border border-purple-100">
            {settings?.banner ? (
              <img
                src={settings.banner}
                alt="Promotional Banner"
                className="w-full h-full object-cover"
              />
            ) : (
              /* Playful anime/cartoon landscape fallback illustration */
              <div className="w-full h-full bg-gradient-to-br from-sky-400 via-indigo-400 to-purple-500 relative flex flex-col justify-end p-4 text-white">
                {/* Sun & Clouds */}
                <div className="absolute top-3 right-6 h-12 w-12 rounded-full bg-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.8)]" />
                <div className="absolute top-5 right-14 w-20 h-7 bg-white/70 rounded-full blur-[1px]" />
                <div className="absolute top-2 left-6 w-24 h-8 bg-white/60 rounded-full blur-[1px]" />
                <div className="absolute bottom-8 right-20 text-3xl opacity-80">🌈</div>
                <div className="absolute bottom-6 left-6 text-3xl">🐱 ✨</div>

                <div className="relative z-10 max-w-[70%]">
                  <span className="inline-block px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-[10px] font-black tracking-wider uppercase mb-1">
                    Featured
                  </span>
                  <h2 className="text-base sm:text-lg font-black leading-tight drop-shadow-sm line-clamp-1">
                    Petualangan Seru Yzu视频
                  </h2>
                  <p className="text-[11px] text-white/90 font-medium line-clamp-1">
                    Tonton kartun favorit dan belajar hal baru setiap hari!
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Horizontal Scrollable Category Pills Matching Reference Image 2 ── */}
        <section className="relative">
          <div className="flex gap-2.5 overflow-x-auto pb-1 hide-scrollbar">
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black transition-all shadow-sm ${
                    active
                      ? "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-purple-500/30 scale-[1.02]"
                      : "bg-white text-slate-600 hover:text-purple-600 border border-purple-100 hover:border-purple-200"
                  }`}
                >
                  <span className="text-sm">{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Free Videos Section ("Video Gratis") Matching Reference Image 2 ── */}
        <section className="space-y-3 pt-1">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-2">
              <span className="h-6 w-2 rounded-full bg-purple-600 inline-block" />
              Video Gratis
            </h2>
            <Link href="/shop" className="text-xs font-bold text-purple-600 hover:text-purple-700 flex items-center">
              Lihat Shop <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Link>
          </div>

          {/* Responsive 2-column video card grid on mobile */}
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl p-2.5 border border-purple-100 animate-pulse space-y-2">
                  <div className="w-full aspect-[16/10] bg-purple-50 rounded-xl" />
                  <div className="h-3.5 bg-purple-50 rounded w-3/4" />
                  <div className="h-3 bg-purple-50 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : videos.length === 0 ? (
            <div className="py-14 text-center bg-white rounded-3xl border border-purple-100/70 p-6 shadow-sm">
              <div className="h-16 w-16 mx-auto mb-3 rounded-full bg-purple-50 flex items-center justify-center text-3xl">
                🎬
              </div>
              <h3 className="font-extrabold text-slate-800 text-base">Belum Ada Video Gratis</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                Video gratis untuk Home page akan segera hadir. Upload video baru melalui Owner Dashboard!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="group bg-white rounded-2xl overflow-hidden border border-purple-100/80 shadow-[0_2px_12px_rgba(139,92,246,0.06)] hover:shadow-md transition-all flex flex-col"
                >
                  {/* Thumbnail Container */}
                  <Link href={`/videos/${video.id}`} className="relative block aspect-[16/10] w-full overflow-hidden bg-slate-100">
                    {video.thumbnail ? (
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-purple-50">
                        <Play className="h-7 w-7 text-purple-400 fill-purple-400" />
                      </div>
                    )}
                    {/* Duration badge */}
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-bold text-white tracking-tight">
                      {formatTime(video.duration)}
                    </span>
                  </Link>

                  {/* Video Meta Info */}
                  <div className="p-2.5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <Link href={`/videos/${video.id}`} className="flex-1">
                          <h3 className="text-xs font-black text-slate-800 line-clamp-2 leading-snug hover:text-purple-600 transition-colors">
                            {video.title}
                          </h3>
                        </Link>

                        {/* Three-Dot Menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="h-6 w-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0 -mr-1"
                              aria-label="Menu"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40 rounded-xl">
                            <DropdownMenuItem onClick={(e) => handleShare(video, e)} className="text-xs cursor-pointer">
                              <Share2 className="h-3.5 w-3.5 mr-2" /> Bagikan
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLocation(`/videos/${video.id}`)} className="text-xs cursor-pointer">
                              <Play className="h-3.5 w-3.5 mr-2" /> Tonton Sekarang
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* View count & upload date */}
                    <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mt-2 pt-1 border-t border-slate-50">
                      <span>{(video.views ?? 0).toLocaleString()} views</span>
                      <span>{formatDate(video.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Floating 5-item Bottom Navigation */}
      <BottomNav />
    </div>
  );
}
