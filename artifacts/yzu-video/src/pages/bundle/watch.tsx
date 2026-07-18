import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Heart, Share2, BookmarkPlus, Eye, MessageCircle,
  Loader2, AlertCircle, Lock, PlayCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

import {
  useGetVideo, useFetchVideoComments, useLikeVideo,
  useRecordView, useAddComment, getGetVideoQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin-api";

/* ─── Types ─────────────────────────────────────────────── */
interface BundleVideo {
  id: string;
  title: string;
  thumbnail?: string | null;
}
interface Bundle {
  id: string;
  title: string;
  thumbnail?: string | null;
  hasPurchased: boolean;
  videos: BundleVideo[];
}

/* ─── Video Player ───────────────────────────────────────── */
function VideoPlayer({ src, thumbnail }: { src: string; thumbnail?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  // Determine if it's a direct file URL or external embed
  const isDirectFile = /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(src) || src.includes("supabase");
  const isYouTube = /youtube\.com|youtu\.be/.test(src);

  const getYouTubeEmbed = (url: string) => {
    const m = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
    return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0` : null;
  };

  if (isYouTube) {
    const embedUrl = getYouTubeEmbed(src);
    return (
      <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-lg">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="flex items-center justify-center h-full text-white/60 text-sm">URL tidak valid</div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-lg relative group">
      {isDirectFile ? (
        <video
          ref={videoRef}
          src={src}
          poster={thumbnail ?? undefined}
          controls
          playsInline
          className="w-full h-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      ) : (
        <iframe
          src={src}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      )}
      {/* Thumbnail overlay when not playing */}
      {!playing && isDirectFile && thumbnail && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={() => {
            videoRef.current?.play();
            setPlaying(true);
          }}
        >
          <img src={thumbnail} alt="thumbnail" className="absolute inset-0 w-full h-full object-cover" />
          <div className="relative z-10 h-16 w-16 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/40 flex items-center justify-center shadow-xl">
            <PlayCircle className="h-10 w-10 text-white drop-shadow" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Access Gate ────────────────────────────────────────── */
function AccessGate({ bundleId, bundleTitle }: { bundleId: string; bundleTitle: string }) {
  const [, setLocation] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="h-20 w-20 rounded-full bg-purple-100 flex items-center justify-center mb-4">
        <Lock className="h-9 w-9 text-purple-500" />
      </div>
      <h2 className="text-lg font-extrabold text-slate-800 mb-2">Konten Eksklusif Bundle</h2>
      <p className="text-sm text-slate-500 mb-6 max-w-xs">
        Anda harus membeli bundle ini untuk menonton video.
      </p>
      <Button
        className="rounded-2xl font-extrabold bg-gradient-to-br from-purple-500 to-pink-500 text-white px-6"
        onClick={() => setLocation(`/bundles/${bundleId}`)}
      >
        Lihat Bundle & Beli
      </Button>
      <button
        className="mt-3 text-sm text-slate-400 font-medium hover:text-slate-600 transition-colors"
        onClick={() => setLocation("/bundles")}
      >
        Kembali ke Bundles
      </button>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function BundleWatchPage() {
  const [, params] = useRoute("/bundle/watch/:videoId");
  const videoId = params?.videoId ?? "";
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"description" | "comments">("description");
  const [commentText, setCommentText] = useState("");

  // Fetch video
  const { data: video, isLoading: videoLoading } = useGetVideo(videoId, {
    query: { enabled: !!videoId, queryKey: getGetVideoQueryKey(videoId) },
  });

  // Fetch comments
  const { data: commentsData, refetch: refetchComments } = useFetchVideoComments(videoId, {
    query: { enabled: !!videoId },
  });
  const comments: any[] = Array.isArray(commentsData) ? commentsData : (commentsData as any)?.data ?? [];

  // Fetch bundle info for this video
  useEffect(() => {
    if (!videoId) return;
    setBundleLoading(true);
    adminFetch<Bundle>(`/bundles/video/${videoId}`)
      .then((data) => setBundle(data))
      .catch(() => setBundle(null))
      .finally(() => setBundleLoading(false));
  }, [videoId]);

  const recordView = useRecordView();
  const likeVideo = useLikeVideo();
  const addComment = useAddComment();

  // Record view after 5s if user has access
  useEffect(() => {
    if (!videoId || !video || video.hasAccess === false) return;
    const t = setTimeout(() => recordView.mutate({ id: videoId }), 5000);
    return () => clearTimeout(t);
  }, [videoId, video]);

  const handleLike = () => {
    if (!user) { setLocation("/login"); return; }
    likeVideo.mutate({ id: videoId }, {
      onSuccess: (res: any) => {
        queryClient.setQueryData(getGetVideoQueryKey(videoId), (old: any) =>
          old ? { ...old, isLiked: res.liked, likes: res.totalLikes } : old
        );
      },
    });
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: video?.title, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link disalin!" });
    }
  };

  const submitComment = () => {
    if (!commentText.trim()) return;
    if (!user) { setLocation("/login"); return; }
    addComment.mutate({ id: videoId, data: { content: commentText } }, {
      onSuccess: () => {
        setCommentText("");
        refetchComments();
        toast({ title: "Komentar terkirim!" });
      },
    });
  };

  /* ── Loading states ── */
  if (videoLoading || bundleLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
          <p className="text-sm font-semibold text-slate-500">Memuat video…</p>
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center">
          <AlertCircle className="h-14 w-14 text-red-400 mx-auto mb-3" />
          <h2 className="font-extrabold text-slate-800 mb-2">Video Tidak Ditemukan</h2>
          <Button onClick={() => setLocation("/bundles")} className="rounded-2xl mt-3">Kembali ke Bundles</Button>
        </div>
      </div>
    );
  }

  /* ── Access control ── */
  if (!bundle?.hasPurchased) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
        {/* Header */}
        <div className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost" size="icon"
            className="h-9 w-9 rounded-full bg-slate-100"
            onClick={() => bundle ? setLocation(`/bundles/${bundle.id}`) : setLocation("/bundles")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-extrabold text-sm text-slate-700 truncate">
            {bundle?.title ?? "Bundle Eksklusif"}
          </span>
        </div>
        <AccessGate
          bundleId={bundle?.id ?? ""}
          bundleTitle={bundle?.title ?? ""}
        />
      </div>
    );
  }

  /* ── Main watch view ── */
  const otherVideos = (bundle?.videos ?? []).filter((v) => v.id !== videoId);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top Bar ── */}
      <div className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <Button
          variant="ghost" size="icon"
          className="h-9 w-9 rounded-full bg-purple-100 text-purple-600"
          onClick={() => setLocation(`/bundles/${bundle.id}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-purple-500 truncate">{bundle.title}</p>
          <p className="text-sm font-extrabold text-slate-800 truncate leading-tight">{video.title}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto pb-12">
        {/* ── Video Player ── */}
        <div className="px-0 sm:px-4 pt-2">
          <VideoPlayer src={video.videoUrl ?? video.videoFilePath ?? ""} thumbnail={video.thumbnail} />
        </div>

        <div className="px-4 pt-4 space-y-4">
          {/* ── Title + Stats ── */}
          <div>
            <h1 className="font-heading font-extrabold text-xl text-slate-800 leading-tight mb-2">
              {video.title}
            </h1>
            <div className="flex items-center gap-4 text-sm text-slate-400 font-medium">
              <span className="flex items-center gap-1.5">
                <Eye className="h-4 w-4" />
                {(video.views ?? 0).toLocaleString()} views
              </span>
              <span className="flex items-center gap-1.5">
                <Heart className="h-4 w-4" />
                {(video.likes ?? 0).toLocaleString()}
              </span>
            </div>
          </div>

          {/* ── Action Buttons ── */}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className={`flex-1 rounded-xl h-10 font-bold gap-2 ${video.isLiked ? "text-pink-600 bg-pink-50" : "text-slate-500 bg-slate-100"}`}
              onClick={handleLike}
            >
              <Heart className={`h-4 w-4 ${video.isLiked ? "fill-pink-600" : ""}`} />
              {video.isLiked ? "Disukai" : "Suka"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 rounded-xl h-10 font-bold gap-2 text-slate-500 bg-slate-100"
              onClick={handleShare}
            >
              <Share2 className="h-4 w-4" />
              Bagikan
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 rounded-xl h-10 font-bold gap-2 text-slate-500 bg-slate-100"
              onClick={() => toast({ title: "Fitur simpan segera hadir!" })}
            >
              <BookmarkPlus className="h-4 w-4" />
              Simpan
            </Button>
          </div>

          {/* ── Tabs ── */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            {/* Tab headers */}
            <div className="flex border-b border-slate-100">
              <button
                className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === "description" ? "text-purple-600 border-b-2 border-purple-500" : "text-slate-400"}`}
                onClick={() => setActiveTab("description")}
              >
                Deskripsi
              </button>
              <button
                className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === "comments" ? "text-purple-600 border-b-2 border-purple-500" : "text-slate-400"}`}
                onClick={() => setActiveTab("comments")}
              >
                Komentar ({comments.length})
              </button>
            </div>

            {/* Tab content */}
            <div className="p-4">
              {activeTab === "description" ? (
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                  {video.description || "Tidak ada deskripsi."}
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Comment input */}
                  {user ? (
                    <div className="flex gap-2">
                      <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-extrabold text-sm shrink-0">
                        {user.username?.[0]?.toUpperCase() ?? "U"}
                      </div>
                      <div className="flex-1 flex gap-2">
                        <input
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitComment()}
                          placeholder="Tulis komentar…"
                          className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-purple-400 focus:bg-white transition-colors"
                        />
                        <Button
                          size="sm"
                          disabled={!commentText.trim() || addComment.isPending}
                          onClick={submitComment}
                          className="rounded-xl px-3 bg-purple-500 hover:bg-purple-600 text-white"
                        >
                          {addComment.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <MessageCircle className="h-3.5 w-3.5" />
                          }
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="w-full text-sm text-purple-500 font-bold py-2 rounded-xl bg-purple-50 hover:bg-purple-100 transition-colors"
                      onClick={() => setLocation("/login")}
                    >
                      Login untuk berkomentar
                    </button>
                  )}

                  {/* Comments list */}
                  {comments.length === 0 ? (
                    <p className="text-center text-sm text-slate-400 py-4">Belum ada komentar. Jadi yang pertama!</p>
                  ) : (
                    <div className="space-y-3 mt-1">
                      {comments.map((c: any) => (
                        <div key={c.id} className="flex gap-2.5">
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-extrabold text-xs shrink-0 mt-0.5">
                            {c.user?.username?.[0]?.toUpperCase() ?? "U"}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-extrabold text-slate-700">{c.user?.username ?? "User"}</span>
                              <span className="text-[10px] text-slate-400">
                                {c.createdAt
                                  ? formatDistanceToNow(new Date(c.createdAt), { addSuffix: true, locale: localeId })
                                  : ""}
                              </span>
                            </div>
                            <p className="text-sm text-slate-600 mt-0.5 leading-snug">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Video Dalam Paket Ini ── */}
          {bundle.videos.length > 0 && (
            <div>
              <h2 className="font-heading font-extrabold text-base text-slate-800 mb-3">
                Video Dalam Paket Ini
              </h2>
              <div className="space-y-2">
                {bundle.videos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setLocation(`/bundle/watch/${v.id}`)}
                    className={`w-full flex items-center gap-3 rounded-2xl p-3 border text-left transition-all ${
                      v.id === videoId
                        ? "border-purple-300 bg-purple-50 shadow-sm"
                        : "border-slate-100 bg-white hover:border-purple-200 hover:bg-purple-50/40"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative h-14 w-24 rounded-xl bg-slate-200 overflow-hidden shrink-0">
                      {v.thumbnail
                        ? <img src={v.thumbnail} alt={v.title} className="h-full w-full object-cover" />
                        : <div className="h-full w-full flex items-center justify-center"><PlayCircle className="h-6 w-6 text-slate-400" /></div>
                      }
                      {v.id === videoId && (
                        <div className="absolute inset-0 bg-purple-500/30 flex items-center justify-center">
                          <div className="h-5 w-5 rounded-full bg-white flex items-center justify-center">
                            <PlayCircle className="h-3.5 w-3.5 text-purple-600 fill-purple-600" />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-[13px] line-clamp-2 leading-snug ${v.id === videoId ? "text-purple-700" : "text-slate-800"}`}>
                        {v.title}
                      </p>
                      {v.id === videoId && (
                        <p className="text-[10px] font-extrabold text-purple-500 mt-0.5">▶ Sedang Diputar</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
