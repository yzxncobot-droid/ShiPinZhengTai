import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Bell } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { fetchHomeFeed, type HomeFeedVideoItem } from "@/lib/home-feed-api";
import { useAuth } from "@/lib/auth";
import { FeedVideo } from "@/components/home-feed/FeedVideo";
import { BottomNav } from "@/components/layout/BottomNav";

/** Number of buffered copies for seamless infinite looping (≥2 videos). */
const COPIES = 3;

export default function Home() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [booted, setBooted] = useState(false);

  const { data: videos, isLoading } = useQuery<HomeFeedVideoItem[]>({
    queryKey: ["home-feed"],
    queryFn: fetchHomeFeed,
    refetchOnWindowFocus: false,
  });

  const list = videos ?? [];
  const hasMultiple = list.length >= 2;
  // For 1 video: render once (no loop). For 2+: render buffered copies.
  const renderList = useMemo(
    () => (hasMultiple ? Array.from({ length: COPIES }, () => list).flat() : list),
    [list, hasMultiple],
  );
  const baseLen = list.length;

  // Start at the middle copy so we can scroll both directions seamlessly.
  useEffect(() => {
    if (!hasMultiple || booted || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop = baseLen * el.clientHeight;
    setBooted(true);
  }, [hasMultiple, baseLen, booted]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const slideH = el.clientHeight;
    if (slideH === 0) return;
    const idx = Math.round(el.scrollTop / slideH);
    setActiveIndex(idx);

    // Seamless loop: when drifting into the buffer copies, jump to the
    // equivalent position in the middle copy (no animation).
    if (hasMultiple) {
      if (idx < baseLen) {
        el.scrollTo({ top: (idx + baseLen) * slideH, behavior: "instant" as ScrollBehavior });
      } else if (idx >= baseLen * 2) {
        el.scrollTo({ top: (idx - baseLen) * slideH, behavior: "instant" as ScrollBehavior });
      }
    }
  }, [hasMultiple, baseLen]);

  // Throttle scroll with rAF
  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      handleScroll();
      rafRef.current = 0;
    });
  }, [handleScroll]);

  const refreshStats = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["home-feed"] });
  }, [queryClient]);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
      {/* ── Header overlay ── */}
      <header
        className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-4"
        style={{ paddingTop: "max(env(safe-area-inset-top), 12px)", paddingBottom: 8 }}
      >
        {/* Logo */}
        <div className="flex flex-col">
          <span
            className="text-2xl font-extrabold tracking-tight leading-none bg-clip-text text-transparent"
            style={{
              fontFamily: "Outfit, sans-serif",
              backgroundImage: "linear-gradient(to right, #FF4D6D, #E156F6)",
            }}
          >
            FUN<span style={{ backgroundImage: "none", color: "#7C3AED" }}>+</span>
          </span>
          <span className="mt-1 inline-block self-start rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-widest text-white" style={{ backgroundColor: "rgba(225,86,246,0.55)" }}>
            Premium Kids Platform
          </span>
        </div>

        {/* Icons */}
        <div className="flex items-center gap-2.5">
          <button onClick={() => setLocation("/search")} className="h-9 w-9 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white">
            <Search className="h-4.5 w-4.5" />
          </button>
          {user && (
            <button onClick={() => setLocation("/notifications")} className="relative h-9 w-9 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white">
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-orange-500" />
            </button>
          )}
          <button onClick={() => setLocation(user ? "/profile" : "/login")} className="h-9 w-9 rounded-full overflow-hidden border-2 border-white/40 bg-black/40">
            <Avatar className="h-full w-full">
              <AvatarImage src={user?.avatar ?? undefined} />
              <AvatarFallback className="h-full w-full text-xs font-bold text-white" style={{ backgroundColor: "#7C3AED" }}>
                {user?.username?.charAt(0).toUpperCase() ?? "Y"}
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
      </header>

      {/* ── Scroll feed ── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full w-full overflow-y-scroll snap-y snap-mandatory feed-scroll"
      >
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-white/70">
              <div className="mx-auto h-10 w-10 rounded-full border-4 border-white/20 border-t-white animate-spin" />
              <p className="mt-3 text-sm font-bold">Memuat video...</p>
            </div>
          </div>
        ) : renderList.length === 0 ? (
          <div className="h-full flex items-center justify-center px-8">
            <div className="text-center text-white">
              <span className="text-5xl block mb-3">🎬</span>
              <p className="text-lg font-extrabold">Selamat Datang di FUN+!</p>
              <p className="text-sm text-white/70 mt-1">Video akan segera hadir. Nantikan ya! 🌟</p>
            </div>
          </div>
        ) : (
          renderList.map((v, i) => (
            <FeedVideo
              key={`${v.id}-${i}`}
              video={v}
              isActive={i === activeIndex}
              preload={Math.abs(i - activeIndex) <= 1}
              onStatsChange={refreshStats}
            />
          ))
        )}
      </div>

      {/* ── Bottom navigation ── */}
      <BottomNav />
    </div>
  );
}
