import {
  useGetFeaturedVideos, useListVideos, useListCategories,
  getListVideosQueryKey,
} from "@workspace/api-client-react";
import type { Video } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useState, useEffect, useMemo, useCallback, Component, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
import {
  Play, Gift, Star, Flame, Sparkles, Heart, TrendingUp, ChevronLeft,
  ChevronRight, ChevronDown, Rocket, Cloud, Smile, Award,
} from "lucide-react";

// ─── Section Error Boundary ──────────────────────────────────────────────────
class SectionBoundary extends Component<{ label: string; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: Error) { console.error(`[SectionBoundary:${this.props.label}]`, e); }
  render() {
    if (this.state.err) return (
      <div className="py-8 text-center text-sm text-slate-400 font-medium">
        Konten tidak dapat ditampilkan.
      </div>
    );
    return this.props.children;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────
const CATEGORY_ICONS = [Star, Rocket, Sparkles, Flame, Gift, Heart, Smile, Cloud, Award, TrendingUp];
const INITIAL_LIMIT = 6;
const LOAD_MORE_STEP = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatPrice(price: number | null | undefined) {
  if (price == null) return null;
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(price)
    .replace("IDR\u00a0", "Rp\u00a0")
    .replace("Rp\u00a0", "Rp ");
}

// ─── Hero Skeleton ────────────────────────────────────────────────────────────
function HeroSkeleton() {
  return (
    <div className="mx-4 mt-3 rounded-[28px] overflow-hidden shadow-md bg-white">
      <div className="relative h-[220px] sm:h-[250px] animate-pulse overflow-hidden">
        {/* gradient bg placeholder */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-200 via-blue-200 to-pink-100" />
        {/* left content skeleton */}
        <div className="absolute inset-0 flex flex-col justify-center pl-5 pr-[44%] gap-2.5">
          <div className="h-5 w-20 bg-white/60 rounded-full" />
          <div className="h-7 w-40 bg-white/60 rounded-xl" />
          <div className="h-4 w-32 bg-white/40 rounded-lg" />
          <div className="h-6 w-24 bg-white/50 rounded-full" />
        </div>
        {/* right image skeleton */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 w-[38%] aspect-video bg-white/40 rounded-2xl" />
      </div>
    </div>
  );
}

// ─── Hero Slide ────────────────────────────────────────────────────────────────
function HeroSlide({ video, index }: { video: Video; index: number }) {
  const priceDisplay = formatPrice(video.price);
  // Derive a plausible original price (15% more) only for premium videos with a price
  const originalPrice = video.price && video.type === "premium"
    ? formatPrice(Math.round(video.price * 1.15 / 100) * 100)
    : null;

  return (
    <div className="relative flex-none w-full h-[220px] sm:h-[250px]">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-600 via-blue-500 to-indigo-400" />

      {/* Decorative blobs */}
      <div className="absolute top-0 right-[38%] w-28 h-28 bg-yellow-300/20 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-pink-400/20 rounded-full blur-2xl pointer-events-none" />

      {/* Decorative stars */}
      <div className="absolute top-4 right-[43%] text-yellow-300 text-base pointer-events-none select-none animate-pulse">★</div>
      <div className="absolute bottom-10 right-[38%] text-yellow-200 text-xs pointer-events-none select-none">★</div>
      <div className="absolute top-8 right-[32%] text-white/50 text-xs pointer-events-none select-none">✦</div>

      {/* Left content */}
      <div className="absolute inset-0 flex flex-col justify-center pl-5 pr-[44%] gap-1.5 z-10">
        {/* Popular badge */}
        <span className="inline-flex items-center gap-1 self-start bg-gradient-to-r from-orange-400 to-yellow-400 text-white text-[11px] font-extrabold px-2.5 py-1 rounded-full shadow-sm">
          <span>⭐</span> Popular
        </span>

        {/* Title */}
        <h1 className="text-lg sm:text-xl font-extrabold text-white leading-tight line-clamp-2 drop-shadow-sm">
          {video.title}
        </h1>

        {/* Subtitle / description */}
        <p className="text-xs text-white/80 line-clamp-1 font-medium">
          {video.description ?? "Konten premium seru untukmu! 🌟"}
        </p>

        {/* Price */}
        {priceDisplay && (
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-sm sm:text-base font-extrabold text-white">{priceDisplay}</span>
            {originalPrice && (
              <span className="text-xs text-white/60 line-through font-medium">{originalPrice}</span>
            )}
          </div>
        )}

        {/* Play button */}
        <Link href={`/videos/${video.id}`}>
          <button className="mt-1 inline-flex items-center gap-1.5 bg-white text-purple-700 font-extrabold text-xs px-4 py-2 rounded-full shadow-md hover:bg-slate-100 transition-colors active:scale-95">
            <Play className="h-3.5 w-3.5 fill-purple-700" />
            Tonton
          </button>
        </Link>
      </div>

      {/* Right: video thumbnail */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-[38%]">
        <div className="relative rounded-2xl overflow-hidden shadow-lg aspect-video bg-purple-900/40 border-2 border-white/30">
          {video.thumbnail ? (
            <img
              src={video.thumbnail}
              alt={video.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-purple-700 to-blue-600 flex items-center justify-center">
              <span className="text-2xl">🎬</span>
            </div>
          )}
          {/* Play overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-9 h-9 bg-white/90 rounded-full flex items-center justify-center shadow-md">
              <Play className="h-4 w-4 fill-purple-700 text-purple-700 translate-x-0.5" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hero Carousel ────────────────────────────────────────────────────────────
function HeroCarousel({ videos }: { videos: Video[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", () => setCurrent(emblaApi.selectedScrollSnap()));
    const timer = setInterval(() => emblaApi.scrollNext(), 4500);
    return () => clearInterval(timer);
  }, [emblaApi]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  if (videos.length === 0) {
    return (
      <div className="mx-4 mt-3 rounded-[28px] overflow-hidden shadow-md">
        <div className="relative h-[220px] sm:h-[250px] bg-gradient-to-br from-purple-600 via-blue-500 to-indigo-400 flex items-center justify-center">
          <div className="text-center text-white">
            <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-2" />
            <p className="text-sm font-bold text-white/80">Memuat konten...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-3 rounded-[28px] overflow-hidden shadow-md relative">
      <div ref={emblaRef} className="overflow-hidden rounded-[28px]">
        <div className="flex">
          {videos.map((video, i) => (
            <HeroSlide key={video.id} video={video} index={i} />
          ))}
        </div>
      </div>

      {/* Prev/Next nav (only when multiple slides) */}
      {videos.length > 1 && (
        <>
          <button
            onClick={scrollPrev}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 h-7 w-7 bg-white/25 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-white/40 transition-all"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={scrollNext}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 h-7 w-7 bg-white/25 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-white/40 transition-all"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {videos.length > 1 && (
        <div className="absolute bottom-3 left-5 z-20 flex gap-1.5">
          {videos.map((_, i) => (
            <button
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              className={`rounded-full transition-all duration-300 ${
                i === current ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_LIMIT);

  const { data: featuredVideos, isLoading: isLoadingHero } = useGetFeaturedVideos();
  const { data: categories } = useListCategories();
  const { data: videosData, isLoading: isLoadingVideos } = useListVideos(
    { categoryId: activeCategoryId ?? undefined, sort: "newest", limit: 100 },
    { query: { queryKey: getListVideosQueryKey({ categoryId: activeCategoryId ?? undefined, sort: "newest", limit: 100 }) } },
  );

  const featuredList = featuredVideos ?? [];
  const allVideos = Array.isArray(videosData?.data) ? videosData.data : [];
  const visibleVideos = allVideos.slice(0, visibleCount);
  const hasMore = visibleCount < allVideos.length;

  const handleCategoryChange = (id: string | null) => {
    setActiveCategoryId(id);
    setVisibleCount(INITIAL_LIMIT);
  };

  return (
    <AppLayout>
      {/* Hero Carousel */}
      <SectionBoundary label="hero">
        {isLoadingHero ? (
          <HeroSkeleton />
        ) : (
          <HeroCarousel videos={featuredList} />
        )}
      </SectionBoundary>

      {/* Produk Video — directly below hero */}
      <div className="mt-4 pb-4">
        <SectionBoundary label="video-grid">
          <section className="mx-4 bg-white rounded-[24px] shadow-sm border border-slate-100 px-4 pt-4 pb-4">
            {/* Section header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shadow-sm">
                  <TrendingUp className="h-4 w-4 text-white" />
                </div>
                <h2 className="text-base font-heading font-extrabold text-slate-800">Produk Video 🎬</h2>
              </div>
              {/* Sort dropdown placeholder (visual only, matching reference) */}
              <button className="flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 hover:bg-slate-100 transition-colors">
                <Flame className="h-3 w-3 text-orange-400" />
                Terpopuler
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            {/* Category Chips */}
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-3 mb-3">
              <button
                onClick={() => handleCategoryChange(null)}
                className={`shrink-0 h-8 px-4 rounded-full text-xs font-extrabold transition-all border ${
                  activeCategoryId === null
                    ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white border-transparent shadow-md shadow-purple-500/25"
                    : "bg-white border-slate-200 text-slate-600 hover:border-purple-200"
                }`}
              >
                Semua
              </button>
              {Array.isArray(categories) && categories.map((cat, i) => {
                const Icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryChange(cat.id)}
                    className={`shrink-0 h-8 px-3 rounded-full text-xs font-extrabold transition-all border flex items-center gap-1.5 ${
                      activeCategoryId === cat.id
                        ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white border-transparent shadow-md shadow-purple-500/25"
                        : "bg-white border-slate-200 text-slate-600 hover:border-purple-200"
                    }`}
                  >
                    <Icon className="h-3 w-3" /> {cat.name}
                  </button>
                );
              })}
            </div>

            {/* Video Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {isLoadingVideos
                ? Array(INITIAL_LIMIT).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
                : visibleVideos.map((video) => (
                    <motion.div
                      key={video.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <VideoCard video={video} />
                    </motion.div>
                  ))}
            </div>

            {/* Empty state */}
            {!isLoadingVideos && allVideos.length === 0 && (
              <div className="py-12 text-center flex flex-col items-center">
                <div className="h-14 w-14 bg-purple-100 rounded-full flex items-center justify-center mb-3">
                  <Rocket className="h-7 w-7 text-purple-500" />
                </div>
                <h3 className="text-base font-heading font-extrabold text-slate-800">Belum ada video nih</h3>
                <p className="text-xs text-slate-500 mt-1 font-medium">Coba kategori lain yuk!</p>
              </div>
            )}

            {/* See More */}
            {!isLoadingVideos && hasMore && (
              <div className="flex justify-center mt-5">
                <Button
                  variant="outline"
                  onClick={() => setVisibleCount((p) => p + LOAD_MORE_STEP)}
                  className="h-10 px-7 rounded-full font-extrabold border-2 border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-400 gap-2 text-xs"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Lihat Lebih Banyak ({allVideos.length - visibleCount} lagi)
                </Button>
              </div>
            )}

            {!isLoadingVideos && !hasMore && allVideos.length > INITIAL_LIMIT && (
              <div className="flex justify-center mt-5">
                <p className="text-xs text-slate-400 font-medium">✓ Semua video sudah ditampilkan</p>
              </div>
            )}
          </section>
        </SectionBoundary>
      </div>
    </AppLayout>
  );
}
