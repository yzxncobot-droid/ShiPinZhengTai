import { useGetFeaturedVideos, useListVideos, useListCategories, getListVideosQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { Button } from "@/components/ui/button";
import { Play, Crown, Flame, Clock, Ticket, Video, Sparkles, Rocket, Star, PartyPopper } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const CATEGORY_EMOJI = ["🎈", "🚀", "🦄", "🎨", "🧩", "🎮", "🌈", "⭐"];

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
      {/* Hero Section — "Fun Premium Kids Club" theme: candy gradient wash behind the featured video */}
      <section className="relative w-full h-[70vh] md:h-[80vh] min-h-[520px] overflow-hidden border-b border-border/50 bg-gradient-to-br from-purple-600 via-fuchsia-500 to-sky-500">
        {/* Floating decorative shapes for a playful, toy-like feel */}
        <div className="absolute -top-10 -left-10 h-40 w-40 rounded-full bg-yellow-300/30 blur-2xl" />
        <div className="absolute bottom-0 right-10 h-56 w-56 rounded-full bg-orange-400/30 blur-3xl" />
        <Star className="absolute top-10 right-[20%] h-6 w-6 text-yellow-200/70 float-crown" />
        <Sparkles className="absolute bottom-24 left-[15%] h-8 w-8 text-white/60 float-crown" />

        {heroVideo ? (
          <>
            <div className="absolute inset-0">
              <img
                src={heroVideo.thumbnail || ''}
                alt={heroVideo.title}
                className="w-full h-full object-cover opacity-40 mix-blend-overlay"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-purple-900/70 via-transparent to-transparent" />
            </div>

            <div className="relative h-full container mx-auto px-4 md:px-6 flex flex-col justify-center">
              <div className="max-w-2xl space-y-6">
                <div className="flex gap-2">
                  <Badge className="bg-white text-purple-600 border-none font-bold px-3 py-1 rounded-full shadow-md">
                    <PartyPopper className="mr-1 h-3.5 w-3.5" /> Featured
                  </Badge>
                  {heroVideo.type === 'premium' && (
                    <Badge variant="secondary" className="bg-gradient-to-r from-orange-400 to-yellow-400 text-white border-none font-bold px-3 py-1 rounded-full shadow-md">
                      <Crown className="mr-1 h-3.5 w-3.5" /> Premium Kids Club
                    </Badge>
                  )}
                </div>

                <h1 className="text-4xl md:text-6xl font-heading font-extrabold tracking-tight text-white leading-tight drop-shadow-sm">
                  {heroVideo.title}
                </h1>

                <p className="text-lg text-white/85 line-clamp-3 max-w-xl">
                  {heroVideo.description}
                </p>

                <div className="flex flex-wrap gap-4 pt-4">
                  <Link href={`/videos/${heroVideo.id}`}>
                    <Button size="lg" className="h-12 px-8 text-base font-bold rounded-full bg-white text-purple-600 hover:bg-white/90 shadow-lg shadow-black/20">
                      <Play className="mr-2 h-5 w-5 fill-current" /> Tonton Sekarang
                    </Button>
                  </Link>
                  <Link href={`/videos/${heroVideo.id}`}>
                    <Button variant="outline" size="lg" className="h-12 px-8 text-base rounded-full bg-white/10 backdrop-blur border-white/30 text-white hover:bg-white/20">
                      Info Lengkap
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/20 animate-pulse" />
          </div>
        )}
      </section>

      {/* Main Content */}
      <div className="container mx-auto px-4 md:px-6 py-12 space-y-16">

        {/* Trending Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-yellow-400 shadow-sm">
                <Flame className="h-5 w-5 text-white" />
              </span>
              Lagi Rame Ditonton
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
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-sky-500 shadow-sm">
                <Ticket className="h-5 w-5 text-white" />
              </span>
              Jelajahi
            </h2>
          </div>

          <ScrollArea className="w-full whitespace-nowrap pb-4 mb-2">
            <div className="flex w-max space-x-2 p-1">
              <Button
                variant={activeCategoryId === null ? "default" : "outline"}
                className={`rounded-full ${activeCategoryId === null ? 'bg-gradient-to-r from-purple-500 to-sky-500 text-white border-none shadow-md shadow-purple-500/30' : 'bg-card'}`}
                onClick={() => setActiveCategoryId(null)}
              >
                🎬 Semua Video
              </Button>
              {categories?.map((cat, i) => (
                <Button
                  key={cat.id}
                  variant={activeCategoryId === cat.id ? "default" : "outline"}
                  className={`rounded-full ${activeCategoryId === cat.id ? 'bg-gradient-to-r from-purple-500 to-sky-500 text-white border-none shadow-md shadow-purple-500/30' : 'bg-card'}`}
                  onClick={() => setActiveCategoryId(cat.id)}
                >
                  {cat.icon || CATEGORY_EMOJI[i % CATEGORY_EMOJI.length]} {cat.name}
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
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-purple-500/10 to-sky-500/10 flex items-center justify-center mb-4">
                <Rocket className="h-9 w-9 text-purple-400" />
              </div>
              <h3 className="text-xl font-heading font-medium text-muted-foreground">Belum ada video di sini</h3>
              <p className="text-sm text-muted-foreground mt-2">Coba pilih kategori lain, ya!</p>
            </div>
          )}

          {filteredVideos && filteredVideos.data.length > 0 && (
            <div className="mt-10 flex justify-center">
              <Button variant="outline" size="lg" className="w-full sm:w-auto px-12 rounded-full border-border/50 bg-card hover:bg-muted">
                Muat Lebih Banyak
              </Button>
            </div>
          )}
        </section>

        {/* New Releases */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-heading font-bold flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-400 shadow-sm">
                <Clock className="h-5 w-5 text-white" />
              </span>
              Baru Rilis
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
