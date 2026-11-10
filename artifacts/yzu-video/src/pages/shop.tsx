import { AppLayout } from "@/components/layout/AppLayout";
import { ShopProductCard, ShopVideo } from "@/components/video/ShopProductCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Rocket, Star, Music, Gamepad2, Heart, Smile, Cloud, Sparkles,
  ChevronDown, Search, Plus, Wallet, Flame, Sparkle, Tag
} from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useAuth } from "@/lib/auth";
import { useGetMe } from "@workspace/api-client-react";

const INITIAL_LIMIT = 8;
const LOAD_MORE_STEP = 6;

type FilterTab = "all" | "popular" | "newest" | "promo";

export default function ShopPage() {
  const { user: authUser } = useAuth();
  const { data: freshUser, refetch: refetchUser } = useGetMe();
  const currentUser = freshUser || authUser;

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_LIMIT);

  // Main video grid query
  const { data: videosData, isLoading: isLoadingVideos, refetch: refetchVideos } = useQuery<{ data: ShopVideo[]; total: number }>({
    queryKey: ["shop-videos", activeTab, searchQuery],
    queryFn: async () => {
      let sort = "createdAt";
      let order = "desc";

      if (activeTab === "popular") {
        sort = "views";
        order = "desc";
      } else if (activeTab === "newest") {
        sort = "createdAt";
        order = "desc";
      }

      let url = `/videos?displayOn=Shop&sort=${sort}&order=${order}&limit=100`;
      if (searchQuery.trim()) {
        url += `&search=${encodeURIComponent(searchQuery.trim())}`;
      }

      const res = await adminFetch<{ data: ShopVideo[]; total: number }>(url);
      let list = Array.isArray(res?.data) ? res.data : [];

      if (activeTab === "promo") {
        list = list.filter((v) => (v.discountPercent && v.discountPercent > 0) || (v.originalPrice && v.price && v.price < v.originalPrice));
      }

      return { data: list, total: list.length };
    },
    staleTime: 10_000,
  });

  const allVideos = videosData?.data || [];
  const visibleVideos = allVideos.slice(0, visibleCount);
  const hasMore = visibleCount < allVideos.length;

  const handlePurchased = () => {
    refetchUser();
    refetchVideos();
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-4 max-w-4xl space-y-4">
        {/* Top Header: Balance Pill & Top Up Action */}
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-indigo-500/10 p-3.5 sm:p-4 rounded-3xl border border-purple-100 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-purple-500/20">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Saldo Saya</p>
              <p className="text-base sm:text-lg font-black text-slate-800 leading-tight">
                Rp {(currentUser?.walletBalance ?? 0).toLocaleString("id-ID")}
              </p>
            </div>
          </div>

          <Link href="/topup">
            <Button
              size="sm"
              className="h-9 px-4 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold text-xs shadow-md shadow-purple-500/20 gap-1.5 transition-transform active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" /> Top Up
            </Button>
          </Link>
        </div>

        {/* Search Bar matching reference */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-400" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setVisibleCount(INITIAL_LIMIT);
            }}
            placeholder="Cari video favoritmu..."
            className="w-full h-12 pl-11 pr-4 rounded-2xl bg-white border border-purple-100/80 shadow-sm focus-visible:ring-purple-400 text-xs sm:text-sm placeholder:text-slate-400"
          />
        </div>

        {/* Quick Filter Tabs matching Reference 1 (Semua, Populer, Baru, Promo) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: "all", label: "Semua", icon: Sparkles },
            { id: "popular", label: "Populer", icon: Flame },
            { id: "newest", label: "Baru", icon: Sparkle },
            { id: "promo", label: "Promo", icon: Tag },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as FilterTab);
                  setVisibleCount(INITIAL_LIMIT);
                }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-extrabold transition-all shrink-0 ${
                  isActive
                    ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/25"
                    : "bg-white text-slate-600 border border-purple-100 hover:bg-purple-50/60"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? "text-white" : "text-purple-500"}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Product Grid (2 columns on mobile, 3-4 on tablet/desktop) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 pt-1">
          {isLoadingVideos
            ? Array(6)
                .fill(0)
                .map((_, i) => (
                  <div key={i} className="flex flex-col p-3 bg-white rounded-3xl border border-slate-100 animate-pulse space-y-3">
                    <div className="w-full aspect-video rounded-2xl bg-slate-200" />
                    <div className="space-y-2">
                      <div className="h-4 bg-slate-200 rounded w-4/5" />
                      <div className="h-3 bg-slate-200 rounded w-1/2" />
                      <div className="h-4 bg-slate-200 rounded w-2/3" />
                    </div>
                  </div>
                ))
            : visibleVideos.map((video) => (
                <ShopProductCard
                  key={video.id}
                  video={video}
                  onPurchased={handlePurchased}
                />
              ))}
        </div>

        {/* Empty state */}
        {!isLoadingVideos && allVideos.length === 0 && (
          <div className="py-16 text-center flex flex-col items-center bg-white rounded-3xl border border-purple-100/60 mx-1 shadow-sm">
            <div className="h-16 w-16 bg-purple-50 text-purple-500 rounded-full flex items-center justify-center mb-3">
              <Rocket className="h-8 w-8" />
            </div>
            <h3 className="text-base font-extrabold text-slate-800">Tidak ada produk ditemukan</h3>
            <p className="text-xs font-medium text-slate-500 mt-1 max-w-xs">
              Coba kata kunci lain atau pilih kategori tab yang berbeda yuk!
            </p>
          </div>
        )}

        {/* Load More Button */}
        {!isLoadingVideos && hasMore && (
          <div className="flex justify-center pt-2 pb-6">
            <Button
              onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_STEP)}
              className="h-10 px-6 rounded-full font-extrabold text-xs bg-white text-purple-600 border border-purple-200 hover:bg-purple-50 shadow-sm gap-2"
            >
              <ChevronDown className="h-4 w-4" />
              Lihat Lebih Banyak
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
