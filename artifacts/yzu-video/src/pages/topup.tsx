import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useListMyTopups } from "@workspace/api-client-react";
import { Sparkles, Pencil, Star, ChevronRight, Wallet, Download } from "lucide-react";
import { AutomaticTopupModal } from "@/components/topup/AutomaticTopupModal";

const MIN_TOPUP = 100;

const PRESETS = [
  { amount: 1_000, emoji: "⭐", bg: "bg-amber-100" },
  { amount: 3_000, emoji: "🦕", bg: "bg-emerald-100" },
  { amount: 5_000, emoji: "🚀", bg: "bg-violet-100" },
  { amount: 10_000, emoji: "🦄", bg: "bg-pink-100" },
  { amount: 20_000, emoji: "🪐", bg: "bg-sky-100" },
  { amount: 50_000, emoji: "💰", bg: "bg-orange-100" },
];

const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

export default function TopupPage() {
  const { user } = useAuth();
  const { data: topupsData } = useListMyTopups({ limit: 5 });

  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState<string>("");
  const [qrisModalOpen, setQrisModalOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState<number>(0);

  const balance = user?.walletBalance ?? 0;
  const recentCount = topupsData?.total ?? 0;

  const openQris = (amount: number) => {
    setTopupAmount(amount);
    setQrisModalOpen(true);
  };

  const handlePreset = (amount: number) => {
    setSelected(amount);
    setCustom("");
    openQris(amount);
  };

  const handleCustomTopup = () => {
    const amount = Number(custom);
    if (!Number.isInteger(amount) || amount < MIN_TOPUP) return;
    setSelected(null);
    openQris(amount);
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="min-h-[calc(100dvh-64px)] pb-8" style={{ background: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 40%, #dbeafe 100%)" }}>
          <div className="mx-auto max-w-md px-5 pt-6">
            {/* ── Brand tag ──────────────────────────────────────────────── */}
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm">
                <Sparkles className="h-4 w-4 text-violet-500" />
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-violet-500">
                KIDZOO • Play • Learn • Grow
              </span>
            </div>

            {/* ── Hero ───────────────────────────────────────────────────── */}
            <h1 className="text-3xl font-extrabold leading-tight" style={{ color: "#1e293b" }}>
              Top Up Saldo
            </h1>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
              Isi saldo via QRIS — diterima oleh semua bank & e-wallet di Indonesia.
            </p>

            {/* Balance card */}
            <div className="relative mt-5 overflow-hidden rounded-3xl p-5 shadow-lg" style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #8b5cf6 100%)" }}>
              <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full border-[14px] border-white/10" />
              <div className="absolute -bottom-12 -left-4 h-28 w-28 rounded-full bg-white/5 blur-2xl" />
              <div className="relative z-10 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/70">
                    SALDO SAAT INI
                  </p>
                  <p className="mt-1 text-3xl font-extrabold text-white">{fmtRp(balance)}</p>
                  <p className="mt-1.5 text-[11px] font-medium text-white/60">
                    Kumpulkan koin, beli video premium
                  </p>
                </div>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15">
                  <Wallet className="h-8 w-8 text-white" />
                </div>
              </div>
            </div>

            {/* ── Pilih Nominal ──────────────────────────────────────────── */}
            <div className="mt-7 flex items-center gap-2">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              <h2 className="text-lg font-extrabold" style={{ color: "#1e293b" }}>
                Pilih Nominal Top Up
              </h2>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {PRESETS.map(({ amount, emoji, bg }) => {
                const active = selected === amount;
                return (
                  <button
                    key={amount}
                    onClick={() => handlePreset(amount)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border-2 bg-white p-3 shadow-sm transition active:scale-95 ${
                      active ? "border-violet-500 shadow-md" : "border-slate-100"
                    }`}
                  >
                    <span className={`flex h-11 w-11 items-center justify-center rounded-full text-2xl ${bg}`}>
                      {emoji}
                    </span>
                    <span className="text-sm font-extrabold" style={{ color: "#1e293b" }}>
                      {fmtRp(amount)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── Custom nominal ─────────────────────────────────────────── */}
            <div className="mt-6 flex items-center gap-2">
              <Pencil className="h-4 w-4 text-violet-500" />
              <h2 className="text-lg font-extrabold" style={{ color: "#1e293b" }}>
                Nominal Custom
              </h2>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-slate-100 bg-white p-2 pl-4 shadow-sm">
              <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="number"
                inputMode="numeric"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Masukkan nominal lain"
                className="h-10 w-full bg-transparent text-sm font-bold outline-none placeholder:font-medium placeholder:text-slate-400"
                style={{ color: "#1e293b" }}
              />
              <span className="pr-3 text-sm font-extrabold text-slate-400">Rp</span>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2">
              <span className="text-xs font-medium text-blue-600">ℹ️ Minimal top up adalah {fmtRp(MIN_TOPUP)}</span>
            </div>

            <button
              onClick={handleCustomTopup}
              disabled={!custom || Number(custom) < MIN_TOPUP}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #f472b6 0%, #ec4899 100%)" }}
            >
              <Star className="h-4 w-4 fill-white" />
              Top Up
            </button>

            {/* ── QRIS info card ─────────────────────────────────────────── */}
            <div className="mt-7 overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-sm">
              <div className="flex items-center gap-3 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg, #4f46e5, #8b5cf6)" }}>
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <path d="M14 14h3v3M21 14v.01M17 21h4M21 17v4" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-extrabold" style={{ color: "#1e293b" }}>
                    QRIS (BuatQris)
                  </p>
                  <p className="text-xs font-medium text-slate-500">
                    Scan QRIS untuk pembayaran mudah, cepat & aman
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-600">Mudah</span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600">Aman</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-600">Cepat</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Riwayat Top Up ─────────────────────────────────────────── */}
            <Link
              href="/history"
              className="mt-5 flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition active:scale-[0.99]"
            >
              <div>
                <p className="text-sm font-extrabold" style={{ color: "#1e293b" }}>
                  Riwayat Top Up
                </p>
                <p className="text-xs font-medium text-slate-400">
                  {recentCount} transaksi terakhir
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </Link>

            {/* ── Footer tip ─────────────────────────────────────────────── */}
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3">
              <span className="text-sm">💡</span>
              <p className="text-xs font-medium text-blue-600">
                Saldo akan otomatis masuk ke wallet setelah pembayaran berhasil
              </p>
            </div>
          </div>
        </div>

        {/* ── Automatic QRIS payment modal ──────────────────────────────── */}
        <AutomaticTopupModal
          open={qrisModalOpen}
          amount={topupAmount}
          onClose={() => setQrisModalOpen(false)}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}
