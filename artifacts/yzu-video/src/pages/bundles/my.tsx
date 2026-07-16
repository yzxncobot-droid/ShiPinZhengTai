import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, ChevronRight, Gift, Layers, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useListBundles } from "@workspace/api-client-react";
import type { Bundle } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

export default function MyBundlesPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const { data: allBundles, isLoading } = useListBundles({ query: { enabled: !!user } });

  const myBundles = (allBundles ?? []).filter((b: Bundle) => b.hasPurchased);

  return (
    <AppLayout>
      {/* Top bar */}
      <div className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-md px-4 py-3 flex items-center gap-3 border-b border-slate-100 shadow-sm">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-slate-100 text-slate-600" onClick={() => setLocation("/bundles")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="font-heading font-extrabold text-slate-800 text-sm">My Bundles</span>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-extrabold text-slate-800">My Bundles 🎁</h1>
          <p className="text-sm font-medium text-slate-500 mt-1">Semua bundle yang sudah kamu miliki.</p>
        </div>

        {!user ? (
          <div className="text-center py-16">
            <Gift className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="font-bold text-slate-600 mb-4">Login dulu untuk lihat bundle kamu</p>
            <Button onClick={() => setLocation("/login")} className="rounded-full bg-purple-600">Login</Button>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          </div>
        ) : myBundles.length === 0 ? (
          <div className="text-center py-16">
            <Gift className="h-14 w-14 text-slate-200 mx-auto mb-3" />
            <p className="font-extrabold text-slate-600 mb-1">Belum ada bundle nih</p>
            <p className="text-sm font-medium text-slate-400 mb-6">Beli bundle pertamamu sekarang!</p>
            <Button onClick={() => setLocation("/bundles")} className="rounded-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-extrabold">
              Lihat Bundle
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {myBundles.map((bundle: Bundle) => (
              <button
                key={bundle.id}
                onClick={() => setLocation(`/bundles/${bundle.id}`)}
                className="w-full flex items-center gap-4 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow text-left"
              >
                {/* Thumbnail */}
                <div className="relative h-16 w-24 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 overflow-hidden shrink-0">
                  {bundle.thumbnail && (
                    <img src={bundle.thumbnail} alt={bundle.title} className="h-full w-full object-cover" />
                  )}
                  <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <Layers className="h-2.5 w-2.5" /> {bundle.videoCount}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="font-heading font-extrabold text-[13px] text-slate-800 truncate">{bundle.title}</span>
                  </div>
                  <p className="text-[11px] font-medium text-slate-500">
                    {bundle.videoCount} Video
                  </p>
                </div>

                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
