import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Video } from "@workspace/api-client-react";
import { Play, Lock, Eye, ThumbsUp, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface VideoCardProps {
  video: Video;
  layout?: "grid" | "list";
}

export function VideoCard({ video, layout = "grid" }: VideoCardProps) {
  const isPremium = video.type === "premium";
  
  if (layout === "list") {
    return (
      <Link href={`/videos/${video.id}`} className="group flex flex-col sm:flex-row gap-4 bg-card hover:bg-card/80 transition-colors rounded-xl border border-border/50 overflow-hidden">
        <div className="relative aspect-video sm:w-64 sm:h-auto sm:aspect-video shrink-0 overflow-hidden bg-muted">
          {video.thumbnail ? (
            <img 
              src={video.thumbnail} 
              alt={video.title} 
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary">
              <Play className="h-8 w-8 text-muted-foreground/30" />
            </div>
          )}
          
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="bg-primary/90 text-white rounded-full p-3 transform scale-75 group-hover:scale-100 transition-transform">
              <Play className="h-6 w-6 fill-current" />
            </div>
          </div>

          <div className="absolute top-2 left-2 flex gap-1">
            {isPremium && (
              <Badge variant="secondary" className="bg-amber-500 text-white hover:bg-amber-600 border-none font-medium">
                <Crown className="mr-1 h-3 w-3" /> Premium
              </Badge>
            )}
            {video.isFeatured && (
              <Badge className="bg-primary text-primary-foreground hover:bg-primary/90 border-none">
                Featured
              </Badge>
            )}
          </div>
          
          {video.category && (
            <div className="absolute bottom-2 right-2">
              <Badge variant="outline" className="bg-background/80 backdrop-blur text-foreground border-none text-xs">
                {video.category.name}
              </Badge>
            </div>
          )}
        </div>
        
        <div className="flex-1 p-4 sm:p-4 sm:pl-0 flex flex-col justify-between">
          <div>
            <h3 className="font-heading font-semibold text-lg line-clamp-2 group-hover:text-primary transition-colors">
              {video.title}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
              {video.description || "No description available."}
            </p>
          </div>
          
          <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              <span>{video.views.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <ThumbsUp className="h-3.5 w-3.5" />
              <span>{video.likes.toLocaleString()}</span>
            </div>
            <span>•</span>
            <span>{formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}</span>
          </div>
        </div>
      </Link>
    );
  }

  // Grid layout (default)
  return (
    <Link href={`/videos/${video.id}`} className="group flex flex-col gap-3">
      <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-muted border border-border/50">
        {video.thumbnail ? (
          <img 
            src={video.thumbnail} 
            alt={video.title} 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary">
            <Play className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="bg-primary/90 text-white rounded-full p-3 transform scale-75 group-hover:scale-100 transition-transform shadow-lg shadow-black/20">
            <Play className="h-6 w-6 fill-current pl-0.5" />
          </div>
        </div>

        <div className="absolute top-2 left-2 flex gap-1">
          {isPremium && (
            <Badge variant="secondary" className="bg-amber-500 text-white hover:bg-amber-600 border-none font-medium shadow-sm">
              <Crown className="mr-1 h-3 w-3" /> Premium
            </Badge>
          )}
          {video.isFeatured && (
            <Badge className="bg-primary text-primary-foreground hover:bg-primary/90 border-none shadow-sm">
              Featured
            </Badge>
          )}
        </div>
      </div>
      
      <div className="flex flex-col gap-1">
        <h3 className="font-heading font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors">
          {video.title}
        </h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {video.views.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-3.5 w-3.5" />
            {video.likes.toLocaleString()}
          </span>
          <span className="truncate">{formatDistanceToNow(new Date(video.createdAt))} ago</span>
        </div>
      </div>
    </Link>
  );
}

export function VideoCardSkeleton({ layout = "grid" }: { layout?: "grid" | "list" }) {
  if (layout === "list") {
    return (
      <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-border/50 animate-pulse bg-card">
        <div className="w-full sm:w-64 aspect-video rounded-lg bg-muted shrink-0" />
        <div className="flex-1 flex flex-col justify-between py-2">
          <div className="space-y-3">
            <div className="h-6 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-4 bg-muted rounded w-5/6" />
          </div>
          <div className="h-4 bg-muted rounded w-1/3 mt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="w-full aspect-video rounded-xl bg-muted" />
      <div className="space-y-2">
        <div className="h-5 bg-muted rounded w-[85%]" />
        <div className="h-4 bg-muted rounded w-[60%]" />
      </div>
    </div>
  );
}
