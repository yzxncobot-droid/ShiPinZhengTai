import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { adminFetch } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Wallet, Info, Send, Loader2, ShieldAlert, Sparkles, Clock,
} from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────────────
const MIN_WITHDRAWAL = 5000;
const WEEKLY_LIMIT = 10000;

const PRESETS = [5_000, 6_000, 7_000, 8_000, 9_000, 10_000];

const CREATOR_ROLES = ["creator", "verified_creator", "admin", "owner"];

const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

type Method = "bank" | "ewallet";

// ── Access-denied screen for non-Creator roles ───────────────────────────────
function AccessDenied() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-50">
            <ShieldAlert className="h-10 w-10 text-amber-500" />
          </div>
          <h1 className="mt-5 text-xl font-extrabold text-slate-800">
            Akses Ditolak
          </h1>
          <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
            Hanya role Creator yang dapat mengakses fitur withdraw.
          </p>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function WithdrawPage() {
  const { user: authUser } = useAuth();
  const { data: freshUser } = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const user = freshUser || authUser;

  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState<Method>("bank");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [weeklyRemaining, setWeeklyRemaining] = useState<number>(WEEKLY_LIMIT);

  const loadWeeklyStatus = async () => {
    try {
      const data = await adminFetch<{ used: number; limit: number; remaining: number }>(
        "/withdrawals/weekly-status",
      );
      setWeeklyRemaining(data.remaining);
    } catch {
      // keep default
    }
  };

  // Load remaining weekly quota once the page mounts. (must stay above any
  // conditional return to respect the Rules of Hooks)
  useEffect(() => {
    loadWeeklyStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Role gate — only Creator and above can use the feature.
  if (user && !CREATOR_ROLES.includes(user.role)) {
    return <AccessDenied />;
  }

  const balance = user?.walletBalance ?? 0;

  // The effective amount currently chosen.
  const amount = selected ?? (custom ? Number(custom) : 0);
  const amountValid = amount >= MIN_WITHDRAWAL && amount <= weeklyRemaining;
  const fieldsValid =
    bankName.trim().length > 0 && accountNumber.trim().length > 0;
  const canSubmit = amountValid && fieldsValid && !submitting;

  const selectPreset = (value: number) => {
    setSelected(value);
    setCustom("");
  };

  const selectCustom = (raw: string) => {
    setCustom(raw);
    setSelected(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await adminFetch("/withdrawals", {
        method: "POST",
        body: JSON.stringify({
          amount,
          method,
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim(),
        }),
      });
      toast({
        title: "Permintaan Withdraw Terkirim",
        description: `Penarikan ${fmtRp(amount)} sedang diproses admin (1×24 jam kerja).`,
      });
      // Refresh balance + weekly quota.
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      await loadWeeklyStatus();
      // Reset form.
      setSelected(null);
      setCustom("");
      setBankName("");
      setAccountNumber("");
    } catch (err: any) {
      toast({
        title: "Gagal Mengirim Permintaan",
        description: err?.message ?? "Terjadi kesalahan. Coba lagi nanti.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="min-h-[calc(100dvh-64px)] bg-[#F9FAFB] pb-8">
          <div className="mx-auto max-w-md px-5 pt-6">
            {/* ── Brand tag ──────────────────────────────────────────────── */}
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm">
                <Sparkles className="h-4 w-4 text-[#6C3DF5]" />
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#6C3DF5]">
                FUN+ Premium Kids Platform
              </span>
            </div>

            {/* ── Hero ───────────────────────────────────────────────────── */}
            <h1 className="text-3xl font-extrabold leading-tight text-[#1F2937]">
              Withdraw Saldo
            </h1>
            <p className="mt-2 text-sm font-medium leading-relaxed text-[#6B7280]">
              Tarik saldo kamu ke rekening atau e-wallet dengan mudah &amp; aman.
            </p>

            {/* ── Balance card ───────────────────────────────────────────── */}
            <div
              className="relative mt-5 overflow-hidden rounded-3xl p-5 shadow-lg"
              style={{ background: "linear-gradient(135deg, #6C3DF5 0%, #8A5CF6 100%)" }}
            >
              <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full border-[14px] border-white/10" />
              <div className="relative z-10 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/70">
                    SALDO SAAT INI
                  </p>
                  <p className="mt-1 text-3xl font-extrabold text-white">{fmtRp(balance)}</p>
                  <p className="mt-1 text-[11px] font-medium text-white/60">
                    Saldo dapat ditarik minimal {fmtRp(MIN_WITHDRAWAL)}
                  </p>
                </div>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15">
                  <Wallet className="h-8 w-8 text-white" />
                </div>
              </div>
            </div>

            {/* ── Weekly limit banner ────────────────────────────────────── */}
            <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3">
              <Clock className="h-4 w-4 shrink-0 text-[#6C3DF5]" />
              <p className="text-xs font-medium leading-snug text-purple-700">
                Batas penarikan <span className="font-extrabold">{fmtRp(WEEKLY_LIMIT)}</span> per minggu.
                Sisa kuota minggu ini: <span className="font-extrabold">{fmtRp(weeklyRemaining)}</span>
              </p>
            </div>

            {/* ── 1. Pilih Nominal ───────────────────────────────────────── */}
            <h2 className="mt-7 text-lg font-extrabold text-[#1F2937]">
              1. Pilih Nominal
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {PRESETS.map((value, i) => {
                const active = selected === value;
                const disabled = value > weeklyRemaining;
                return (
                  <button
                    key={value}
                    onClick={() => !disabled && selectPreset(value)}
                    disabled={disabled}
                    className={`relative flex flex-col items-center gap-1 rounded-2xl border-2 bg-white py-3 transition active:scale-95 ${
                      active ? "border-[#6C3DF5] shadow-md" : "border-[#E5E7EB]"
                    } ${disabled ? "opacity-40" : ""}`}
                  >
                    {i === 0 && (
                      <span className="absolute -top-2 right-2 rounded-full bg-[#6C3DF5] px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-white">
                        Min
                      </span>
                    )}
                    <span className="text-sm font-extrabold text-[#1F2937]">
                      {fmtRp(value)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── Custom nominal ────────────────────────────────────────── */}
            <h3 className="mt-6 text-base font-extrabold text-[#1F2937]">
              Atau Nominal Custom
            </h3>
            <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-[#E5E7EB] bg-white p-2 pl-4">
              <span className="text-sm font-bold text-slate-400">Rp</span>
              <input
                type="number"
                inputMode="numeric"
                value={custom}
                onChange={(e) => selectCustom(e.target.value)}
                placeholder="Masukkan nominal"
                className="h-10 w-full bg-transparent text-sm font-bold outline-none placeholder:font-medium placeholder:text-slate-400 text-[#1F2937]"
              />
            </div>
            <p className="mt-1.5 pl-1 text-xs font-medium text-slate-400">
              Minimal penarikan {fmtRp(MIN_WITHDRAWAL)}
            </p>

            {/* ── 2. Pilih Metode Penarikan ──────────────────────────────── */}
            <h2 className="mt-7 text-lg font-extrabold text-[#1F2937]">
              2. Pilih Metode Penarikan
            </h2>

            {/* Tabs */}
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              {(["bank", "ewallet"] as Method[]).map((m) => {
                const active = method === m;
                return (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`h-10 rounded-xl text-sm font-extrabold transition ${
                      active ? "bg-white text-[#6C3DF5] shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {m === "bank" ? "Rekening Bank" : "E-wallet"}
                  </button>
                );
              })}
            </div>

            {/* Method inputs */}
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600">
                  {method === "bank" ? "Nama Bank" : "Nama E-wallet"}
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder={method === "bank" ? "Contoh: BCA, Mandiri, BRI" : "Contoh: GoPay, OVO, DANA"}
                  className="h-12 w-full rounded-2xl border-2 border-[#E5E7EB] bg-white px-4 text-sm font-bold outline-none transition focus:border-[#6C3DF5] placeholder:font-medium placeholder:text-slate-400 text-[#1F2937]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600">
                  {method === "bank" ? "Nomor Rekening" : "Nomor E-wallet"}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder={method === "bank" ? "Masukkan nomor rekening" : "Masukkan nomor e-wallet"}
                  className="h-12 w-full rounded-2xl border-2 border-[#E5E7EB] bg-white px-4 text-sm font-bold outline-none transition focus:border-[#6C3DF5] placeholder:font-medium placeholder:text-slate-400 text-[#1F2937]"
                />
              </div>
            </div>

            {/* ── 3. Ringkasan Penarikan ─────────────────────────────────── */}
            <h2 className="mt-7 text-lg font-extrabold text-[#1F2937]">
              3. Ringkasan Penarikan
            </h2>
            <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-[#E5E7EB] bg-white px-4">
              <SummaryRow label="Nominal Penarikan" value={fmtRp(amount)} />
              <SummaryRow label="Biaya Admin" value={fmtRp(0)} />
              <SummaryRow label="Total Diterima" value={fmtRp(amount)} bold />
            </div>

            {/* Alert box */}
            <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-blue-50 px-4 py-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <p className="text-xs font-medium leading-snug text-blue-700">
                Proses withdraw akan memakan waktu 1×24 jam kerja. Pastikan data
                rekening/e-wallet sudah benar.
              </p>
            </div>

            {/* ── CTA ────────────────────────────────────────────────────── */}
            <motion.button
              whileTap={{ scale: canSubmit ? 0.97 : 1 }}
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-extrabold text-white shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #6C3DF5 0%, #8A5CF6 100%)" }}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Mengirim...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Kirim Permintaan Withdraw
                </>
              )}
            </motion.button>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm font-medium text-[#6B7280]">{label}</span>
      <span className={`text-sm ${bold ? "font-extrabold text-[#1F2937]" : "font-bold text-[#1F2937]"}`}>
        {value}
      </span>
    </div>
  );
}
