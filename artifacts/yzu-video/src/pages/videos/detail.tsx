import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Heart, Share2, ThumbsUp, CheckCircle2, Star, Send, Rocket, AlertCircle, Loader2 } from "lucide-react";

import { useGetVideo, useGetRelatedVideos, useFetchVideoComments, useLikeVideo, useRecordView, useAddComment, getGetVideoQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { PremiumLockScreen } from "@/components/video/PremiumLockScreen";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { VideoCard } from "@/components/video/VideoCard";
import { FunLogo } from "@/components/layout/AppLayout";

export default function VideoDetailPage() {
  const [, params] = useRoute("/videos/:id");
  const id = params?.id ?? "";
  
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  
  const { data: video, isLoading, error } = useGetVideo(id, { 
    query: { enabled: !!id, queryKey: getGetVideoQueryKey(id) } 
  });
  
  const { data: relatedVideos } = useGetRelatedVideos(id, {
    query: { enabled: !!id }
  });

  const { data: comments } = useFetchVideoComments(id, {
    query: { enabled: !!id }
  });

  const recordView = useRecordView();
  const likeVideo = useLikeVideo();
  const addComment = useAddComment();

  const [commentText, setCommentText] = useState("");

  useEffect(() => {
    if (id && video && video.hasAccess !== false) {
      const timer = setTimeout(() => {
        recordView.mutate({ id });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [id, video, recordView]);

  const handleLike = () => {
    if (!user) {
      toast({ title: "Oops!", description: "Login dulu yuk untuk like video.", variant: "destructive" });
      setLocation("/login");
      return;
    }
    
    likeVideo.mutate({ id }, {
      onSuccess: (res) => {
        queryClient.setQueryData(getGetVideoQueryKey(id), (old: any) => {
          if (!old) return old;
          return { ...old, isLiked: res.liked, likes: res.totalLikes };
        });
      }
    });
  };

  const submitComment = () => {
    if (!commentText.trim()) return;
    
    addComment.mutate({ id, data: { content: commentText } }, {
      onSuccess: () => {
        setCommentText("");
        queryClient.invalidateQueries({ queryKey: [`/api/videos/${id}/comments`] });
        toast({ title: "Komentar terkirim!" });
      }
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="w-12 h-12 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (error || !video) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-20 text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-heading font-extrabold mb-2">Video Tidak Ditemukan</h1>
          <p className="text-slate-500 mb-8 font-medium">Video yang kamu cari tidak ada atau sudah dihapus.</p>
          <Button onClick={() => setLocation("/")} className="rounded-full bg-purple-600 font-bold">Kembali ke Beranda</Button>
        </div>
      </AppLayout>
    );
  }

  // Use the authoritative visibility field; fall back to legacy type for old cached data
  const isLocked = (video.visibility
    ? video.visibility !== "public"
    : video.type === "premium") && !video.hasAccess;

  return (
    <AppLayout>
      {/* Mobile Custom TopBar */}
      <div className="sticky top-0 z-50 w-full bg-slate-50/95 backdrop-blur-md pb-2 pt-4 px-4 flex items-center justify-between border-b border-slate-100">
        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full bg-orange-100 text-orange-600 hover:bg-orange-200" onClick={() => window.history.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        
        <FunLogo className="scale-75 origin-center" />

        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full bg-white shadow-sm text-slate-400 hover:text-red-500 hover:bg-red-50" onClick={handleLike}>
            <Heart className={`h-5 w-5 ${video.isLiked ? 'fill-red-500 text-red-500' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full bg-white shadow-sm text-slate-400 hover:text-purple-600 hover:bg-purple-50">
            <Share2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto pb-8">
        {/* Player Area */}
        {isLocked ? (
          <div className="pt-2">
            <PremiumLockScreen video={video} />
          </div>
        ) : (
          <div className="relative mx-4 mt-4">
            <div className="absolute -top-3 -left-2 z-10">
              <div className="bg-red-500 text-white text-[10px] font-extrabold px-3 py-1 rounded-full shadow-md border-2 border-white transform -rotate-6">BARU!</div>
            </div>
            <div className="absolute -top-4 -right-3 z-10 w-12 h-12 bg-sky-400 rounded-full flex items-center justify-center shadow-lg transform rotate-12 border-2 border-white">
              <Rocket className="h-6 w-6 text-white" />
            </div>
            <div className="w-full aspect-video bg-black rounded-3xl overflow-hidden shadow-md border-4 border-white">
              <video 
                controls 
                autoPlay 
                poster={video.thumbnail || ''} 
                className="w-full h-full object-contain"
                src={video.videoUrl || ''}
              />
            </div>
          </div>
        )}

        {/* Creator Card */}
        <div className="bg-white rounded-3xl p-4 shadow-sm mx-4 mt-5 flex items-center gap-3 border border-slate-100">
          <Avatar className="h-12 w-12 border-2 border-purple-100 shadow-sm">
            <AvatarImage src={video.creator?.avatar || ''} />
            <AvatarFallback className="bg-purple-100 text-purple-700 font-bold">{video.creator?.username?.charAt(0).toUpperCase() || 'Y'}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-heading font-extrabold text-slate-800 text-sm truncate">{video.creator?.username || 'FUN+ Creator'}</span>
              <CheckCircle2 className="h-4 w-4 text-blue-500 fill-blue-500/20" />
            </div>
            <p className="text-[11px] font-medium text-slate-400">{formatDistanceToNow(new Date(video.createdAt))} ago</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-9 rounded-full bg-yellow-100 hover:bg-yellow-200 text-yellow-700 font-extrabold px-3 shadow-sm border border-yellow-200" onClick={handleLike}>
              <ThumbsUp className={`h-4 w-4 mr-1.5 ${video.isLiked ? 'fill-current' : ''}`} /> {video.likes.toLocaleString()}
            </Button>
            <Button size="sm" className="h-9 w-9 rounded-full bg-purple-50 hover:bg-purple-100 text-purple-600 p-0 shadow-sm border border-purple-100">
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stats & Description Card */}
        <div className="bg-white rounded-3xl p-5 shadow-sm mx-4 mt-3 border border-slate-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-orange-50 p-2.5 rounded-2xl border border-orange-100">
              <Star className="h-6 w-6 text-orange-500 fill-orange-500" />
            </div>
            <div>
              <span className="font-extrabold text-slate-800 text-lg block leading-none">{video.views.toLocaleString()}</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Views</span>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed font-medium">
            {video.description || "Video seru untuk ditonton bersama keluarga!"}
          </p>
        </div>

        {/* Comments Card */}
        <div className="bg-white rounded-3xl p-5 shadow-sm mx-4 mt-3 mb-6 border border-slate-100">
          <h3 className="font-heading font-extrabold text-slate-800 text-lg mb-4">Komentar ({comments?.total || 0})</h3>
          
          {user ? (
            <div className="flex gap-3 items-center bg-slate-50 p-1.5 rounded-full border border-slate-200 mb-6">
              <Avatar className="h-10 w-10 ml-1 shadow-sm border border-white">
                <AvatarImage src={user.avatar || ''} />
                <AvatarFallback className="bg-purple-100 text-purple-700 font-bold">{user.username.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <input 
                className="flex-1 bg-transparent border-none focus:outline-none text-sm font-medium px-2 text-slate-700 placeholder:text-slate-400" 
                placeholder="Tulis komentar..." 
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
              />
              <Button size="icon" className="h-10 w-10 rounded-full bg-purple-600 hover:bg-purple-700 text-white shrink-0 shadow-sm" onClick={submitComment} disabled={!commentText.trim() || addComment.isPending}>
                {addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 -ml-0.5" />}
              </Button>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-center mb-6">
              <p className="text-sm font-medium text-slate-500 mb-3">Login untuk ikut berkomentar ya!</p>
              <Button onClick={() => setLocation("/login")} variant="outline" className="rounded-full font-bold h-9 border-purple-200 text-purple-600 hover:bg-purple-50">Log In</Button>
            </div>
          )}

          <div className="space-y-5">
            {!comments?.data?.length ? (
              <div className="py-8 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 mb-3 bg-green-50 rounded-full flex items-center justify-center border border-green-100 shadow-sm">
                  {/* Cute Dinosaur / Dragon SVG */}
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 22C14 22 15.5 21 16 19.5C16.5 18 16.5 16 16.5 16C16.5 16 18 16 19 15C20 14 20 12 20 12C20 12 20.5 11.5 21 10C21.5 8.5 21 7 21 7C21 7 20 6.5 18 6.5C16 6.5 15 7 15 7C15 7 14 5 12 4C10 3 8 4 8 4C8 4 7.5 5 7.5 6C7.5 7 8 8 8 8C8 8 6.5 9 5 10C3.5 11 3 13 3 13C3 13 4 14 5 15C6 16 8 16 8 16C8 16 8 18 8.5 19.5C9 21 10.5 22 12 22Z" fill="#22C55E"/>
                    <circle cx="10" cy="8" r="1.5" fill="white"/>
                  </svg>
                </div>
                <p className="text-sm font-extrabold text-slate-700">Belum ada komentar.</p>
                <p className="text-xs font-medium text-slate-400 mt-1">Jadilah yang pertama untuk mulai ngobrol!</p>
              </div>
            ) : (
              comments.data.map(comment => (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="h-9 w-9 shrink-0 border border-slate-100">
                    <AvatarImage src={comment.user?.avatar || ''} />
                    <AvatarFallback className="bg-slate-100 text-slate-600 text-xs font-bold">{comment.user?.username?.charAt(0).toUpperCase() || 'U'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-heading font-extrabold text-[13px] text-slate-800">{comment.user?.username}</span>
                      <span className="text-[10px] font-medium text-slate-400">{formatDistanceToNow(new Date(comment.createdAt))} ago</span>
                    </div>
                    <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap">{comment.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Video Dalam Paket Ini */}
        {video.bundles && video.bundles.length > 0 && (
          <div className="mx-4 mt-6">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-lg font-heading font-extrabold text-slate-800 flex items-center gap-2">
                <span className="text-base">🎁</span> Video Dalam Paket Ini
              </h3>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 px-1">
              {video.bundles.map((b: { id: number; title: string; thumbnail?: string | null; videoCount?: number }) => (
                <button
                  key={b.id}
                  onClick={() => setLocation(`/bundles/${b.id}`)}
                  className="shrink-0 w-32 text-left"
                >
                  <div className="h-20 w-full rounded-2xl bg-gradient-to-br from-purple-400 to-pink-400 overflow-hidden mb-1.5">
                    {b.thumbnail && <img src={b.thumbnail} alt={b.title} className="h-full w-full object-cover" />}
                  </div>
                  <p className="text-[11px] font-extrabold text-slate-700 line-clamp-2 leading-tight">{b.title}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Up Next */}
        {relatedVideos && relatedVideos.length > 0 && (
          <div className="mx-4 mt-6">
            <h3 className="text-lg font-heading font-extrabold text-slate-800 mb-3 px-1">Selanjutnya</h3>
            <div className="flex flex-col gap-3">
              {relatedVideos.map((rv) => (
                <VideoCard key={rv.id} video={rv} layout="list" />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
