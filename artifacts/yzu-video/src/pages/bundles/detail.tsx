import { useRoute, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Gift, Layers, Loader2, PlayCircle, ShieldCheck, ShoppingCart, Zap, Lock } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useGetBundle, usePurchaseBundle, getListBundlesQueryKey, getGetBundleQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BundlePurchaseSuccess } from "@/components/bundle/BundlePurchaseSuccess";

const formatRupiah = (v: number) => `Rp ${v.toLocaleString("id-ID")}`;

const FEATURES = [
  { icon: PlayCircle, label: "Tonton Selamanya" },
  { icon: ShieldCheck, label: "Aman untuk Anak" },
  { icon: Zap, label: "Kualitas HD" },
  { icon: Layers, label: "Akses Semua Video" },
];

export default function BundleDetailPage() {
  const [, params] = useRoute("/bundles/:id");
  const id = params?.id ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [successData, setSuccessData] = useState<{ bundleId: string; bundleTitle: string; videoCount: number; price: number; purchasedAt: string } | null>(null);

  const { data: bundle, isLoading } = useGetBundle(id, { query: { enabled: !!id } });
  const purchaseMutation = usePurchaseBundle();

  const handleBuy = () => {
    if (!user) { setLocation("/login"); return; }
    const price = bundle?.price ?? 0;
    if ((user.walletBalance ?? 0) < price) {
      toast({ title: "Saldo Tidak Cukup", description: "Isi saldo wallet kamu dulu.", variant: "destructive" });
      setLocation("/topup");
      return;
    }
    purchaseMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBundlesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBundleQueryKey(id) });
        setSuccessData({
          bundleId: id,
          bundleTitle: bundle?.title ?? "",
          videoCount: bundle?.videoCount ?? 0,
          price: bundle?.price ?? 0,
          purchasedAt: new Date().toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        });
      },
      onError: (err: any) => {
        toast({ title: "Gagal membeli bundle", description: err?.message || "Terjadi kesalahan.", variant: "destructive" });
      },
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
        </div>
      </AppLayout>
    );
  }

  if (!bundle) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-20 text-center">
          <Gift className="h-14 w-14 text-slate-300 mx-auto mb-4" />
          <h1 className="text-xl font-heading font-extrabold mb-2">Bundle tidak ditemukan</h1>
          <Button onClick={() => setLocation("/bundles")} className="rounded-full mt-4">Kembali ke Bundles</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {/* Top bar */}
      <div className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-md px-4 py-3 flex items-center gap-3 border-b border-slate-100 shadow-sm">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-slate-100 text-slate-600" onClick={() => setLocation("/bundles")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="font-heading font-extrabold text-slate-800 text-sm truncate">{bundle.title}</span>
      </div>

      <div className="max-w-lg mx-auto pb-10">
        {/* Hero thumbnail */}
        <div className="relative h-52 bg-gradient-to-br from-purple-500 to-pink-500">
          {bundle.thumbnail && (
            <img src={bundle.thumbnail} alt={bundle.title} className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
            <div className="flex gap-2">
              <span className="bg-black/60 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
                <Layers className="h-3 w-3" /> {bundle.videoCount} Video
              </span>
              {bundle.hasPurchased && (
                <span className="bg-green-500 text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Sudah Dimiliki
                </span>
              )}
            </div>
            {bundle.badge && (
              <Badge className="bg-gradient-to-r from-orange-400 to-red-500 text-white border-none font-extrabold text-[10px]">
                {bundle.badge}
              </Badge>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="px-4 pt-5">
          <h1 className="font-heading font-extrabold text-2xl text-slate-800 mb-1">{bundle.title}</h1>
          <p className="text-sm font-medium text-slate-500 mb-5">{bundle.description || "Kumpulan video eksklusif dalam satu paket hemat."}</p>

          {/* Price */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-5">
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">Harga Bundle</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-extrabold text-purple-600">{formatRupiah(bundle.price)}</p>
                {bundle.originalPrice && bundle.originalPrice > bundle.price && (
                  <p className="text-sm font-bold text-slate-400 line-through">{formatRupiah(bundle.originalPrice)}</p>
                )}
              </div>
            </div>
            {bundle.discountPercent > 0 && (
              <Badge className="bg-red-100 text-red-600 border-none font-extrabold text-sm">-{bundle.discountPercent}%</Badge>
            )}
          </div>

          {/* Features */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            {FEATURES.map((f) => (
              <div key={f.label} className="flex flex-col items-center text-center gap-1.5">
                <div className="bg-purple-50 p-2.5 rounded-full"><f.icon className="h-4 w-4 text-purple-500" /></div>
                <span className="text-[9px] font-extrabold text-slate-500 leading-tight">{f.label}</span>
              </div>
            ))}
          </div>

          {/* Video list */}
          <h2 className="font-heading font-extrabold text-slate-800 text-base mb-3">Daftar Video</h2>
          <div className="space-y-3 mb-8">
            {bundle.videos?.map((v: any, i: number) => (
              <div
                key={v.id}
                className={`flex items-center gap-3 bg-white border border-slate-100 rounded-2xl p-3 shadow-sm transition-all ${bundle.hasPurchased ? "cursor-pointer hover:border-purple-200 hover:bg-purple-50/40" : ""}`}
                onClick={() => bundle.hasPurchased && setLocation(`/bundle/watch/${v.id}`)}
              >
                <div className="relative h-14 w-24 rounded-xl bg-slate-200 overflow-hidden shrink-0">
                  {v.thumbnail && <img src={v.thumbnail} alt={v.title} className="h-full w-full object-cover" />}
                  {bundle.hasPurchased && (
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <div className="h-8 w-8 rounded-full bg-white/90 flex items-center justify-center">
                        <PlayCircle className="h-5 w-5 text-purple-600 fill-purple-600" />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[13px] text-slate-800 line-clamp-2 leading-snug">{v.title}</p>
                  {bundle.hasPurchased
                    ? <p className="text-[11px] font-bold text-purple-500 mt-0.5">▶ Tonton</p>
                    : <p className="text-[11px] font-medium text-slate-400 mt-0.5">🔒 Beli bundle untuk menonton</p>
                  }
                </div>
                <span className="text-[11px] font-bold text-slate-300 shrink-0">#{i + 1}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-12 rounded-2xl font-extrabold border-purple-200 text-purple-600 hover:bg-purple-50"
              onClick={() => setLocation("/bundles")}
            >
              Kembali
            </Button>
            <Button
              className="h-12 rounded-2xl font-extrabold bg-gradient-to-br from-pink-500 to-rose-500 text-white border-none shadow-md shadow-pink-500/20"
              disabled={purchaseMutation.isPending || bundle.hasPurchased}
              onClick={handleBuy}
            >
              {purchaseMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : bundle.hasPurchased ? (
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Dimiliki</span>
              ) : (
                <span className="flex items-center gap-1.5"><ShoppingCart className="h-4 w-4" /> Beli Bundle</span>
              )}
            </Button>
          </div>
        </div>
      </div>

      {successData && (
        <BundlePurchaseSuccess
          bundleId={successData.bundleId}
          bundleTitle={successData.bundleTitle}
          videoCount={successData.videoCount}
          price={successData.price}
          purchasedAt={successData.purchasedAt}
          onOpenBundle={() => { setSuccessData(null); setLocation(`/bundles/${successData.bundleId}`); }}
          onBack={() => setLocation("/bundles")}
        />
      )}
    </AppLayout>
  );
}
