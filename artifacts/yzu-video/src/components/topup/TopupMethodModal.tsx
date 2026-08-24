import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, ShieldCheck, Clock, Sparkles, Check } from "lucide-react";
import { getToken } from "@/lib/admin-api";

interface FeeConfig {
  automaticFeeType: string; // 'percentage' | 'fixed'
  automaticFeeRate: number;
}

export type TopupMethod = "manual" | "automatic";

export function TopupMethodModal({
  open,
  amount,
  onClose,
  onSelect,
}: {
  open: boolean;
  amount: number;
  onClose: () => void;
  onSelect: (method: TopupMethod) => void;
}) {
  const [feeConfig, setFeeConfig] = useState<FeeConfig | null>(null);
  const [selected, setSelected] = useState<TopupMethod | null>(null);

  const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  // Fetch fee config from backend (never hardcoded in frontend)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const token = getToken();
        const res = await fetch("/api/topup/fee-config", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!cancelled) setFeeConfig(data);
      } catch {
        if (!cancelled) setFeeConfig({ automaticFeeType: "percentage", automaticFeeRate: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Reset selection when reopened
  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  const serviceFee =
    feeConfig?.automaticFeeType === "fixed"
      ? Math.round(feeConfig.automaticFeeRate ?? 0)
      : Math.round((amount * (feeConfig?.automaticFeeRate ?? 0)) / 100);

  const totalAutomatic = amount + serviceFee;

  const handleConfirm = () => {
    if (!selected) return;
    onSelect(selected);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div
              className="relative px-5 py-5 text-white"
              style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
            >
              <button
                onClick={onClose}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30"
                aria-label="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-extrabold leading-tight">Pilih Metode Top Up</h2>
              <p className="mt-1 text-xs font-medium text-white/80">
                Pilih cara pembayaran yang paling sesuai.
              </p>
            </div>

            {/* ── Body ────────────────────────────────────────────────────── */}
            <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* ── MANUAL CARD ─────────────────────────────────────────── */}
                <button
                  onClick={() => setSelected("manual")}
                  className={`relative flex flex-col rounded-2xl border-2 p-5 text-left transition-all active:scale-[0.98] ${
                    selected === "manual"
                      ? "border-violet-500 bg-violet-50 shadow-md"
                      : "border-slate-200 bg-white hover:border-violet-300"
                  }`}
                >
                  {/* Selected indicator */}
                  {selected === "manual" && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-violet-500"
                    >
                      <Check className="h-3.5 w-3.5 text-white" />
                    </motion.div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100">
                      <span className="text-2xl">🧾</span>
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold" style={{ color: "#263238" }}>
                        Top Up Manual
                      </h3>
                    </div>
                  </div>

                  <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-600">
                    Tanpa Biaya Tambahan
                  </span>

                  <p className="mt-3 text-xs font-medium leading-relaxed text-slate-500">
                    Bayar melalui QRIS tanpa biaya layanan tambahan. Setelah
                    pembayaran dilakukan, kirim konfirmasi dan tunggu verifikasi
                    dari admin sebelum saldo ditambahkan.
                  </p>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span>Menunggu persetujuan admin</span>
                    </div>
                    <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <span className="text-base leading-none">💰</span>
                      <span>Saldo masuk setelah pembayaran diverifikasi</span>
                    </div>
                    <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                      <span>Pembayaran diperiksa secara manual untuk memastikan nominal dan bukti pembayaran sesuai.</span>
                    </div>
                  </div>

                  {/* Fee breakdown */}
                  <div className="mt-4 rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Top Up</span>
                      <span className="font-bold text-slate-700">{fmtRp(amount)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Biaya layanan</span>
                      <span className="font-bold text-emerald-600">{fmtRp(0)}</span>
                    </div>
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span style={{ color: "#263238" }}>Total pembayaran</span>
                        <span style={{ color: "#4F2DAA" }}>{fmtRp(amount)}</span>
                      </div>
                    </div>
                  </div>
                </button>

                {/* ── AUTOMATIC CARD ────────────────────────────────────── */}
                <button
                  onClick={() => setSelected("automatic")}
                  className={`relative flex flex-col rounded-2xl border-2 p-5 text-left transition-all active:scale-[0.98] ${
                    selected === "automatic"
                      ? "border-violet-500 bg-violet-50 shadow-md"
                      : "border-slate-200 bg-white hover:border-violet-300"
                  }`}
                >
                  {/* Recommended badge */}
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                    Rekomendasi
                  </span>

                  {/* Selected indicator */}
                  {selected === "automatic" && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-violet-500"
                    >
                      <Check className="h-3.5 w-3.5 text-white" />
                    </motion.div>
                  )}

                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100">
                      <Zap className="h-6 w-6 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold" style={{ color: "#263238" }}>
                        Top Up Otomatis
                      </h3>
                    </div>
                  </div>

                  <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-600">
                    <Zap className="h-3 w-3" /> Saldo Otomatis
                  </span>

                  <p className="mt-3 text-xs font-medium leading-relaxed text-slate-500">
                    Top up lebih cepat dan praktis. Bayar melalui QRIS dengan
                    biaya layanan yang ditampilkan secara transparan. Setelah
                    pembayaran berhasil terdeteksi, saldo akan ditambahkan
                    otomatis tanpa perlu menunggu persetujuan admin.
                  </p>

                  <div className="mt-4 space-y-2">
                    <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <span className="text-base leading-none">💳</span>
                      <span>
                        Biaya layanan:{" "}
                        {feeConfig
                          ? feeConfig.automaticFeeType === "fixed"
                            ? fmtRp(feeConfig.automaticFeeRate)
                            : `${feeConfig.automaticFeeRate}%`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span>Verifikasi pembayaran otomatis</span>
                    </div>
                    <div className="flex items-start gap-2 text-xs font-medium text-slate-600">
                      <span className="text-base leading-none">💰</span>
                      <span>Saldo langsung masuk setelah pembayaran berhasil</span>
                    </div>
                  </div>

                  {/* Fee breakdown */}
                  <div className="mt-4 rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Top Up</span>
                      <span className="font-bold text-slate-700">{fmtRp(amount)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Biaya layanan</span>
                      <span className="font-bold text-amber-600">{fmtRp(serviceFee)}</span>
                    </div>
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span style={{ color: "#263238" }}>Total pembayaran</span>
                        <span style={{ color: "#4F2DAA" }}>{fmtRp(totalAutomatic)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>

              {/* ── Confirm button ──────────────────────────────────────── */}
              <button
                onClick={handleConfirm}
                disabled={!selected}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #7B4DFF 0%, #6D3DFF 100%)" }}
              >
                <Sparkles className="h-4 w-4" />
                {selected === "manual"
                  ? "Gunakan Manual"
                  : selected === "automatic"
                    ? "Gunakan Otomatis"
                    : "Pilih Metode"}
              </button>

              <p className="mt-3 text-center text-[11px] font-medium text-slate-400">
                Saldo tidak akan berubah hanya dengan memilih metode.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
