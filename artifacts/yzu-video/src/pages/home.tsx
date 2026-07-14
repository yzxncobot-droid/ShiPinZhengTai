import { useGetFeaturedVideos, useListVideos, useListCategories, getListVideosQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { Button } from "@/components/ui/button";
import { Play, Flame, Clock, Ticket, Sparkles, Rocket, Star, Music, Gamepad2, Heart, Smile, Cloud } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const CATEGORY_ICONS = [Star, Rocket, Sparkles, Music, Gamepad2, Heart, Smile, Cloud];

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
      <section className="relative w-full h-[60vh] md:h-[70vh] min-h-[480px] overflow-hidden bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-b-[40px] shadow-xl">
        {/* Decorative elements */}
        <div className="absolute top-10 left-10 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
        <div className="absolute bottom-10 right-10 w-48 h-48 bg-pink-500/20 rounded-full blur-3xl" />
        <Star className="absolute top-16 right-[15%] h-12 w-12 text-yellow-300 fill-yellow-300 drop-shadow-md transform rotate-12" />
        <Rocket className="absolute bottom-20 left-[10%] h-16 w-16 text-white drop-shadow-lg transform -rotate-12" />
        <Cloud className="absolute top-1/3 left-[20%] h-10 w-10 text-white/40 fill-white/40" />

        {heroVideo ? (
          <>
            <div className="absolute inset-0 z-0">
              <img
                src={heroVideo.thumbnail || ''}
                alt={heroVideo.title}
                className="w-full h-full object-cover opacity-30 mix-blend-overlay"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-indigo-900/90 via-indigo-900/40 to-transparent" />
            </div>

            <div className="relative z-10 h-full container mx-auto px-6 flex flex-col justify-end pb-16 md:pb-24">
              <div className="max-w-2xl space-y-4">
                <div className="flex gap-2">
                  <Badge className="bg-gradient-to-r from-orange-400 to-pink-500 text-white border-none font-extrabold px-3 py-1 rounded-full shadow-lg">
                    POPULAR 🔥
                  </Badge>
                </div>

                <h1 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight text-white leading-tight drop-shadow-md line-clamp-2">
                  {heroVideo.title}
                </h1>

                <p className="text-sm md:text-base text-white/90 line-clamp-2 font-medium max-w-lg">
                  {heroVideo.description}
                </p>

                <div className="pt-2">
                  <Link href={`/videos/${heroVideo.id}`}>
                    <Button size="lg" className="h-12 px-8 font-extrabold rounded-full bg-white text-purple-700 hover:bg-slate-100 shadow-xl shadow-black/10 transform transition-transform hover:scale-105">
                      <Play className="mr-2 h-5 w-5 fill-purple-700" /> Tonton Sekarang
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full border-4 border-white border-t-transparent animate-spin" />
          </div>
        )}
      </section>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 space-y-12">
        
        {/* Categories / Produk Video */}
        <section>
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-xl font-heading font-extrabold text-slate-800">
              Produk Video 🎬
            </h2>
          </div>

          <ScrollArea className="w-full whitespace-nowrap pb-4">
            <div className="flex w-max space-x-2 px-2">
              <Button
                variant={activeCategoryId === null ? "default" : "outline"}
                className={`rounded-full h-10 px-6 font-extrabold transition-all ${
                  activeCategoryId === null 
                    ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white border-none shadow-md shadow-purple-500/30' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-purple-600'
                }`}
                onClick={() => setActiveCategoryId(null)}
              >
                Semua
              </Button>
              {categories?.map((cat, i) => {
                const Icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
                return (
                  <Button
                    key={cat.id}
                    variant={activeCategoryId === cat.id ? "default" : "outline"}
                    className={`rounded-full h-10 px-5 font-extrabold transition-all ${
                      activeCategoryId === cat.id 
                        ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white border-none shadow-md shadow-purple-500/30' 
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-purple-600'
                    }`}
                    onClick={() => setActiveCategoryId(cat.id)}
                  >
                    <Icon className="mr-2 h-4 w-4" /> {cat.name}
                  </Button>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" className="hidden" />
          </ScrollArea>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 md:gap-6 px-1">
            {isLoadingFiltered 
              ? Array(10).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
              : filteredVideos?.data.map(video => (
                  <VideoCard key={video.id} video={video} />
                ))}
          </div>

          {filteredVideos?.data.length === 0 && (
            <div className="py-16 text-center flex flex-col items-center bg-white rounded-3xl border border-slate-100 mx-2 mt-4 shadow-sm">
              <div className="h-16 w-16 bg-purple-100 rounded-full flex items-center justify-center mb-3">
                <Rocket className="h-8 w-8 text-purple-500" />
              </div>
              <h3 className="text-lg font-heading font-extrabold text-slate-800">Belum ada video nih</h3>
              <p className="text-sm font-medium text-slate-500 mt-1">Coba kategori lain yuk!</p>
            </div>
          )}
        </section>

        {/* Trending Section */}
        <section className="px-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-heading font-extrabold text-slate-800 flex items-center gap-2">
              Lagi Rame Ditonton <Flame className="h-5 w-5 text-orange-500 fill-orange-500" />
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 md:gap-6">
            {isLoadingTrending 
              ? Array(4).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
              : trendingVideos?.data.slice(0, 5).map(video => (
                  <VideoCard key={video.id} video={video} />
                ))}
          </div>
        </section>

      </div>
    </AppLayout>
  );
}
