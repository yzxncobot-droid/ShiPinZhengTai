import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Video } from "@workspace/api-client-react";
import { Play, Eye, ThumbsUp, Star, Cloud, Rocket, Smile } from "lucide-react";

interface VideoCardProps {
  video: Video;
  layout?: "grid" | "list";
}

const BADGES = [
  { text: "Prime Product", bg: "bg-gradient-to-r from-amber-400 to-orange-500" },
  { text: "Spesial Pilihan", bg: "bg-gradient-to-r from-purple-500 to-pink-500" },
  { text: "Pilihan Admin", bg: "bg-gradient-to-r from-blue-400 to-sky-500" }
];

const MASCOTS = [Star, Cloud, Rocket, Smile];

/** Stable numeric hash from a UUID string (or any string). Never returns NaN. */
function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function VideoCard({ video, layout = "grid" }: VideoCardProps) {
  const isPremium = video.type === "premium";

  // video.id is a UUID string — use a hash so modulo never produces NaN
  const hash = strHash(String(video.id));
  const badge = BADGES[hash % BADGES.length] ?? BADGES[0];
  const MascotIcon = MASCOTS[hash % MASCOTS.length] ?? MASCOTS[0];
  const formatRupiah = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;
  
  if (layout === "list") {
    return (
      <Link href={`/videos/${video.id}`} className="group flex gap-3 bg-white hover:bg-slate-50 transition-colors rounded-2xl p-2 border border-slate-100 shadow-sm">
        <div className="relative w-32 aspect-video rounded-xl overflow-hidden bg-slate-100 shrink-0">
          {video.thumbnail ? (
            <img 
              src={video.thumbnail} 
              alt={video.title} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-200">
              <Play className="h-6 w-6 text-slate-400" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
        </div>
        
        <div className="flex-1 flex flex-col justify-center min-w-0 py-1 pr-2">
          <h3 className="font-heading font-extrabold text-sm text-slate-800 line-clamp-2 leading-snug">
            {video.title}
          </h3>
          
          <div className="flex items-center gap-3 mt-2 text-[10px] font-bold text-slate-400">
            <div className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              <span>{(video.views ?? 0).toLocaleString()}</span>
            </div>
            <span>•</span>
            <span className="truncate">{video.createdAt ? formatDistanceToNow(new Date(video.createdAt)) : "—"}</span>
          </div>
        </div>
      </Link>
    );
  }

  // Grid layout (default) - matched to mobile screenshot 1
  return (
    <Link href={`/videos/${video.id}`} className="group flex flex-col bg-white rounded-3xl p-2.5 pb-4 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="relative aspect-[4/5] w-full rounded-2xl overflow-hidden bg-slate-100">
        {video.thumbnail ? (
          <img 
            src={video.thumbnail} 
            alt={video.title} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-200">
            <Play className="h-8 w-8 text-slate-300" />
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10 pointer-events-none" />

        {/* Top-left Badge */}
        <div className="absolute top-2 left-2 z-10">
          <div className={`px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-extrabold text-white shadow-sm ${badge.bg}`}>
            {badge.text}
          </div>
        </div>
        
        {/* Top-right Play Button */}
        <div className="absolute top-2 right-2 z-10 bg-white/95 backdrop-blur rounded-full p-1.5 shadow-sm transform group-hover:scale-110 transition-transform">
          <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-purple-600 fill-purple-600 ml-0.5" />
        </div>

        {/* Bottom-right Mascot Sticker */}
        <div className="absolute -bottom-2 -right-2 z-10">
          <div className="bg-white rounded-full p-1 sm:p-1.5 shadow-md transform rotate-12 group-hover:rotate-0 transition-transform">
            <div className="bg-gradient-to-br from-yellow-300 to-orange-400 p-1.5 rounded-full">
              <MascotIcon className="h-4 w-4 sm:h-5 sm:w-5 text-white" fill="white" />
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex flex-col gap-1 mt-3 px-1">
        <h3 className="font-heading font-extrabold text-xs sm:text-sm text-slate-800 line-clamp-1 leading-snug">
          {video.title}
        </h3>
        <p className="text-[10px] sm:text-[11px] text-slate-500 line-clamp-1 font-medium">
          {video.description || "Video edukasi anak terbaik"}
        </p>
        
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-sm sm:text-base font-extrabold text-purple-600">
            {video.price ? formatRupiah(video.price) : "Gratis"}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function VideoCardSkeleton({ layout = "grid" }: { layout?: "grid" | "list" }) {
  if (layout === "list") {
    return (
      <div className="flex gap-3 p-2 rounded-2xl border border-slate-100 bg-white animate-pulse">
        <div className="w-32 aspect-video rounded-xl bg-slate-200 shrink-0" />
        <div className="flex-1 flex flex-col justify-center py-1 space-y-2">
          <div className="h-4 bg-slate-200 rounded w-3/4" />
          <div className="h-3 bg-slate-200 rounded w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col p-2.5 pb-4 bg-white rounded-3xl border border-slate-100 animate-pulse">
      <div className="w-full aspect-[4/5] rounded-2xl bg-slate-200 mb-3" />
      <div className="space-y-2 px-1">
        <div className="h-4 bg-slate-200 rounded w-[85%]" />
        <div className="h-3 bg-slate-200 rounded w-[60%]" />
        <div className="h-5 bg-slate-200 rounded w-[40%] mt-2" />
      </div>
    </div>
  );
}
