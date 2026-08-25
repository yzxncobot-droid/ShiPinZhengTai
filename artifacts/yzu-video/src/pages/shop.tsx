import { useGetFeaturedVideos, useListCategories } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { Button } from "@/components/ui/button";
import { Play, Rocket, Star, Music, Gamepad2, Heart, Smile, Cloud, Sparkles, ChevronDown, SlidersHorizontal, Crown } from "lucide-react";
import { Link } from "wouter";
import { useState, Component, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Video } from "@workspace/api-client-react";

/** Lightweight section-level error boundary — renders a quiet fallback instead of crashing the page. */
class SectionBoundary extends Component<{ label: string; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: Error) { console.error(`[SectionBoundary:${this.props.label}]`, e); }
  render() {
    if (this.state.err) {
      return (
        <div className="py-10 text-center text-sm text-slate-400 font-medium">
          Konten ini tidak dapat ditampilkan saat ini.
        </div>
      );
    }
    return this.props.children;
  }
}

const CATEGORY_ICONS = [Star, Rocket, Sparkles, Music, Gamepad2, Heart, Smile, Cloud];

const INITIAL_LIMIT = 6;
const LOAD_MORE_STEP = 4;

// ─── Sort options ────────────────────────────────────────────────────────────
type SortKey = "popular" | "price_low" | "price_high" | "newest" | "views";

const SORT_OPTIONS: { key: SortKey; label: string; sort: string; order: "asc" | "desc" }[] = [
  { key: "popular",   label: "Terpopuler",         sort: "popular",   order: "desc" },
  { key: "newest",    label: "Baru Diupload",      sort: "newest",    order: "desc" },
  { key: "price_low", label: "Harga Terendah",    sort: "price",     order: "asc"  },
  { key: "price_high",label: "Harga Tertinggi",    sort: "price",     order: "desc" },
  { key: "views",     label: "Paling Banyak Ditonton", sort: "views", order: "desc" },
];

const formatRupiah = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

// ─── Module-level state (persists across SPA navigation) ─────────────────────
let persistedVisibleCount = INITIAL_LIMIT;
let persistedCategoryId: string | null = null;
let persistedSort: SortKey = "popular";

export default function ShopPage() {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(persistedCategoryId);
  const [visibleCount, setVisibleCount] = useState(persistedVisibleCount);
  const [sortKey, setSortKey] = useState<SortKey>(persistedSort);

  const { data: featuredVideos } = useGetFeaturedVideos();
  const { data: categories } = useListCategories();

  const sortOption = SORT_OPTIONS.find((s) => s.key === sortKey) ?? SORT_OPTIONS[0];

  // Main video grid — sorted + filtered by category (custom fetch to support price/order)
  const { data: videosData, isLoading: isLoadingVideos } = useQuery<{ data: Video[]; total: number }>({
    queryKey: ["shop-videos", activeCategoryId ?? "all", sortKey],
    queryFn: () =>
      adminFetch<{ data: Video[]; total: number }>(
      `/videos?sort=${sortOption.sort}&order=${sortOption.order}&limit=100${
        activeCategoryId ? `&categoryId=${encodeURIComponent(activeCategoryId)}` : ""
      }`,
      ),
    staleTime: 30_000,
  });

  const heroVideo = featuredVideos?.[0];
  const allVideos = Array.isArray(videosData?.data) ? videosData.data : [];
  const visibleVideos = allVideos.slice(0, visibleCount);
  const hasMore = visibleCount < allVideos.length;

  const handleSeeMore = () => {
    const next = visibleCount + LOAD_MORE_STEP;
    setVisibleCount(next);
    persistedVisibleCount = next;
  };

  const handleCategoryChange = (id: string | null) => {
    setActiveCategoryId(id);
    persistedCategoryId = id;
    setVisibleCount(INITIAL_LIMIT);
    persistedVisibleCount = INITIAL_LIMIT;
  };

  const handleSortChange = (key: SortKey) => {
    setSortKey(key);
    persistedSort = key;
    setVisibleCount(INITIAL_LIMIT);
    persistedVisibleCount = INITIAL_LIMIT;
  };

  return (
    <AppLayout>
      {/* ─── Featured Hero Banner (compact, matches design proportions) ─── */}
      <section className="px-4 pt-4">
        <div className="relative w-full overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 shadow-xl">
          {/* Decorative clouds & stars */}
          <Star className="absolute top-5 right-[18%] h-6 w-6 text-yellow-300 fill-yellow-300 drop-shadow-md rotate-12" />
          <Star className="absolute top-12 left-[40%] h-3.5 w-3.5 text-white/70 fill-white/70" />
          <Cloud className="absolute bottom-6 left-[8%] h-8 w-8 text-white/30 fill-white/30" />
          <Cloud className="absolute top-8 left-[6%] h-6 w-6 text-white/20 fill-white/20" />
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-10 left-1/3 w-40 h-40 bg-pink-500/20 rounded-full blur-3xl" />

          {heroVideo ? (
            <div className="relative z-10 flex items-stretch gap-2 p-4 sm:p-6">
              {/* Left: text content */}
              <div className="flex-1 flex flex-col justify-center min-w-0 space-y-2.5">
                <span className="inline-flex w-max items-center gap-1 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full shadow-md">
                  <Crown className="h-3 w-3" /> POPULAR
                </span>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-white leading-tight drop-shadow-md line-clamp-2">
                  {heroVideo.title}
                </h1>
                <p className="text-xs sm:text-sm text-white/90 line-clamp-2 font-medium max-w-xs">
                  {heroVideo.description || "Serunya belajar sambil bermain!"}
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <Link href={`/videos/${heroVideo.id}`}>
                    <Button size="sm" className="h-9 px-4 font-extrabold rounded-full bg-white text-purple-700 hover:bg-slate-100 shadow-lg shadow-black/10">
                      <Play className="mr-1.5 h-4 w-4 fill-purple-700" /> Tonton
                    </Button>
                  </Link>
                  {heroVideo.price ? (
                    <span className="text-base font-extrabold text-white drop-shadow">
                      {formatRupiah(heroVideo.price)}
                    </span>
                  ) : (
                    <span className="text-sm font-extrabold text-white drop-shadow">Gratis</span>
                  )}
                </div>
              </div>

              {/* Right: thumbnail */}
              <Link href={`/videos/${heroVideo.id}`} className="relative shrink-0 w-28 sm:w-40 md:w-48 aspect-video rounded-2xl overflow-hidden shadow-2xl ring-2 ring-white/30 self-center">
                {heroVideo.thumbnail ? (
                  <img src={heroVideo.thumbnail} alt={heroVideo.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/20">
                    <Play className="h-8 w-8 text-white" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                  <Play className="h-4 w-4 text-purple-600 fill-purple-600 ml-0.5" />
                </div>
              </Link>
            </div>
          ) : (
            <div className="relative z-10 h-32 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full border-4 border-white border-t-transparent animate-spin" />
            </div>
          )}

          {/* Carousel dots */}
          <div className="relative z-10 flex items-center gap-1.5 px-5 pb-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === 0 ? "w-5 bg-white" : "w-1.5 bg-white/40"}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ─── Main Content ─── */}
      <div className="container mx-auto px-4 py-6 space-y-5">

        {/* Filter section heading + sort dropdown */}
        <SectionBoundary label="video-grid">
          <section>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-800">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-100">
                  <Play className="h-4 w-4 text-purple-600 fill-purple-600" />
                </span>
                Produk Video
              </h2>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 shadow-sm hover:border-purple-200 hover:text-purple-600 transition-colors">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {sortOption.label}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {SORT_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.key}
                      onClick={() => handleSortChange(opt.key)}
                      className={`cursor-pointer justify-between rounded-lg text-xs font-bold ${
                        sortKey === opt.key ? "text-purple-600 bg-purple-50" : "text-slate-600"
                      }`}
                    >
                      {opt.label}
                      {sortKey === opt.key && <span className="h-2 w-2 rounded-full bg-purple-500" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Horizontal category chips */}
            <ScrollArea className="w-full whitespace-nowrap pb-3">
              <div className="flex w-max space-x-2 px-1 mb-4">
                <Button
                  variant={activeCategoryId === null ? "default" : "outline"}
                  className={`rounded-full h-9 px-5 text-xs font-extrabold transition-all ${
                    activeCategoryId === null
                      ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white border-none shadow-md shadow-purple-500/30'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-purple-600'
                  }`}
                  onClick={() => handleCategoryChange(null)}
                >
                  Semua
                </Button>
                {Array.isArray(categories) && categories.map((cat, i) => {
                  const Icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
                  return (
                    <Button
                      key={cat.id}
                      variant={activeCategoryId === cat.id ? "default" : "outline"}
                      className={`rounded-full h-9 px-4 text-xs font-extrabold transition-all ${
                        activeCategoryId === cat.id
                          ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white border-none shadow-md shadow-purple-500/30'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-purple-600'
                      }`}
                      onClick={() => handleCategoryChange(cat.id)}
                    >
                      <Icon className="mr-1.5 h-3.5 w-3.5" /> {cat.name}
                    </Button>
                  );
                })}
              </div>
              <ScrollBar orientation="horizontal" className="hidden" />
            </ScrollArea>

            {/* Video Grid — 2 cols on mobile, responsive on desktop */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 md:gap-6 px-1">
              {isLoadingVideos
                ? Array(INITIAL_LIMIT).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
                : visibleVideos.map((video) => (
                    <VideoCard key={video.id} video={video} />
                  ))}
            </div>

            {/* Empty state */}
            {!isLoadingVideos && allVideos.length === 0 && (
              <div className="py-16 text-center flex flex-col items-center bg-white rounded-3xl border border-slate-100 mx-2 mt-4 shadow-sm">
                <div className="h-16 w-16 bg-purple-100 rounded-full flex items-center justify-center mb-3">
                  <Rocket className="h-8 w-8 text-purple-500" />
                </div>
                <h3 className="text-lg font-extrabold text-slate-800">Belum ada video nih</h3>
                <p className="text-sm font-medium text-slate-500 mt-1">Coba kategori atau sort lain yuk!</p>
              </div>
            )}

            {/* See More button */}
            {!isLoadingVideos && hasMore && (
              <div className="flex justify-center mt-7">
                <Button
                  onClick={handleSeeMore}
                  className="h-11 px-7 rounded-full font-extrabold bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-500/30 gap-2"
                >
                  <ChevronDown className="h-4 w-4" />
                  Lihat Produk Lainnya
                </Button>
              </div>
            )}

            {/* All loaded indicator */}
            {!isLoadingVideos && !hasMore && allVideos.length > INITIAL_LIMIT && (
              <div className="flex justify-center mt-7">
                <p className="text-sm font-medium text-slate-400">Semua video sudah ditampilkan</p>
              </div>
            )}
          </section>
        </SectionBoundary>

      </div>
    </AppLayout>
  );
}
