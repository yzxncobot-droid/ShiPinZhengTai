import {
  useGetFeaturedVideos, useListVideos, useListCategories,
  getListVideosQueryKey, useListBundles,
} from "@workspace/api-client-react";
import type { Video, Bundle } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState, useEffect, useMemo, useCallback, Component, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
import {
  Play, Gift, Wallet, MessageCircle, Heart, History, Tag, Award, Search,
  ChevronRight, Star, Flame, Sparkles, Eye, TrendingUp, ChevronLeft,
  Layers, ChevronDown, Loader2, Rocket, Cloud, Smile,
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

const QUICK_MENU = [
  { icon: Gift, label: "Bundle", href: "/bundles", from: "from-pink-500", to: "to-rose-400" },
  { icon: Wallet, label: "Top Up", href: "/topup", from: "from-amber-500", to: "to-orange-400" },
  { icon: MessageCircle, label: "Chat", href: "/chat", from: "from-blue-500", to: "to-sky-400" },
  { icon: Heart, label: "Favorit", href: "/search", from: "from-red-500", to: "to-pink-400" },
  { icon: History, label: "Riwayat", href: "/history", from: "from-violet-500", to: "to-purple-400" },
  { icon: Tag, label: "Promo", href: "/subscriptions", from: "from-emerald-500", to: "to-green-400" },
  { icon: Award, label: "Badge", href: "/leaderboard", from: "from-yellow-500", to: "to-amber-400" },
  { icon: Search, label: "Cari", href: "/search", from: "from-cyan-500", to: "to-blue-400" },
];

const PROMO_TEXTS = [
  "🔥 Video Terbaru Sudah Upload! Yuk Tonton Sekarang",
  "⭐ Bundle Eksklusif Diskon 30%! Beli Sekarang",
  "🎉 Daftar Premium & Nikmati Semua Video Tanpa Batas",
  "🚀 Top Up Wallet Sekarang & Dapatkan Bonus Koin",
  "✨ Konten Baru Setiap Hari — Jangan Sampai Ketinggalan!",
];

const INITIAL_LIMIT = 6;
const LOAD_MORE_STEP = 4;

const formatRupiah = (v: number) => `Rp ${v.toLocaleString("id-ID")}`;

// ─── Hero Carousel ───────────────────────────────────────────────────────────
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
      <section className="relative w-full min-h-[60vh] gradient-funplus overflow-hidden rounded-b-[40px] flex items-center justify-center">
        <div className="absolute top-10 left-10 w-32 h-32 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-48 h-48 bg-pink-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-[20%] animate-float">
          <Star className="h-10 w-10 text-yellow-300 fill-yellow-300 drop-shadow-lg" />
        </div>
        <div className="absolute bottom-1/3 right-[15%] animate-float" style={{ animationDelay: "1s" }}>
          <Rocket className="h-12 w-12 text-white/70 drop-shadow-lg" />
        </div>
        <div className="text-center text-white relative z-10 p-8">
          <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="font-bold text-white/80 text-lg">Memuat konten...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative w-full overflow-hidden rounded-b-[40px] shadow-2xl">
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex">
          {videos.map((video, i) => (
            <div key={video.id} className="relative flex-none w-full min-h-[62vh] md:min-h-[72vh]">
              {/* Background */}
              <div className="absolute inset-0 gradient-funplus" />
              {video.thumbnail && (
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay"
                />
              )}
              {/* Decorative blobs */}
              <div className="absolute top-10 left-10 w-32 h-32 bg-white/10 rounded-full blur-3xl" />
              <div className="absolute bottom-10 right-10 w-48 h-48 bg-pink-500/20 rounded-full blur-3xl" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Floating deco */}
              <div className="absolute top-14 right-[12%] animate-float pointer-events-none">
                <Star className="h-10 w-10 text-yellow-300 fill-yellow-300 drop-shadow-lg" />
              </div>
              <div className="absolute bottom-28 left-[8%] animate-float pointer-events-none" style={{ animationDelay: "1.5s" }}>
                <Rocket className="h-12 w-12 text-white/60 drop-shadow-lg" />
              </div>

              {/* Content */}
              <div className="relative z-10 h-full container mx-auto px-5 flex flex-col justify-end pb-20 md:pb-28">
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="max-w-xl space-y-3"
                >
                  <div className="flex gap-2 flex-wrap">
                    <Badge className="bg-gradient-to-r from-orange-400 to-pink-500 text-white border-none font-extrabold px-3 py-1 rounded-full shadow-lg text-xs">
                      🔥 POPULAR
                    </Badge>
                    {i === 0 && (
                      <Badge className="bg-gradient-to-r from-blue-400 to-cyan-400 text-white border-none font-extrabold px-3 py-1 rounded-full shadow-lg text-xs">
                        ✨ BARU
                      </Badge>
                    )}
                  </div>
                  <h1 className="text-3xl md:text-5xl font-heading font-extrabold text-white leading-tight drop-shadow-lg line-clamp-2">
                    {video.title}
                  </h1>
                  <p className="text-sm md:text-base text-white/80 line-clamp-2 font-medium max-w-lg">
                    {video.description}
                  </p>
                  <div className="flex gap-3 pt-1">
                    <Link href={`/videos/${video.id}`}>
                      <Button size="lg" className="h-12 px-7 font-extrabold rounded-full bg-white text-purple-700 hover:bg-slate-100 shadow-xl shadow-black/20 gap-2 ripple-btn">
                        <Play className="h-5 w-5 fill-purple-700" /> Tonton
                      </Button>
                    </Link>
                    <Link href="/bundles">
                      <Button size="lg" variant="outline" className="h-12 px-7 font-extrabold rounded-full border-white/50 text-white bg-white/10 backdrop-blur hover:bg-white/20 gap-2 ripple-btn">
                        <Gift className="h-4 w-4" /> Bundle
                      </Button>
                    </Link>
                  </div>
                </motion.div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Prev/Next buttons */}
      {videos.length > 1 && (
        <>
          <button onClick={scrollPrev} className="absolute left-3 top-1/2 -translate-y-1/2 z-20 h-9 w-9 bg-white/20 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={scrollNext} className="absolute right-3 top-1/2 -translate-y-1/2 z-20 h-9 w-9 bg-white/20 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all">
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* Dots indicator */}
      {videos.length > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
          {videos.map((_, i) => (
            <button
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              className={`rounded-full transition-all duration-300 ${i === current ? "w-6 h-2 bg-white" : "w-2 h-2 bg-white/40"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Quick Menu ───────────────────────────────────────────────────────────────
function QuickMenu() {
  return (
    <section className="px-4 py-4">
      <div className="grid grid-cols-4 gap-3">
        {QUICK_MENU.map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
          >
            <Link href={item.href} className="flex flex-col items-center gap-1.5 ripple-btn">
              <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${item.from} ${item.to} flex items-center justify-center shadow-md`}>
                <item.icon className="h-7 w-7 text-white" />
              </div>
              <span className="text-[10px] font-extrabold text-slate-600">{item.label}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── Promo Ticker ─────────────────────────────────────────────────────────────
function PromoTicker() {
  const text = PROMO_TEXTS.join("   •   ");
  return (
    <div className="bg-gradient-to-r from-[#7C3AED] via-[#9333EA] to-[#EC4899] py-2.5 overflow-hidden">
      <div className="flex animate-marquee whitespace-nowrap">
        <span className="text-white text-xs font-bold px-4">{text}</span>
        <span className="text-white text-xs font-bold px-4">{text}</span>
      </div>
    </div>
  );
}

// ─── Video Mini Card (horizontal sections) ───────────────────────────────────
function VideoMiniCard({ video }: { video: Video }) {
  return (
    <Link href={`/videos/${video.id}`} className="group shrink-0 w-36 sm:w-40">
      <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-200 shadow-sm">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-200 to-pink-200 flex items-center justify-center">
            <Play className="h-8 w-8 text-purple-400" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {video.type === "premium" && (
          <div className="absolute top-2 left-2 bg-amber-400 text-[8px] font-extrabold px-2 py-0.5 rounded-full text-white shadow">PREMIUM</div>
        )}
        <div className="absolute top-2 right-2 bg-white/90 backdrop-blur rounded-full p-1.5 shadow-sm group-hover:scale-110 transition-transform">
          <Play className="h-2.5 w-2.5 text-purple-600 fill-purple-600 ml-px" />
        </div>
        <div className="absolute bottom-2 left-2 right-2">
          <p className="text-white text-[11px] font-bold line-clamp-2 leading-tight">{video.title}</p>
        </div>
      </div>
      <div className="mt-1.5 px-0.5">
        <div className="flex items-center gap-1">
          <Eye className="h-3 w-3 text-slate-400" />
          <span className="text-[10px] text-slate-400 font-medium">{(video.views ?? 0).toLocaleString()}</span>
        </div>
      </div>
    </Link>
  );
}

// ─── Bundle Mini Card (horizontal sections) ──────────────────────────────────
function BundleMiniCard({ bundle }: { bundle: Bundle }) {
  return (
    <Link href={`/bundles/${bundle.id}`} className="group shrink-0 w-52">
      <div className="relative h-32 rounded-2xl overflow-hidden shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-500" />
        {bundle.thumbnail && (
          <img src={bundle.thumbnail} alt={bundle.title} className="absolute inset-0 w-full h-full object-cover opacity-80" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
        {bundle.badge && (
          <span className="absolute top-2 left-2 text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-orange-400 text-white shadow">{bundle.badge}</span>
        )}
        {bundle.hasPurchased && (
          <span className="absolute top-2 right-2 text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-green-500 text-white shadow">✓ Milik</span>
        )}
        <div className="absolute bottom-2 left-2 right-2">
          <p className="text-white text-xs font-extrabold line-clamp-1">{bundle.title}</p>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-white/70 text-[9px]">
              <Layers className="h-2.5 w-2.5 inline mr-0.5" />{bundle.videoCount} video
            </span>
            <span className="text-yellow-300 text-[10px] font-extrabold">{formatRupiah(bundle.price)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Horizontal Section ───────────────────────────────────────────────────────
function HorizontalSection({ title, icon: Icon, children, href }: {
  title: string; icon: React.ElementType; children: ReactNode; href?: string;
}) {
  return (
    <section className="py-2">
      <div className="flex items-center justify-between px-4 mb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-sm">
            <Icon className="h-4 w-4 text-white" />
          </div>
          <h2 className="text-base font-heading font-extrabold text-slate-800">{title}</h2>
        </div>
        {href && (
          <Link href={href} className="flex items-center gap-0.5 text-[11px] font-bold text-purple-600 hover:text-purple-800">
            Lihat Semua <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="flex gap-3 px-4 overflow-x-auto hide-scrollbar pb-2 snap-scroll">
        {children}
      </div>
    </section>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_LIMIT);

  const { data: featuredVideos } = useGetFeaturedVideos();
  const { data: categories } = useListCategories();
  const { data: videosData, isLoading: isLoadingVideos } = useListVideos(
    { categoryId: activeCategoryId ?? undefined, sort: "newest", limit: 100 },
    { query: { queryKey: getListVideosQueryKey({ categoryId: activeCategoryId ?? undefined, sort: "newest", limit: 100 }) } },
  );
  const { data: bundles } = useListBundles();

  const featuredList = featuredVideos ?? [];
  const allVideos = Array.isArray(videosData?.data) ? videosData.data : [];
  const trendingVideos = useMemo(() =>
    [...allVideos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 10),
    [allVideos]);
  const newestVideos = allVideos.slice(0, 10);
  const visibleVideos = allVideos.slice(0, visibleCount);
  const hasMore = visibleCount < allVideos.length;
  const bundleList = bundles ?? [];

  const handleCategoryChange = (id: string | null) => {
    setActiveCategoryId(id);
    setVisibleCount(INITIAL_LIMIT);
  };

  return (
    <AppLayout>
      {/* Hero Carousel */}
      <SectionBoundary label="hero">
        <HeroCarousel videos={featuredList} />
      </SectionBoundary>

      {/* Quick Menu */}
      <QuickMenu />

      {/* Promo Ticker */}
      <PromoTicker />

      <div className="space-y-2 pb-4">
        {/* Trending Videos */}
        {trendingVideos.length > 0 && (
          <SectionBoundary label="trending">
            <HorizontalSection title="🔥 Trending" icon={Flame} href="/search">
              {trendingVideos.map((v) => <VideoMiniCard key={v.id} video={v} />)}
            </HorizontalSection>
          </SectionBoundary>
        )}

        {/* Baru Upload */}
        {newestVideos.length > 0 && (
          <SectionBoundary label="newest">
            <HorizontalSection title="✨ Baru Upload" icon={Sparkles} href="/search">
              {newestVideos.map((v) => <VideoMiniCard key={v.id} video={v} />)}
            </HorizontalSection>
          </SectionBoundary>
        )}

        {/* Bundle Terlaris */}
        {bundleList.length > 0 && (
          <SectionBoundary label="bundles">
            <HorizontalSection title="🎁 Bundle Terlaris" icon={Gift} href="/bundles">
              {bundleList.slice(0, 8).map((b) => <BundleMiniCard key={b.id} bundle={b as Bundle} />)}
            </HorizontalSection>
          </SectionBoundary>
        )}

        {/* Divider */}
        <div className="px-4 pt-2">
          <div className="h-px bg-gradient-to-r from-transparent via-purple-200 to-transparent" />
        </div>

        {/* Category Filter + Main Grid */}
        <SectionBoundary label="video-grid">
          <section className="px-4 pt-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shadow-sm">
                  <TrendingUp className="h-4 w-4 text-white" />
                </div>
                <h2 className="text-base font-heading font-extrabold text-slate-800">Produk Video 🎬</h2>
              </div>
            </div>

            {/* Category Chips */}
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-3 mb-4">
              <button
                onClick={() => handleCategoryChange(null)}
                className={`shrink-0 h-9 px-5 rounded-full text-xs font-extrabold transition-all border ${
                  activeCategoryId === null
                    ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white border-transparent shadow-md shadow-purple-500/30"
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
                    className={`shrink-0 h-9 px-4 rounded-full text-xs font-extrabold transition-all border flex items-center gap-1.5 ${
                      activeCategoryId === cat.id
                        ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white border-transparent shadow-md shadow-purple-500/30"
                        : "bg-white border-slate-200 text-slate-600 hover:border-purple-200"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {cat.name}
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
              <div className="py-16 text-center flex flex-col items-center bg-white rounded-3xl border border-slate-100 mt-4 shadow-sm">
                <div className="h-16 w-16 bg-purple-100 rounded-full flex items-center justify-center mb-3">
                  <Rocket className="h-8 w-8 text-purple-500" />
                </div>
                <h3 className="text-lg font-heading font-extrabold text-slate-800">Belum ada video nih</h3>
                <p className="text-sm text-slate-500 mt-1 font-medium">Coba kategori lain yuk!</p>
              </div>
            )}

            {/* See More */}
            {!isLoadingVideos && hasMore && (
              <div className="flex justify-center mt-6">
                <Button
                  variant="outline"
                  onClick={() => setVisibleCount((p) => p + LOAD_MORE_STEP)}
                  className="h-11 px-8 rounded-full font-extrabold border-2 border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-400 gap-2"
                >
                  <ChevronDown className="h-4 w-4" />
                  Lihat Lebih Banyak ({allVideos.length - visibleCount} lagi)
                </Button>
              </div>
            )}

            {!isLoadingVideos && !hasMore && allVideos.length > INITIAL_LIMIT && (
              <div className="flex justify-center mt-6">
                <p className="text-sm text-slate-400 font-medium">✓ Semua video sudah ditampilkan</p>
              </div>
            )}
          </section>
        </SectionBoundary>
      </div>
    </AppLayout>
  );
}
