import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetVideo, useGetRelatedVideos, useFetchVideoComments, useLikeVideo, useRecordView, useAddComment, getGetVideoQueryKey } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Eye, ThumbsUp, Share2, Download, MessageSquare, AlertCircle, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { VideoCard } from "@/components/video/VideoCard";
import { useAuth } from "@/lib/auth";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function VideoDetailPage() {
  const [, params] = useRoute("/videos/:id");
  const id = params?.id ? parseInt(params.id) : 0;
  
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
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

  // Record view on mount
  useEffect(() => {
    if (id && video && video.hasAccess !== false) {
      // Small timeout to simulate actual viewing before tracking
      const timer = setTimeout(() => {
        recordView.mutate({ id });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [id, video, recordView]);

  const handleLike = () => {
    if (!user) {
      toast({ title: "Login required", description: "Please log in to like videos." });
      return;
    }
    
    likeVideo.mutate({ id }, {
      onSuccess: (res) => {
        // Optimistically update cache
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
        toast({ title: "Comment posted" });
      }
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-8 animate-pulse">
          <div className="w-full aspect-video bg-muted rounded-xl mb-6"></div>
          <div className="h-8 bg-muted rounded w-2/3 mb-4"></div>
          <div className="h-4 bg-muted rounded w-1/3 mb-8"></div>
        </div>
      </AppLayout>
    );
  }

  if (error || !video) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-20 text-center">
          <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-3xl font-heading font-bold mb-2">Video Not Found</h1>
          <p className="text-muted-foreground mb-8">The video you're looking for doesn't exist or has been removed.</p>
          <Link href="/"><Button>Back to Home</Button></Link>
        </div>
      </AppLayout>
    );
  }

  const isLocked = video.type === 'premium' && !video.hasAccess;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Content (Player & Details) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Player Container */}
            <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-border/50 shadow-lg">
              {isLocked ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-card/95 backdrop-blur-sm">
                  <div className="h-16 w-16 rounded-full bg-amber-500/20 flex items-center justify-center mb-6">
                    <PlayCircle className="h-8 w-8 text-amber-500" />
                  </div>
                  <h2 className="text-2xl font-heading font-bold mb-2">Premium Content</h2>
                  <p className="text-muted-foreground mb-8 max-w-md">
                    This video is exclusive to premium members. Upgrade your account or purchase this video to watch.
                  </p>
                  <div className="flex gap-4">
                    <Link href="/subscriptions">
                      <Button size="lg" className="rounded-full shadow-lg shadow-primary/20">
                        View Premium Plans
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <video 
                  controls 
                  autoPlay 
                  poster={video.thumbnail || ''} 
                  className="w-full h-full object-contain"
                  src={video.videoUrl || ''}
                />
              )}
            </div>

            {/* Video Info */}
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                {video.type === 'premium' && (
                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-none font-semibold">
                    Premium
                  </Badge>
                )}
                {video.category && (
                  <Badge variant="outline" className="border-border">
                    {video.category.name}
                  </Badge>
                )}
              </div>
              
              <h1 className="text-2xl md:text-3xl font-heading font-bold mb-4 leading-tight">
                {video.title}
              </h1>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border/50">
                {/* Channel / Creator */}
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12 border">
                    <AvatarImage src={video.creator?.avatar || ''} />
                    <AvatarFallback>{video.creator?.username?.charAt(0).toUpperCase() || 'Y'}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-heading font-semibold text-base">{video.creator?.username || 'Yzu Creator'}</p>
                    <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(video.createdAt))} ago</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button 
                    variant={video.isLiked ? "default" : "secondary"} 
                    className={`rounded-full ${video.isLiked ? 'shadow-md shadow-primary/20' : ''}`}
                    onClick={handleLike}
                  >
                    <ThumbsUp className={`mr-2 h-4 w-4 ${video.isLiked ? 'fill-current' : ''}`} />
                    {video.likes.toLocaleString()}
                  </Button>
                  
                  <Button variant="secondary" className="rounded-full">
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </Button>
                  
                  {video.downloadable && !isLocked && (
                    <Button variant="secondary" className="rounded-full">
                      <Download className="mr-2 h-4 w-4" /> Download
                    </Button>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className="bg-muted/30 rounded-xl p-4 md:p-6 mt-6 border border-border/50 text-sm md:text-base whitespace-pre-wrap leading-relaxed text-muted-foreground">
                <div className="flex items-center gap-4 text-foreground font-medium mb-3">
                  <span className="flex items-center gap-1.5"><Eye className="h-4 w-4" /> {video.views.toLocaleString()} views</span>
                </div>
                {video.description || "No description provided."}
              </div>
            </div>

            <Separator className="my-8" />

            {/* Comments Section */}
            <div>
              <h3 className="text-xl font-heading font-bold mb-6 flex items-center gap-2">
                <MessageSquare className="h-5 w-5" /> Comments <span className="text-muted-foreground font-normal text-base">({comments?.total || 0})</span>
              </h3>
              
              {user ? (
                <div className="flex gap-4 mb-8">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={user.avatar || ''} />
                    <AvatarFallback>{user.username.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-3">
                    <Textarea 
                      placeholder="Add a comment..." 
                      className="resize-none bg-background focus-visible:ring-1"
                      rows={3}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button 
                        onClick={submitComment} 
                        disabled={!commentText.trim() || addComment.isPending}
                        className="rounded-full px-6"
                      >
                        {addComment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Comment
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-muted/50 border rounded-xl p-6 text-center mb-8">
                  <p className="text-muted-foreground mb-4">You must be logged in to post a comment.</p>
                  <Link href="/login"><Button variant="outline" className="rounded-full">Log In</Button></Link>
                </div>
              )}

              <div className="space-y-6">
                {!comments?.data?.length ? (
                  <p className="text-muted-foreground text-center py-8">No comments yet. Be the first to start the conversation!</p>
                ) : (
                  comments.data.map(comment => (
                    <div key={comment.id} className="flex gap-4">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarImage src={comment.user?.avatar || ''} />
                        <AvatarFallback>{comment.user?.username?.charAt(0).toUpperCase() || 'U'}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-heading font-semibold text-sm">{comment.user?.username}</span>
                          <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(comment.createdAt))} ago</span>
                        </div>
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap">{comment.content}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
          </div>

          {/* Sidebar (Related Videos) */}
          <div className="lg:col-span-1 space-y-6">
            <h3 className="text-lg font-heading font-bold border-b pb-2">Up Next</h3>
            <div className="flex flex-col gap-4">
              {relatedVideos?.map((rv) => (
                <VideoCard key={rv.id} video={rv} layout="list" />
              ))}
              {relatedVideos?.length === 0 && (
                <p className="text-muted-foreground text-sm py-4">No related videos found.</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
