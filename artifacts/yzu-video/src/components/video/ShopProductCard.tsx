import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Eye, ShoppingBag, Play, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export interface ShopVideo {
  id: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  discountPercent?: number | null;
  isLimitedStock?: boolean;
  stock?: number | null;
  soldCount?: number;
  views?: number;
  duration?: number | null;
  hasAccess?: boolean;
}

interface ShopProductCardProps {
  video: ShopVideo;
  onPurchased?: () => void;
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatRupiah(amount?: number | null): string {
  if (amount === undefined || amount === null) return "Rp 0";
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

function formatCompactNumber(num?: number | null): string {
  if (!num) return "0";
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return num.toString();
}

export function ShopProductCard({ video, onPurchased }: ShopProductCardProps) {
  const { user, token } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isBuying, setIsBuying] = useState(false);

  const price = video.price ?? 0;
  const originalPrice = video.originalPrice ?? null;
  const discount = video.discountPercent ?? (originalPrice && price < originalPrice ? Math.round(((originalPrice - price) / originalPrice) * 100) : null);
  const isLimited = !!video.isLimitedStock;
  const stock = video.stock ?? 0;
  const isSoldOut = isLimited && stock <= 0;

  const handleBuyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      toast({
        title: "Silakan Login",
        description: "Masuk ke akunmu untuk membeli video ini.",
        variant: "destructive",
      });
      setLocation("/login");
      return;
    }

    if (isSoldOut) {
      toast({
        title: "Stok Habis",
        description: "Maaf, video ini sudah habis terjual.",
        variant: "destructive",
      });
      return;
    }

    if ((user.walletBalance ?? 0) < price) {
      toast({
        title: "Saldo Tidak Mencukupi",
        description: `Saldo kamu Rp ${(user.walletBalance ?? 0).toLocaleString("id-ID")}. Silakan Top Up terlebih dahulu.`,
        variant: "destructive",
      });
      setLocation("/topup");
      return;
    }

    setConfirmOpen(true);
  };

  const handleConfirmPurchase = async () => {
    if (!token) return;
    setIsBuying(true);
    try {
      const res = await fetch(`/api/videos/${video.id}/purchase`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gagal melakukan pembelian");
      }

      toast({
        title: "🎉 Pembelian Berhasil!",
        description: `Kamu telah mendapatkan akses ke video "${video.title}".`,
      });
      setConfirmOpen(false);
      if (onPurchased) onPurchased();
    } catch (err: any) {
      toast({
        title: "Gagal Membeli",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <>
      <div className="group relative flex flex-col justify-between bg-white rounded-3xl p-3 border border-purple-100/70 shadow-sm hover:shadow-md transition-all duration-300">
        <div>
          {/* Card Thumbnail Area */}
          <Link href={`/videos/${video.id}`} className="block relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-100 cursor-pointer">
            {video.thumbnail ? (
              <img
                src={video.thumbnail}
                alt={video.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-purple-50 text-purple-300">
                <Play className="h-10 w-10" />
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none" />

            {/* Discount Badge */}
            {discount && discount > 0 ? (
              <div className="absolute top-2 left-2 z-10 bg-gradient-to-r from-red-500 to-pink-500 text-white text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full shadow-md">
                -{discount}%
              </div>
            ) : null}

            {/* Limited Stock Badge / Sold Out Badge */}
            {isLimited && (
              <div
                className={`absolute ${
                  discount && discount > 0 ? "top-8 left-2" : "top-2 left-2"
                } z-10 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full shadow-md ${
                  isSoldOut
                    ? "bg-slate-700/90 text-white"
                    : "bg-gradient-to-r from-amber-500 to-orange-500"
                }`}
              >
                {isSoldOut ? "Habis" : `Limited ${stock}`}
              </div>
            )}

            {/* Duration Pill (bottom right) */}
            <div className="absolute bottom-2 right-2 z-10 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
              <Clock className="h-2.5 w-2.5 text-white/80" />
              <span>{formatDuration(video.duration)}</span>
            </div>

            {/* Play trigger overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
              <div className="h-10 w-10 rounded-full bg-white/90 text-purple-600 flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                <Play className="h-5 w-5 fill-purple-600 ml-0.5" />
              </div>
            </div>
          </Link>

          {/* Info Section */}
          <div className="mt-2.5 px-1 space-y-1">
            <Link href={`/videos/${video.id}`} className="block">
              <h3 className="font-heading font-extrabold text-xs sm:text-sm text-slate-800 line-clamp-2 leading-tight hover:text-purple-600 transition-colors">
                {video.title}
              </h3>
            </Link>

            {/* View and Sold Stats */}
            <div className="flex items-center gap-3 text-[11px] font-bold text-slate-400 pt-0.5">
              <span className="flex items-center gap-1 text-slate-500">
                <Eye className="h-3 w-3 text-purple-500" />
                {formatCompactNumber(video.views ?? 0)}
              </span>
              <span className="flex items-center gap-1 text-slate-500">
                <ShoppingBag className="h-3 w-3 text-pink-500" />
                {formatCompactNumber(video.soldCount ?? 0)}
              </span>
            </div>

            {/* Price section */}
            <div className="pt-1.5 flex items-baseline gap-1.5 flex-wrap">
              <span className="text-sm sm:text-base font-extrabold text-purple-700">
                {formatRupiah(price)}
              </span>
              {originalPrice && originalPrice > price && (
                <span className="text-[11px] font-bold text-slate-400 line-through">
                  {formatRupiah(originalPrice)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-3 px-1">
          {video.hasAccess ? (
            <Link href={`/videos/${video.id}`} className="block w-full">
              <Button
                size="sm"
                className="w-full h-9 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-extrabold text-xs shadow-md shadow-emerald-500/20 gap-1.5"
              >
                <Play className="h-3.5 w-3.5 fill-white" /> Tonton
              </Button>
            </Link>
          ) : isSoldOut ? (
            <Button
              size="sm"
              disabled
              className="w-full h-9 rounded-2xl bg-slate-200 text-slate-400 font-extrabold text-xs cursor-not-allowed"
            >
              Habis Terjual
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleBuyClick}
              className="w-full h-9 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold text-xs shadow-md shadow-purple-500/25 transition-transform active:scale-95"
            >
              Beli Sekarang
            </Button>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-xs sm:max-w-sm rounded-3xl bg-white p-6">
          <DialogHeader className="text-center sm:text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center">
              <Sparkles className="h-6 w-6" />
            </div>
            <DialogTitle className="text-base font-extrabold text-slate-800">
              Konfirmasi Pembelian
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium">
              Apakah kamu yakin ingin membeli video <span className="font-bold text-slate-700">"{video.title}"</span> seharga <span className="font-extrabold text-purple-600">{formatRupiah(price)}</span>?
            </DialogDescription>
          </DialogHeader>

          <div className="my-2 p-3 bg-purple-50/70 rounded-2xl border border-purple-100 text-xs space-y-1.5">
            <div className="flex justify-between text-slate-600">
              <span>Saldo kamu:</span>
              <span className="font-bold">Rp {(user?.walletBalance ?? 0).toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Harga video:</span>
              <span className="font-bold text-red-500">- {formatRupiah(price)}</span>
            </div>
            <div className="border-t border-purple-200/60 pt-1.5 flex justify-between font-extrabold text-purple-700">
              <span>Sisa saldo:</span>
              <span>Rp {Math.max(0, (user?.walletBalance ?? 0) - price).toLocaleString("id-ID")}</span>
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 sm:gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isBuying}
              className="flex-1 rounded-2xl h-10 font-extrabold text-xs border-slate-200"
            >
              Batal
            </Button>
            <Button
              onClick={handleConfirmPurchase}
              disabled={isBuying}
              className="flex-1 rounded-2xl h-10 bg-gradient-to-r from-purple-600 to-indigo-600 font-extrabold text-xs text-white shadow-md shadow-purple-500/25"
            >
              {isBuying ? "Memproses..." : "Ya, Beli"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
