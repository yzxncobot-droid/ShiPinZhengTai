import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  Gift, Sparkles, Star, Loader2, ShoppingCart, PlayCircle, Heart,
  Share2, Layers, CheckCircle2, ShieldCheck, Zap, Filter,
  X, ChevronRight, Clock, TrendingUp, Award,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListBundles, useGetBundle, usePurchaseBundle, getListBundlesQueryKey } from "@workspace/api-client-react";
import type { Bundle } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

const formatRupiah = (v: number) => `Rp ${v.toLocaleString("id-ID")}`;

const BADGE_STYLES: Record<string, string> = {
  "BEST SELLER": "bg-gradient-to-r from-orange-400 to-red-500 text-white",
  "POPULAR": "bg-gradient-to-r from-purple-500 to-indigo-600 text-white",
  "NEW": "bg-gradient-to-r from-emerald-400 to-teal-500 text-white",
  "VALUE PACK": "bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-900",
};


// ─── Preview Dialog ───────────────────────────────────────────────────────────
function BundlePreviewDialog({ bundleId, onOpenChange }: {
  bundleId: number | null; onOpenChange: (open: boolean) => void;
}) {
  const { data: bundle, isLoading } = useGetBundle(bundleId ?? 0, { query: { enabled: !!bundleId } });

  return (
    <Dialog open={!!bundleId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-0 overflow-hidden">
        {isLoading || !bundle ? (
          <div className="p-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
          </div>
        ) : (
          <>
            <div className="relative h-44 bg-gradient-to-br from-purple-500 to-pink-500">
              {bundle.thumbnail && (
                <img src={bundle.thumbnail} alt={bundle.title} className="absolute inset-0 w-full h-full object-cover opacity-90" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <DialogHeader className="absolute bottom-3 left-4 right-4">
                <DialogTitle className="text-white text-lg font-heading font-extrabold text-left drop-shadow">
                  {bundle.title}
                </DialogTitle>
                <p className="text-white/70 text-xs font-medium">{bundle.videoCount} video dalam bundle</p>
              </DialogHeader>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-500 font-medium mb-4">
                {bundle.description || "Kumpulan video eksklusif dalam satu paket hemat."}
              </p>
              <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider mb-3">Daftar Video</p>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {bundle.videos?.map((v: any) => (
                  <div key={v.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                    <div className="h-10 w-16 rounded-lg bg-slate-200 overflow-hidden shrink-0">
                      {v.thumbnail && <img src={v.thumbnail} alt={v.title} className="h-full w-full object-cover" />}
                    </div>
                    <span className="text-xs font-bold text-slate-700 line-clamp-2">{v.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Bundle Card ──────────────────────────────────────────────────────────────
function BundleCard({
  bundle, onPreview, onBuy, isBuying, wishlist, onWishlist,
}: {
  bundle: Bundle;
  onPreview: (id: number) => void;
  onBuy: (id: number, price: number, title: string) => void;
  isBuying: boolean;
  wishlist: Set<number>;
  onWishlist: (id: number) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.3 }}
      className="bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
      onClick={() => {/* navigate on thumb click handled below */}}
    >
      {/* Horizontal layout: thumb left, content right */}
      <div className="flex">
        {/* Thumbnail */}
        <div className="relative w-36 sm:w-44 shrink-0">
          <div className="h-full min-h-[9rem] bg-gradient-to-br from-purple-500 to-pink-500">
            {bundle.thumbnail && (
              <img src={bundle.thumbnail} alt={bundle.title} className="w-full h-full object-cover opacity-90" />
            )}
          </div>
          {bundle.badge && (
            <span className={`absolute top-2 left-2 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full shadow ${BADGE_STYLES[bundle.badge] ?? "bg-slate-800 text-white"}`}>
              {bundle.badge}
            </span>
          )}
          {bundle.hasPurchased && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="bg-green-500 rounded-full p-2">
                <CheckCircle2 className="h-6 w-6 text-white" />
              </div>
            </div>
          )}
          <span className="absolute bottom-2 left-2 bg-black/60 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-0.5">
            <Layers className="h-2.5 w-2.5" /> {bundle.videoCount}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 flex flex-col min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-heading font-extrabold text-sm text-slate-800 leading-snug line-clamp-2 flex-1">
              {bundle.title}
            </h3>
            <button
              onClick={(e) => { e.stopPropagation(); onWishlist(bundle.id); }}
              className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors"
            >
              <Heart className={`h-4 w-4 ${wishlist.has(bundle.id) ? "fill-red-500 text-red-500" : "text-slate-300"}`} />
            </button>
          </div>

          <p className="text-[11px] text-slate-500 line-clamp-2 font-medium mb-3 flex-1">
            {bundle.description || "Kumpulan video eksklusif dalam satu paket hemat."}
          </p>

          {/* Price row */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-extrabold text-purple-600">{formatRupiah(bundle.price)}</span>
            {bundle.originalPrice && bundle.originalPrice > bundle.price && (
              <span className="text-xs text-slate-400 line-through">{formatRupiah(bundle.originalPrice)}</span>
            )}
            {bundle.discountPercent > 0 && (
              <Badge className="bg-red-100 text-red-600 border-none font-extrabold text-[10px] px-1.5 py-0 rounded-full">
                -{bundle.discountPercent}%
              </Badge>
            )}
          </div>

          {/* Rating stars (decorative) */}
          <div className="flex items-center gap-0.5 mb-3">
            {[1,2,3,4,5].map(s => (
              <Star key={s} className={`h-3 w-3 ${s <= 4 ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
            ))}
            <span className="text-[10px] text-slate-400 ml-1 font-medium">(4.8)</span>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 rounded-xl text-[11px] font-extrabold border-purple-200 text-purple-600 hover:bg-purple-50 flex-1"
              onClick={(e) => { e.stopPropagation(); onPreview(bundle.id); }}
            >
              <PlayCircle className="h-3.5 w-3.5 mr-1" /> Preview
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 rounded-xl text-[11px] font-extrabold bg-gradient-to-br from-pink-500 to-rose-500 text-white border-none shadow-sm flex-1"
              disabled={isBuying || bundle.hasPurchased}
              onClick={(e) => { e.stopPropagation(); onBuy(bundle.id, bundle.price, bundle.title); }}
            >
              {isBuying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
               bundle.hasPurchased ? "Dimiliki ✓" :
               <><ShoppingCart className="h-3.5 w-3.5 mr-1" /> Beli</>}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function BundleSkeleton() {
  return (
    <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden animate-pulse">
      <div className="flex">
        <div className="w-36 sm:w-44 h-40 bg-slate-200 shrink-0" />
        <div className="flex-1 p-4 space-y-3">
          <div className="h-4 bg-slate-200 rounded w-3/4" />
          <div className="h-3 bg-slate-200 rounded w-full" />
          <div className="h-3 bg-slate-200 rounded w-2/3" />
          <div className="h-5 bg-slate-200 rounded w-1/3" />
          <div className="flex gap-2">
            <div className="h-8 bg-slate-200 rounded-xl flex-1" />
            <div className="h-8 bg-slate-200 rounded-xl flex-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BundlesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: bundles, isLoading } = useListBundles();
  const purchaseMutation = usePurchaseBundle();
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [wishlist, setWishlist] = useState<Set<number>>(new Set());
  const [purchasingId, setPurchasingId] = useState<number | null>(null);

  const handleBuy = (id: number, price: number, title: string) => {
    if (!user) { setLocation("/login"); return; }
    if ((user.walletBalance || 0) < price) {
      toast({ title: "Saldo Tidak Cukup", description: "Isi saldo wallet kamu dulu.", variant: "destructive" });
      setLocation("/topup");
      return;
    }
    setPurchasingId(id);
    purchaseMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "🎉 Bundle berhasil dibeli!", description: `"${title}" sudah jadi milikmu selamanya.` });
        queryClient.invalidateQueries({ queryKey: getListBundlesQueryKey() });
        setLocation(`/bundles/${id}`);
      },
      onError: (err: any) => {
        toast({ title: "Yah, gagal 😢", description: err?.message || "Terjadi kesalahan.", variant: "destructive" });
      },
      onSettled: () => setPurchasingId(null),
    });
  };

  const toggleWishlist = (id: number) => {
    setWishlist(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); toast({ title: "Dihapus dari Wishlist" }); }
      else { next.add(id); toast({ title: "❤️ Ditambahkan ke Wishlist" }); }
      return next;
    });
  };

  const list = bundles ?? [];

  return (
    <AppLayout>
      {/* Header Banner */}
      <div className="relative overflow-hidden gradient-funplus-pink pb-6 pt-8 px-4">
        <div className="absolute top-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-pink-300/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

        <div className="relative z-10 max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <Link href="/bundles/my" className="text-[10px] font-extrabold text-white/70 hover:text-white bg-white/15 px-3 py-1 rounded-full transition-colors">
              My Bundles →
            </Link>
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="h-16 w-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-lg shrink-0">
              <Gift className="h-9 w-9 text-white" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-heading font-extrabold text-white leading-tight">
                Video Bundles 🎁
              </h1>
              <p className="text-white/80 text-sm font-medium mt-1">
                Beli sekali, tonton selamanya — konten eksklusif!
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-4 mt-5">
            {[
              { icon: Layers, label: `${list.length} Bundle`, color: "text-yellow-300" },
              { icon: ShieldCheck, label: "Aman & Terpercaya", color: "text-green-300" },
              { icon: Zap, label: "HD Quality", color: "text-blue-300" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 bg-white/15 backdrop-blur rounded-full px-3 py-1.5">
                <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
                <span className="text-white text-[11px] font-bold">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bundle List */}
      <div className="container mx-auto px-4 py-5 max-w-3xl">
        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <BundleSkeleton key={i} />)}
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-20 flex flex-col items-center">
            <div className="h-20 w-20 bg-purple-100 rounded-full flex items-center justify-center mb-4">
              <Gift className="h-10 w-10 text-purple-400" />
            </div>
            <h3 className="text-lg font-heading font-extrabold text-slate-700">Belum Ada Bundle</h3>
            <p className="text-sm text-slate-400 mt-1 font-medium">Bundle akan segera hadir.</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-4">
              {list.map((bundle: Bundle) => (
                <BundleCard
                  key={bundle.id}
                  bundle={bundle}
                  onPreview={setPreviewId}
                  onBuy={handleBuy}
                  isBuying={purchasingId === bundle.id && purchaseMutation.isPending}
                  wishlist={wishlist}
                  onWishlist={toggleWishlist}
                />
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>

      <BundlePreviewDialog bundleId={previewId} onOpenChange={(open) => !open && setPreviewId(null)} />
    </AppLayout>
  );
}
