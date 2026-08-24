import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useListMyTopups } from "@workspace/api-client-react";
import { Sparkles, Pencil, Star, Heart, ChevronRight, Wallet } from "lucide-react";
import { AutomaticTopupModal } from "@/components/topup/AutomaticTopupModal";
import { TopupMethodModal, type TopupMethod } from "@/components/topup/TopupMethodModal";
import { ManualTopupModal } from "@/components/topup/ManualTopupModal";

const MIN_TOPUP = 100;

const PRESETS = [
  { amount: 1_000, emoji: "⭐", bg: "bg-amber-100" },
  { amount: 3_000, emoji: "🦕", bg: "bg-emerald-100" },
  { amount: 5_000, emoji: "🚀", bg: "bg-violet-100" },
  { amount: 10_000, emoji: "🦄", bg: "bg-pink-100" },
  { amount: 20_000, emoji: "🪐", bg: "bg-sky-100" },
  { amount: 50_000, emoji: "💰", bg: "bg-orange-100" },
];

const PAYMENT_METHODS = [
  { label: "GoPay", color: "#00AED6" },
  { label: "OVO", color: "#4C3494" },
  { label: "DANA", color: "#118EEA" },
  { label: "ShopeePay", color: "#EE4D2D" },
  { label: "LinkAja", color: "#E82529" },
  { label: "BCA", color: "#0066AE" },
  { label: "BRI", color: "#00529C" },
  { label: "Mandiri", color: "#003087" },
  { label: "BNI", color: "#F47920" },
  { label: "BSI", color: "#006233" },
  { label: "CIMB Niaga", color: "#C1392B" },
];

const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

export default function TopupPage() {
  const { user } = useAuth();
  const { data: topupsData } = useListMyTopups({ limit: "5" });

  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState<string>("");
  const [methodModalOpen, setMethodModalOpen] = useState(false);
  const [methodAmount, setMethodAmount] = useState<number>(0);
  const [qrisModalOpen, setQrisModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);

  const balance = user?.walletBalance ?? 0;
  const recentCount = topupsData?.total ?? 0;

  const openMethodModal = (amount: number) => {
    setMethodAmount(amount);
    setMethodModalOpen(true);
  };

  const handlePreset = (amount: number) => {
    setSelected(amount);
    setCustom("");
    openMethodModal(amount);
  };

  const handleCustomTopup = () => {
    const amount = Number(custom);
    if (!Number.isInteger(amount) || amount < MIN_TOPUP) return;
    setSelected(null);
    openMethodModal(amount);
  };

  const handleMethodSelect = (method: TopupMethod) => {
    setMethodModalOpen(false);
    if (method === "automatic") {
      setQrisModalOpen(true);
    } else {
      setManualModalOpen(true);
    }
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="min-h-[calc(100dvh-64px)] bg-[#EBF6FF] pb-8">
          <div className="mx-auto max-w-md px-5 pt-6">
            {/* ── Brand tag ──────────────────────────────────────────────── */}
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm">
                <Sparkles className="h-4 w-4 text-violet-500" />
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-violet-500">
                FUN+ Premium Kids Platform
              </span>
            </div>

            {/* ── Hero ───────────────────────────────────────────────────── */}
            <h1 className="text-3xl font-extrabold leading-tight" style={{ color: "#263238" }}>
              Top Up Saldo
            </h1>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
              Isi saldo via QRIS — diterima oleh semua bank & e-wallet di Indonesia.
            </p>

            {/* Balance card */}
            <div className="relative mt-5 overflow-hidden rounded-3xl p-5 shadow-lg" style={{ background: "linear-gradient(135deg, #7E57C2 0%, #6D3DFF 100%)" }}>
              <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full border-[14px] border-white/10" />
              <div className="relative z-10 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/70">
                    SALDO SAAT INI
                  </p>
                  <p className="mt-1 text-3xl font-extrabold text-white">{fmtRp(balance)}</p>
                </div>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15">
                  <Wallet className="h-8 w-8 text-white" />
                </div>
              </div>
            </div>

            {/* ── Pilih Nominal ──────────────────────────────────────────── */}
            <h2 className="mt-7 text-lg font-extrabold" style={{ color: "#263238" }}>
              Pilih Nominal
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {PRESETS.map(({ amount, emoji, bg }) => {
                const active = selected === amount;
                return (
                  <button
                    key={amount}
                    onClick={() => handlePreset(amount)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border-2 bg-white p-3 transition active:scale-95 ${
                      active ? "border-violet-500 shadow-md" : "border-slate-100"
                    }`}
                  >
                    <span className={`flex h-11 w-11 items-center justify-center rounded-full text-2xl ${bg}`}>
                      {emoji}
                    </span>
                    <span className="text-sm font-extrabold" style={{ color: "#263238" }}>
                      {fmtRp(amount)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── Custom nominal ─────────────────────────────────────────── */}
            <h2 className="mt-6 text-lg font-extrabold" style={{ color: "#263238" }}>
              Atau Nominal Custom
            </h2>
            <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-slate-100 bg-white p-2 pl-4">
              <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="number"
                inputMode="numeric"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Masukkan nominal lain"
                className="h-10 w-full bg-transparent text-sm font-bold outline-none placeholder:font-medium placeholder:text-slate-400"
                style={{ color: "#263238" }}
              />
            </div>
            <p className="mt-1.5 pl-1 text-xs font-medium text-slate-400">Minimal {fmtRp(MIN_TOPUP)}</p>

            <button
              onClick={handleCustomTopup}
              disabled={!custom || Number(custom) < MIN_TOPUP}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #7E57C2 0%, #6D3DFF 100%)" }}
            >
              <Star className="h-4 w-4 fill-white" />
              TopUp
            </button>

            {/* ── Metode Pembayaran ─────────────────────────────────────── */}
            <div className="mt-7 flex items-center gap-2">
              <Heart className="h-4 w-4 text-pink-500" />
              <h2 className="text-lg font-extrabold" style={{ color: "#263238" }}>
                Metode Pembayaran
              </h2>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {PAYMENT_METHODS.map((m) => (
                <div
                  key={m.label}
                  className="flex h-12 items-center justify-center rounded-xl border border-slate-100 bg-white px-1"
                >
                  <span className="truncate text-center text-[11px] font-extrabold" style={{ color: m.color }}>
                    {m.label}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Riwayat Top Up ─────────────────────────────────────────── */}
            <Link
              href="/history"
              className="mt-7 flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 transition active:scale-[0.99]"
            >
              <div>
                <p className="text-sm font-extrabold" style={{ color: "#263238" }}>
                  Riwayat Top Up
                </p>
                <p className="text-xs font-medium text-slate-400">
                  {recentCount} transaksi terakhir
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </Link>
          </div>
        </div>

        {/* ── Method selection modal ────────────────────────────────────── */}
        <TopupMethodModal
          open={methodModalOpen}
          amount={methodAmount}
          onClose={() => setMethodModalOpen(false)}
          onSelect={handleMethodSelect}
        />

        {/* ── Automatic QRIS payment modal ──────────────────────────────── */}
        <AutomaticTopupModal
          open={qrisModalOpen}
          amount={methodAmount}
          onClose={() => setQrisModalOpen(false)}
        />

        {/* ── Manual QRIS payment modal ─────────────────────────────────── */}
        <ManualTopupModal
          open={manualModalOpen}
          amount={methodAmount}
          onClose={() => setManualModalOpen(false)}
        />
      </AppLayout>
    </ProtectedRoute>
  );
}
