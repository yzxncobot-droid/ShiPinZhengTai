import { AppLayout } from "@/components/layout/AppLayout";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Megaphone, Wallet, Sparkles, HelpCircle, ChevronRight, CheckCircle2, ShieldCheck, Flame } from "lucide-react";
import { Link } from "wouter";

interface Announcement {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
  createdAt: string;
  isPinned?: boolean;
}

export default function InfoPage() {
  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["info-announcements"],
    queryFn: () => adminFetch<Announcement[]>("/announcements?limit=10"),
  });

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-violet-600 rounded-3xl p-6 text-white shadow-lg shadow-purple-500/15 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="relative z-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-bold mb-2">
              <Sparkles className="h-3.5 w-3.5" /> Informasi Terkini
            </span>
            <h1 className="text-2xl font-black">Pusat Informasi Yzu视频</h1>
            <p className="text-xs text-white/80 mt-1 max-w-sm">
              Temukan update pengumuman resmi, cara top up, dan panduan fitur terbaru platform.
            </p>
          </div>
        </div>

        {/* ── Section 1: Pengumuman Resmi ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
              <Megaphone className="h-4.5 w-4.5 text-purple-600" /> Pengumuman
            </h2>
            <span className="text-xs font-bold text-purple-600">Terbaru</span>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 bg-white rounded-2xl border border-purple-100 animate-pulse" />
              ))}
            </div>
          ) : announcements.length === 0 ? (
            <div className="bg-white rounded-2xl p-5 border border-purple-100 text-center text-slate-400 text-xs font-medium">
              Belum ada pengumuman baru saat ini.
            </div>
          ) : (
            <div className="space-y-3">
              {announcements.map((ann) => (
                <div
                  key={ann.id}
                  className="bg-white rounded-2xl p-4 border border-purple-100/80 shadow-sm hover:shadow-md transition-shadow"
                >
                  {ann.isPinned && (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-extrabold mb-1.5">
                      📌 PENTING
                    </span>
                  )}
                  <h3 className="font-bold text-sm text-slate-800">{ann.title}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-3 leading-relaxed whitespace-pre-line">
                    {ann.content}
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium mt-2">
                    {new Date(ann.createdAt).toLocaleDateString("id-ID", { dateStyle: "medium" })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Section 2: Panduan Top Up QRIS ── */}
        <section className="space-y-3">
          <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
            <Wallet className="h-4.5 w-4.5 text-purple-600" /> Informasi Top Up
          </h2>
          <div className="bg-white rounded-3xl p-5 border border-purple-100/80 shadow-sm space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-purple-100 text-purple-700 font-black flex items-center justify-center shrink-0 text-sm">
                1
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800">Pilih Nominal Top Up</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Buka menu <b>Top Up</b> dan pilih jumlah saldo yang ingin kamu tambahkan.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-purple-100 text-purple-700 font-black flex items-center justify-center shrink-0 text-sm">
                2
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800">Scan Kode QRIS</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Gunakan aplikasi e-wallet (GoPay, OVO, Dana, ShopeePay) atau Mobile Banking apapun untuk scan QRIS.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-purple-100 text-purple-700 font-black flex items-center justify-center shrink-0 text-sm">
                3
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800">Saldo Masuk Otomatis</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Untuk metode manual, upload bukti pembayaran dan admin akan memverifikasi dalam beberapa menit.
                </p>
              </div>
            </div>

            <Link href="/topup">
              <button className="w-full mt-2 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-violet-600 text-white font-extrabold text-xs shadow-md shadow-purple-500/20 hover:opacity-95 transition-opacity">
                Isi Saldo Sekarang
              </button>
            </Link>
          </div>
        </section>

        {/* ── Section 3: Fitur & Video Baru ── */}
        <section className="space-y-3">
          <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-purple-600" /> Video & Konten Baru
          </h2>
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-3xl p-5 border border-purple-100 space-y-2">
            <h3 className="font-extrabold text-xs text-purple-900">Koleksi Video Eksklusif di Shop</h3>
            <p className="text-[11px] text-purple-700/80 leading-relaxed">
              Jelajahi video-video premium edukasi dan animasi spesial di tab <b>Shop</b> dengan harga terjangkau.
            </p>
            <div className="pt-2">
              <Link href="/shop" className="inline-flex items-center text-xs font-black text-purple-700 hover:text-purple-900">
                Buka Shop <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
