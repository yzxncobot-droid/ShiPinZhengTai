import { useState } from "react";
import { useLocation } from "wouter";
import { Crown, Star, Unlock, MonitorPlay, Sparkles, ShoppingCart, Cloud, Loader2 } from "lucide-react";
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

  const handleBuySubscription = () => {
    setLocation("/subscriptions");
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
        <Star className="absolute top-10 right-8 h-6 w-6 text-yellow-300 fill-yellow-300 transform rotate-12" />
        <Star className="absolute bottom-8 left-8 h-4 w-4 text-purple-300 fill-purple-300 transform -rotate-12" />
        
        <div className="relative mx-auto w-24 h-24 mb-4">
          <div className="absolute inset-0 bg-yellow-400/20 blur-xl rounded-full" />
          <svg className="w-full h-full drop-shadow-2xl" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C9.23858 2 7 4.23858 7 7V10H6C4.89543 10 4 10.8954 4 12V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V12C20 10.8954 19.1046 10 18 10H17V7C17 4.23858 14.7614 2 12 2ZM9 7C9 5.34315 10.3431 4 12 4C13.6569 4 15 5.34315 15 7V10H9V7ZM12 14C12.8284 14 13.5 14.6716 13.5 15.5C13.5 16.0354 13.2201 16.5053 12.8 16.7725V18C12.8 18.4418 12.4418 18.8 12 18.8C11.5582 18.8 11.2 18.4418 11.2 18V16.7725C10.7799 16.5053 10.5 16.0354 10.5 15.5C10.5 14.6716 11.1716 14 12 14Z" fill="#FBBF24"/>
          </svg>
        </div>
        
        <Badge className="bg-gradient-to-r from-yellow-400 to-orange-400 text-yellow-900 border-none font-extrabold px-3 py-1 uppercase tracking-wider text-[10px] mb-3">
          Produk Premium
        </Badge>
        
        <h2 className="text-xl md:text-2xl font-extrabold font-heading mb-2 leading-tight">Video ini hanya untuk member premium</h2>
        <p className="text-[11px] md:text-sm font-medium text-indigo-200 px-4">Dapatkan akses penuh untuk menonton video ini dan semua konten premium lainnya.</p>
      </div>

      {/* Body Panel */}
      <div className="p-5 bg-white">
        <div className="flex flex-wrap gap-2 mb-3">
          <Badge className="bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border-none font-extrabold text-[10px]">Premium Content</Badge>
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

        <div className="grid grid-cols-2 gap-3">
          <Button 
            className="h-auto py-3 px-2 flex-col gap-1 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-500 text-white shadow-md shadow-orange-500/30 border-none" 
            onClick={handlePurchase}
            disabled={purchaseMutation.isPending || !price}
          >
            {purchaseMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <span className="font-extrabold text-[13px] flex items-center gap-1"><ShoppingCart className="h-4 w-4" /> Beli</span>
                <span className="text-[9px] font-bold opacity-90 leading-tight text-center px-1">Beli video ini sekali tonton</span>
              </>
            )}
          </Button>
          <Button 
            className="h-auto py-3 px-2 flex-col gap-1 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/30 border-none" 
            onClick={handleBuySubscription}
          >
            <span className="font-extrabold text-[13px] flex items-center gap-1"><Crown className="h-4 w-4" /> Subscription</span>
            <span className="text-[9px] font-bold opacity-90 leading-tight text-center px-1">Akses semua video premium</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
