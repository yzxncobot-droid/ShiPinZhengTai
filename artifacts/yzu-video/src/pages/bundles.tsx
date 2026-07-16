import { useState } from "react";
import { useLocation } from "wouter";
import {
  Gift, Sparkles, Star, Loader2, ShoppingCart, PlayCircle, X,
  ShieldCheck, Zap, Layers, CheckCircle2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useListBundles, useGetBundle, usePurchaseBundle, getListBundlesQueryKey } from "@workspace/api-client-react";
import type { Bundle } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const formatRupiah = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

const BADGE_STYLES: Record<string, string> = {
  "BEST SELLER": "bg-gradient-to-r from-orange-400 to-red-500 text-white",
  "POPULAR": "bg-gradient-to-r from-purple-500 to-indigo-600 text-white",
  "NEW": "bg-gradient-to-r from-emerald-400 to-teal-500 text-white",
  "VALUE PACK": "bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-900",
};

const FEATURES = [
  { icon: PlayCircle, label: "Tonton Selamanya" },
  { icon: ShieldCheck, label: "Aman untuk Anak" },
  { icon: Zap, label: "Kualitas HD" },
  { icon: Layers, label: "Akses Semua Video" },
];

function BundlePreviewDialog({ bundleId, onOpenChange }: { bundleId: number | null; onOpenChange: (open: boolean) => void }) {
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
            <div className="relative h-40 bg-gradient-to-br from-purple-500 to-pink-500">
              {bundle.thumbnail && (
                <img src={bundle.thumbnail} alt={bundle.title} className="absolute inset-0 w-full h-full object-cover opacity-90" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <DialogHeader className="absolute bottom-3 left-4 right-4">
                <DialogTitle className="text-white text-lg font-heading font-extrabold text-left drop-shadow">{bundle.title}</DialogTitle>
              </DialogHeader>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-500 font-medium mb-4">{bundle.description || "Kumpulan video eksklusif dalam satu paket hemat."}</p>
              <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider mb-2">{bundle.videoCount} Video dalam bundle ini</p>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {bundle.videos?.map((v: any) => (
                  <div key={v.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-2.5">
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

export default function BundlesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: bundles, isLoading } = useListBundles();
  const purchaseMutation = usePurchaseBundle();
  const [previewId, setPreviewId] = useState<number | null>(null);

  const handleBuy = (id: number, price: number, title: string) => {
    if (!user) {
      setLocation("/login");
      return;
    }
    if ((user.walletBalance || 0) < price) {
      toast({
        title: "Saldo Tidak Cukup",
        description: "Isi saldo wallet kamu dulu untuk membeli bundle ini.",
        variant: "destructive",
      });
      setLocation("/topup");
      return;
    }
    purchaseMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "🎉 Bundle berhasil dibeli!", description: `"${title}" sudah jadi milikmu selamanya.` });
        queryClient.invalidateQueries({ queryKey: getListBundlesQueryKey() });
        setLocation(`/bundles/${id}`);
      },
      onError: (err: any) => {
        toast({ title: "Yah, gagal 😢", description: err?.message || "Terjadi kesalahan saat membeli bundle.", variant: "destructive" });
      },
    });
  };

  const list = bundles ?? [];

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-10 md:py-14">
        <div className="flex justify-end mb-2 max-w-4xl mx-auto">
          <button
            onClick={() => setLocation("/bundles/my")}
            className="text-xs font-extrabold text-purple-600 hover:text-purple-800 flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-50 hover:bg-purple-100 transition-colors"
          >
            My Bundles →
          </button>
        </div>

        <div className="text-center max-w-2xl mx-auto mb-10 relative">
          <Star className="absolute -top-4 left-4 h-8 w-8 text-yellow-400 fill-yellow-400 transform -rotate-12 opacity-80" />
          <Sparkles className="absolute top-2 right-6 h-6 w-6 text-pink-400 opacity-80" />

          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-400 to-rose-500 shadow-lg shadow-pink-500/20 mb-4 transform -rotate-3">
            <Gift className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight text-slate-800 mb-3">
            Video Bundles 🎁
          </h1>
          <p className="text-sm md:text-base font-medium text-slate-500">
            Paket hemat berisi beberapa video eksklusif. Beli sekali, tonton selamanya — bundle ini cuma bisa dibuka lewat pembelian, bukan langganan.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-72 rounded-3xl bg-white border border-slate-100 animate-pulse shadow-sm" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-16 text-slate-400 font-medium">
            <Gift className="h-10 w-10 mx-auto mb-3 opacity-30" />
            Belum ada bundle yang tersedia saat ini.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {list.map((bundle: Bundle) => (
              <div
                key={bundle.id}
                className="relative flex flex-col rounded-3xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden cursor-pointer"
                onClick={() => setLocation(`/bundles/${bundle.id}`)}
              >
                {/* Thumbnail */}
                <div className="relative h-40 bg-gradient-to-br from-purple-500 to-pink-500">
                  {bundle.thumbnail && (
                    <img src={bundle.thumbnail} alt={bundle.title} className="absolute inset-0 w-full h-full object-cover" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-transparent" />
                  {bundle.badge && (
                    <span className={`absolute top-3 left-3 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-md ${BADGE_STYLES[bundle.badge] ?? "bg-slate-800 text-white"}`}>
                      {bundle.badge}
                    </span>
                  )}
                  <span className="absolute bottom-3 right-3 bg-black/60 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
                    <Layers className="h-3 w-3" /> {bundle.videoCount} Video
                  </span>
                  {bundle.hasPurchased && (
                    <span className="absolute bottom-3 left-3 bg-green-500 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Sudah Dimiliki
                    </span>
                  )}
                </div>

                <div className="p-5 flex-1 flex flex-col">
                  <h3 className="font-heading font-extrabold text-lg text-slate-800 mb-1 leading-snug">{bundle.title}</h3>
                  <p className="text-xs font-medium text-slate-500 mb-4 line-clamp-2">{bundle.description || "Kumpulan video eksklusif dalam satu paket hemat."}</p>

                  <div className="flex items-end justify-between bg-slate-50 p-3 rounded-2xl mb-4 border border-slate-100">
                    <div>
                      <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">Harga Bundle</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xl font-extrabold text-purple-600">{formatRupiah(bundle.price)}</p>
                        {bundle.originalPrice && bundle.originalPrice > bundle.price && (
                          <p className="text-xs font-bold text-slate-400 line-through">{formatRupiah(bundle.originalPrice)}</p>
                        )}
                      </div>
                    </div>
                    {bundle.discountPercent > 0 && (
                      <Badge className="bg-red-100 text-red-600 border-none font-extrabold">-{bundle.discountPercent}%</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 mb-5">
                    {FEATURES.map((f) => (
                      <div key={f.label} className="flex flex-col items-center text-center gap-1">
                        <div className="bg-purple-50 p-2 rounded-full"><f.icon className="h-4 w-4 text-purple-500" /></div>
                        <span className="text-[8px] font-extrabold text-slate-500 leading-tight">{f.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-auto">
                    <Button
                      variant="outline"
                      className="h-11 rounded-xl text-xs font-extrabold border-purple-200 text-purple-600 hover:bg-purple-50"
                      onClick={() => setPreviewId(bundle.id)}
                    >
                      Preview
                    </Button>
                    <Button
                      className="h-11 rounded-xl text-xs font-extrabold bg-gradient-to-br from-pink-500 to-rose-500 text-white border-none shadow-sm shadow-pink-500/30"
                      disabled={purchaseMutation.isPending || bundle.hasPurchased}
                      onClick={() => handleBuy(bundle.id, bundle.price, bundle.title)}
                    >
                      {purchaseMutation.isPending && purchaseMutation.variables?.id === bundle.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : bundle.hasPurchased ? (
                        "Dimiliki"
                      ) : (
                        <span className="flex items-center gap-1"><ShoppingCart className="h-3.5 w-3.5" /> Buy Bundle</span>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BundlePreviewDialog bundleId={previewId} onOpenChange={(open) => !open && setPreviewId(null)} />
    </AppLayout>
  );
}
