import { useGetFeaturedVideos, useListVideos, useListCategories, getListVideosQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { Button } from "@/components/ui/button";
import { Play, Crown, Flame, Clock, Ticket, Video } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

export default function Home() {
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);

  const { data: featuredVideos } = useGetFeaturedVideos();
  const { data: categories } = useListCategories();
  
  // Trending videos
  const { data: trendingVideos, isLoading: isLoadingTrending } = useListVideos({
    sort: 'trending', limit: 8
  }, { query: { queryKey: getListVideosQueryKey({ sort: 'trending', limit: 8 }) } });

  // Newest videos
  const { data: newestVideos, isLoading: isLoadingNewest } = useListVideos({
    sort: 'newest', limit: 8
  }, { query: { queryKey: getListVideosQueryKey({ sort: 'newest', limit: 8 }) } });

  // Filtered videos (Category or All)
  const { data: filteredVideos, isLoading: isLoadingFiltered } = useListVideos({
    categoryId: activeCategoryId || undefined,
    limit: 12
  }, { query: { queryKey: getListVideosQueryKey({ categoryId: activeCategoryId || undefined, limit: 12 }) } });

  const heroVideo = featuredVideos?.[0];

  return (
    <AppLayout>
      {/* Hero Section */}
      <section className="relative w-full h-[70vh] md:h-[80vh] min-h-[500px] bg-black overflow-hidden border-b border-border/50">
        {heroVideo ? (
          <>
            <div className="absolute inset-0">
              <img 
                src={heroVideo.thumbnail || ''} 
                alt={heroVideo.title} 
                className="w-full h-full object-cover opacity-60"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
            </div>
            
            <div className="relative h-full container mx-auto px-4 md:px-6 flex flex-col justify-center">
              <div className="max-w-2xl space-y-6">
                <div className="flex gap-2">
                  <Badge className="bg-primary text-primary-foreground border-none font-semibold px-3 py-1">Featured</Badge>
                  {heroVideo.type === 'premium' && (
                    <Badge variant="secondary" className="bg-amber-500/20 text-amber-500 border-none font-semibold px-3 py-1 backdrop-blur">
                      <Crown className="mr-1 h-3.5 w-3.5" /> Premium
                    </Badge>
                  )}
                </div>
                
                <h1 className="text-4xl md:text-6xl font-heading font-bold tracking-tight text-white leading-tight">
                  {heroVideo.title}
                </h1>
                
                <p className="text-lg text-gray-300 line-clamp-3 max-w-xl">
                  {heroVideo.description}
                </p>
                
                <div className="flex flex-wrap gap-4 pt-4">
                  <Link href={`/videos/${heroVideo.id}`}>
                    <Button size="lg" className="h-12 px-8 text-base font-semibold shadow-lg shadow-primary/30">
                      <Play className="mr-2 h-5 w-5 fill-current" /> Watch Now
                    </Button>
                  </Link>
                  <Link href={`/videos/${heroVideo.id}`}>
                    <Button variant="outline" size="lg" className="h-12 px-8 text-base bg-white/10 backdrop-blur border-white/20 text-white hover:bg-white/20">
                      More Info
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/20 animate-pulse">
            <div className="w-16 h-16 rounded-full bg-muted/40" />
          </div>
        )}
      </section>

      {/* Main Content */}
      <div className="container mx-auto px-4 md:px-6 py-12 space-y-16">
        
        {/* Trending Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
              <Flame className="h-6 w-6 text-primary" /> Trending Now
            </h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {isLoadingTrending 
              ? Array(4).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
              : trendingVideos?.data.slice(0, 4).map(video => (
                  <VideoCard key={video.id} video={video} />
                ))}
          </div>
        </section>

        {/* Categories / Filter Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
              <Ticket className="h-6 w-6 text-primary" /> Discover
            </h2>
          </div>
          
          <ScrollArea className="w-full whitespace-nowrap pb-4 mb-2">
            <div className="flex w-max space-x-2 p-1">
              <Button
                variant={activeCategoryId === null ? "default" : "outline"}
                className={`rounded-full ${activeCategoryId === null ? 'shadow-md shadow-primary/20' : 'bg-card'}`}
                onClick={() => setActiveCategoryId(null)}
              >
                All Videos
              </Button>
              {categories?.map(cat => (
                <Button
                  key={cat.id}
                  variant={activeCategoryId === cat.id ? "default" : "outline"}
                  className={`rounded-full ${activeCategoryId === cat.id ? 'shadow-md shadow-primary/20' : 'bg-card'}`}
                  onClick={() => setActiveCategoryId(cat.id)}
                >
                  {cat.name}
                </Button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="hidden" />
          </ScrollArea>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {isLoadingFiltered 
              ? Array(8).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
              : filteredVideos?.data.map(video => (
                  <VideoCard key={video.id} video={video} />
                ))}
          </div>
          
          {filteredVideos?.data.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center">
              <Video className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-xl font-heading font-medium text-muted-foreground">No videos found</h3>
              <p className="text-sm text-muted-foreground mt-2">Try selecting a different category</p>
            </div>
          )}
          
          {filteredVideos && filteredVideos.data.length > 0 && (
            <div className="mt-10 flex justify-center">
              <Button variant="outline" size="lg" className="w-full sm:w-auto px-12 rounded-full border-border/50 bg-card hover:bg-muted">
                Load More
              </Button>
            </div>
          )}
        </section>

        {/* New Releases */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
              <Clock className="h-6 w-6 text-primary" /> Fresh Releases
            </h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {isLoadingNewest 
              ? Array(4).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
              : newestVideos?.data.slice(0, 4).map(video => (
                  <VideoCard key={video.id} video={video} />
                ))}
          </div>
        </section>
        
      </div>
    </AppLayout>
  );
}
