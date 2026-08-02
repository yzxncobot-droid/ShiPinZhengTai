import { useLocation } from "wouter";
import { Unlock, MonitorPlay, Sparkles, ShoppingCart, Cloud, Loader2, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { usePurchaseVideo, getGetVideoQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface PremiumLockScreenProps {
  video: {
    id: number;
    title: string;
    description?: string | null;
    price?: number | null;
    bundleExclusive?: boolean;
    bundles?: { id: number; title: string }[];
  };
}

const formatRupiah = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

export function PremiumLockScreen({ video }: PremiumLockScreenProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const purchaseMutation = usePurchaseVideo();
  const price = video.price ?? 0;
  const walletBalance = user?.walletBalance ?? 0;
  const canAfford = walletBalance >= price;

  const bundleTarget = video.bundles && video.bundles.length > 0 ? `/bundles?highlight=${video.bundles[0].id}` : "/bundles";
  const handleGoToBundle = () => {
    setLocation(bundleTarget);
  };

  const handlePurchase = () => {
    if (!user) {
      setLocation("/login");
      return;
    }
    if (!canAfford) {
      toast({
        title: "Saldo Tidak Cukup",
        description: "Silakan isi saldo wallet kamu terlebih dahulu.",
        variant: "destructive"
      });
      setLocation("/topup");
      return;
    }

    purchaseMutation.mutate(
      { id: video.id },
      {
        onSuccess: () => {
          toast({
            title: "🎉 Yeay! Video berhasil dibeli!",
            description: "Video ini sudah jadi milikmu selamanya.",
          });
          queryClient.invalidateQueries({ queryKey: getGetVideoQueryKey(video.id) });
        },
        onError: (err: any) => {
          toast({
            title: "Yah, gagal 😢",
            description: err?.message || "Terjadi kesalahan saat membeli video.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white shadow-md mx-4 mt-2 border border-slate-100">
      
      {/* Top Gradient Panel */}
      <div className="bg-gradient-to-b from-[#1e1b4b] to-[#312e81] p-8 relative overflow-hidden text-center text-white flex flex-col items-center justify-center">
        <Cloud className="absolute top-4 left-6 h-12 w-12 text-white/10 fill-white/10" />
        <Cloud className="absolute bottom-4 right-4 h-16 w-16 text-white/10 fill-white/10" />
        
        <div className="relative mx-auto w-24 h-24 mb-4">
          <div className="absolute inset-0 bg-purple-400/20 blur-xl rounded-full" />
          <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-2xl">
            <ShoppingCart className="h-10 w-10 text-white" strokeWidth={1.5} />
          </div>
        </div>
        
        <Badge className="bg-gradient-to-r from-purple-400 to-violet-500 text-white border-none font-extrabold px-3 py-1 uppercase tracking-wider text-[10px] mb-3">
          Konten Berbayar
        </Badge>
        
        <h2 className="text-xl md:text-2xl font-extrabold font-heading mb-2 leading-tight">Video ini memerlukan pembelian</h2>
        <p className="text-[11px] md:text-sm font-medium text-indigo-200 px-4">Beli video ini untuk mendapatkan akses penuh dan tonton kapan saja.</p>
      </div>

      {/* Body Panel */}
      <div className="p-5 bg-white">
        <div className="flex flex-wrap gap-2 mb-3">
          <Badge className="bg-purple-50 text-purple-700 hover:bg-purple-100 border-none font-extrabold text-[10px]">Konten Eksklusif</Badge>
          <Badge className="bg-green-50 text-green-700 hover:bg-green-100 border-none font-extrabold text-[10px]">Aman & Terpercaya</Badge>
        </div>
        
        <h3 className="font-heading font-extrabold text-lg text-slate-800 mb-1 leading-snug">{video.title}</h3>
        <p className="text-[11px] font-medium text-slate-500 mb-5 line-clamp-2">{video.description || "Video eksklusif berkualitas tinggi."}</p>
        
        <div className="flex items-end justify-between bg-slate-50 p-4 rounded-2xl mb-5 border border-slate-100">
          <div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">Harga Satuan</p>
            <p className="text-2xl font-extrabold text-purple-600">{price ? formatRupiah(price) : "-"}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="bg-blue-50 p-2.5 rounded-full"><Unlock className="h-5 w-5 text-blue-500" /></div>
            <span className="text-[10px] font-extrabold text-slate-600 leading-tight">Akses<br/>Penuh</span>
          </div>
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="bg-purple-50 p-2.5 rounded-full"><MonitorPlay className="h-5 w-5 text-purple-500" /></div>
            <span className="text-[10px] font-extrabold text-slate-600 leading-tight">Kualitas<br/>Terbaik</span>
          </div>
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="bg-orange-50 p-2.5 rounded-full"><Sparkles className="h-5 w-5 text-orange-500" /></div>
            <span className="text-[10px] font-extrabold text-slate-600 leading-tight">Konten<br/>Eksklusif</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {video.bundleExclusive ? (
            <Button 
              className="h-auto py-3 px-2 flex-col gap-1 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/30 border-none" 
              onClick={handleGoToBundle}
            >
              <span className="font-extrabold text-[13px] flex items-center gap-1"><Gift className="h-4 w-4" /> Lihat Bundle</span>
              <span className="text-[9px] font-bold opacity-90 leading-tight text-center px-1">Video ini hanya bisa dibuka dengan membeli bundle-nya</span>
            </Button>
          ) : (
            <Button 
              className="h-auto py-3 px-2 flex-col gap-1 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-500 text-white shadow-md shadow-orange-500/30 border-none" 
              onClick={handlePurchase}
              disabled={purchaseMutation.isPending || !price}
            >
              {purchaseMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <span className="font-extrabold text-[13px] flex items-center gap-1"><ShoppingCart className="h-4 w-4" /> Beli Video</span>
                  <span className="text-[9px] font-bold opacity-90 leading-tight text-center px-1">Beli video ini untuk akses selamanya</span>
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
