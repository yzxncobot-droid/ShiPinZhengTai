import { CheckCircle2, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";

const formatRupiah = (v: number) => `Rp ${v.toLocaleString("id-ID")}`;

interface Props {
  bundleTitle: string;
  videoCount: number;
  price: number;
  purchasedAt: string;
  onOpenBundle: () => void;
  onBack: () => void;
}

export function BundlePurchaseSuccess({ bundleTitle, videoCount, price, purchasedAt, onOpenBundle, onBack }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl text-center">
        {/* Confetti-style header */}
        <div className="flex justify-center mb-2">
          <div className="relative">
            {/* decorative dots */}
            {["top-0 left-0", "top-0 right-0", "bottom-4 left-2", "bottom-4 right-2"].map((pos, i) => (
              <span key={i} className={`absolute h-2 w-2 rounded-full ${["bg-pink-400","bg-yellow-400","bg-blue-400","bg-green-400"][i]} ${pos} -translate-x-4 -translate-y-4`} />
            ))}
            <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
            </div>
          </div>
        </div>

        <h2 className="text-xl font-heading font-extrabold text-slate-800 mt-3 mb-1">Pembelian Berhasil! 🎉</h2>
        <p className="text-sm font-medium text-slate-500 mb-6">
          Selamat! Anda sekarang memiliki akses ke bundle <span className="font-bold text-slate-700">{bundleTitle}</span>.
        </p>

        {/* Details */}
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-left space-y-3 mb-6">
          {[
            { label: "Nama Bundle", value: bundleTitle },
            { label: "Jumlah Video", value: `${videoCount} Video` },
            { label: "Dibeli Pada", value: purchasedAt },
            { label: "Total Pembayaran", value: formatRupiah(price) },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-500">{label}</span>
              <span className="font-extrabold text-slate-800">{value}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <Button
            className="w-full h-12 rounded-2xl font-extrabold bg-gradient-to-br from-pink-500 to-rose-500 text-white border-none shadow-md shadow-pink-500/20"
            onClick={onOpenBundle}
          >
            <Gift className="h-4 w-4 mr-2" /> Buka Paket
          </Button>
          <Button
            variant="ghost"
            className="w-full h-11 rounded-2xl font-bold text-purple-600 hover:bg-purple-50"
            onClick={onBack}
          >
            Kembali ke Beranda
          </Button>
        </div>
      </div>
    </div>
  );
}
