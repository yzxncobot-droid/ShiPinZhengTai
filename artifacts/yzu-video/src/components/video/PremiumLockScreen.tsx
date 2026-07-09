import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Crown, Gift, Star, Rocket, Sparkles, Wallet, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { usePurchaseVideo, getGetVideoQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface PremiumLockScreenProps {
  video: {
    id: number;
    title: string;
    price?: number | null;
    creator?: { username?: string | null } | null;
    category?: { name?: string | null } | null;
  };
}

const formatRupiah = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

export function PremiumLockScreen({ video }: PremiumLockScreenProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const purchaseMutation = usePurchaseVideo();
  const price = video.price ?? 0;
  const walletBalance = user?.walletBalance ?? 0;
  const canAfford = walletBalance >= price;

  const handleBuySubscription = () => {
    setLocation("/subscriptions");
  };

  const handleOpenModal = () => {
    if (!user) {
      setLocation("/login");
      return;
    }
    setModalOpen(true);
  };

  const handleConfirmPurchase = () => {
    if (!canAfford) {
      setModalOpen(false);
      setLocation("/topup");
      return;
    }
    purchaseMutation.mutate(
      { id: video.id },
      {
        onSuccess: () => {
          setModalOpen(false);
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

  const benefits = [
    { icon: Star, text: "Akses semua video premium", color: "text-yellow-500", bg: "bg-yellow-100" },
    { icon: Gift, text: "Update video terbaru", color: "text-orange-500", bg: "bg-orange-100" },
    { icon: Rocket, text: "Streaming tanpa batas", color: "text-sky-500", bg: "bg-sky-100" },
    { icon: Crown, text: "Prioritas member premium", color: "text-purple-500", bg: "bg-purple-100" },
  ];

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-purple-50 to-yellow-50 p-4 sm:p-8">
      {/* Decorative floating blobs */}
      <div className="pointer-events-none absolute -top-10 -left-10 h-40 w-40 rounded-full bg-yellow-300/40 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-purple-300/40 blur-2xl" />
      <div className="pointer-events-none absolute top-1/3 right-4 h-20 w-20 rounded-full bg-orange-300/30 blur-xl" />

      <div className="relative mx-auto max-w-lg text-center">
        {/* Header illustration */}
        <div className="mb-4 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 animate-pulse rounded-full bg-yellow-300/60 blur-lg" />
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-400 via-sky-400 to-yellow-300 shadow-xl"
              style={{ animation: "float-crown 3s ease-in-out infinite" }}
            >
              <Crown className="h-12 w-12 text-white drop-shadow" fill="white" fillOpacity={0.25} />
            </div>
            <Sparkles className="absolute -top-2 -right-2 h-6 w-6 text-yellow-400" />
            <Sparkles className="absolute -bottom-1 -left-2 h-4 w-4 text-purple-400" />
          </div>
        </div>

        <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-purple-600 shadow-sm">
          <Crown className="h-3.5 w-3.5" /> Premium Club
        </div>

        <h1 className="mt-3 text-2xl font-heading font-extrabold text-slate-800 sm:text-3xl">
          Video Premium Terkunci 🔒
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 sm:text-base">
          Video ini hanya bisa ditonton oleh member premium atau dibeli secara satuan.
        </p>

        {/* Video meta info */}
        <div className="mt-6 grid grid-cols-1 gap-3 rounded-2xl bg-white/70 p-4 text-left shadow-sm backdrop-blur sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase text-slate-400">Harga Video</p>
            <p className="text-sm font-bold text-slate-800">{price ? formatRupiah(price) : "-"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase text-slate-400">Uploader</p>
            <p className="truncate text-sm font-bold text-slate-800">{video.creator?.username || "Yzu Creator"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase text-slate-400">Kategori</p>
            <p className="truncate text-sm font-bold text-slate-800">{video.category?.name || "Umum"}</p>
          </div>
        </div>

        {/* Benefits */}
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3">
          {benefits.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-2xl bg-white/80 p-3 text-left shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${b.bg}`}>
                <b.icon className={`h-4 w-4 ${b.color}`} />
              </div>
              <span className="text-xs font-semibold text-slate-700 sm:text-sm">{b.text}</span>
            </div>
          ))}
        </div>

        {/* Purchase options */}
        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Subscription card */}
          <div className="group relative flex flex-col rounded-3xl bg-gradient-to-br from-purple-500 to-sky-500 p-5 text-left text-white shadow-lg shadow-purple-300/50 transition-transform hover:scale-[1.03]">
            <div className="absolute -top-3 right-4 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-purple-600 shadow">
              PALING HEMAT
            </div>
            <div className="flex items-center gap-2 text-sm font-bold">
              <Crown className="h-5 w-5" /> Subscription Premium
            </div>
            <p className="mt-3 text-2xl font-extrabold leading-none">Rp 25.000</p>
            <p className="text-xs text-white/80">/ bulan</p>
            <ul className="mt-3 space-y-1.5 text-xs text-white/90">
              <li className="flex items-center gap-1.5"><Star className="h-3 w-3 shrink-0" /> Semua video premium terbuka</li>
              <li className="flex items-center gap-1.5"><Star className="h-3 w-3 shrink-0" /> Akses penuh selama aktif</li>
              <li className="flex items-center gap-1.5"><Star className="h-3 w-3 shrink-0" /> Lebih hemat</li>
            </ul>
            <Button
              onClick={handleBuySubscription}
              className="mt-4 h-11 w-full rounded-xl bg-white font-bold text-purple-600 shadow-md hover:bg-white/90"
            >
              Beli Subscription
            </Button>
          </div>

          {/* One-time purchase card */}
          <div className="group relative flex flex-col rounded-3xl bg-gradient-to-br from-orange-400 to-yellow-400 p-5 text-left text-white shadow-lg shadow-orange-300/50 transition-transform hover:scale-[1.03]">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Gift className="h-5 w-5" /> Beli Video Ini
            </div>
            <p className="mt-3 text-2xl font-extrabold leading-none">{price ? formatRupiah(price) : "-"}</p>
            <p className="text-xs text-white/80">sekali bayar</p>
            <p className="mt-3 text-xs text-white/90">
              Bayar sekali dan video ini menjadi milikmu selamanya.
            </p>
            <Button
              onClick={handleOpenModal}
              disabled={!video.price}
              className="mt-4 h-11 w-full rounded-xl bg-white font-bold text-orange-500 shadow-md hover:bg-white/90"
            >
              Beli Video
            </Button>
          </div>
        </div>
      </div>

      {/* Purchase confirmation modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-sm rounded-3xl border-none bg-gradient-to-br from-sky-50 via-white to-yellow-50 p-6">
          <DialogHeader>
            <div className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-yellow-400 shadow-md">
              <PartyPopper className="h-7 w-7 text-white" />
            </div>
            <DialogTitle className="text-center text-lg font-heading font-extrabold text-slate-800">
              Konfirmasi Pembelian
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-slate-500">
              Yuk cek dulu detailnya sebelum membeli!
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-2xl bg-white/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-slate-400">Nama Video</span>
              <span className="max-w-[60%] truncate text-sm font-bold text-slate-800">{video.title}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-slate-400">Harga Video</span>
              <span className="text-sm font-bold text-orange-500">{formatRupiah(price)}</span>
            </div>
            <div className="h-px bg-slate-100" />
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                <Wallet className="h-3.5 w-3.5" /> Saldo Wallet
              </span>
              <span className={`text-sm font-bold ${canAfford ? "text-emerald-500" : "text-red-500"}`}>
                {formatRupiah(walletBalance)}
              </span>
            </div>
          </div>

          {!canAfford && (
            <p className="text-center text-xs font-semibold text-red-500">
              Saldo kamu belum cukup nih, isi saldo dulu yuk! 💰
            </p>
          )}

          <DialogFooter>
            <Button
              onClick={handleConfirmPurchase}
              disabled={purchaseMutation.isPending}
              className={`h-12 w-full rounded-xl text-base font-bold text-white shadow-md ${
                canAfford
                  ? "bg-gradient-to-r from-purple-500 to-sky-500 hover:opacity-90"
                  : "bg-gradient-to-r from-orange-400 to-yellow-400 hover:opacity-90"
              }`}
            >
              {purchaseMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : canAfford ? (
                "Bayar Sekarang"
              ) : (
                "Isi Saldo"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style>{`
        @keyframes float-crown {
          0%, 100% { transform: translateY(0px) rotate(-2deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>
    </div>
  );
}
