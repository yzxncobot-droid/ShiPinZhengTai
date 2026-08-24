import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, MessageCircle, Copy, Check, X } from "lucide-react";
import type { HomeFeedReward, HomeFeedRewardType } from "@/lib/home-feed-api";
import { claimHomeFeedReward } from "@/lib/home-feed-api";

interface RewardModalProps {
  open: boolean;
  onClose: () => void;
  videoId: string;
  reward: HomeFeedReward;
  onClaimed?: () => void;
}

const REWARD_LABEL: Record<HomeFeedRewardType, string> = {
  LIKE: "Like",
  COMMENT: "Komentar",
  NONE: "Reward",
};

export function RewardModal({ open, onClose, videoId, reward, onClaimed }: RewardModalProps) {
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ code: string; rewardType: HomeFeedRewardType } | null>(null);
  const [copied, setCopied] = useState(false);

  const unlocked = reward.isUnlocked;
  const Icon = reward.rewardType === "COMMENT" ? MessageCircle : Star;

  async function handleClaim() {
    if (!unlocked || claiming) return;
    setClaiming(true);
    try {
      const res = await claimHomeFeedReward(videoId);
      if (res.unlocked && res.rewardCode) {
        setClaimResult({ code: res.rewardCode, rewardType: res.rewardType });
        onClaimed?.();
      }
    } catch {
      // ignore — modal stays in locked state
    } finally {
      setClaiming(false);
    }
  }

  function copyCode() {
    if (!claimResult) return;
    navigator.clipboard?.writeText(claimResult.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <motion.div
            className="relative w-full max-w-[340px] rounded-[28px] bg-gradient-to-b from-violet-500 to-purple-700 p-6 shadow-2xl text-center"
            initial={{ scale: 0.85, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            {!unlocked ? (
              /* ── Locked state ── */
              <>
                <motion.div
                  className="mx-auto mb-3 h-16 w-16 rounded-full bg-white/20 flex items-center justify-center"
                  animate={{ rotate: [0, -8, 8, 0] }}
                  transition={{ repeat: Infinity, duration: 2.4 }}
                >
                  <Icon className="h-8 w-8 text-yellow-300" fill="currentColor" />
                </motion.div>
                <h3 className="text-lg font-extrabold text-white">
                  {REWARD_LABEL[reward.rewardType]} Reward Belum Terbuka
                </h3>
                <p className="mt-1.5 text-sm text-white/85 leading-relaxed">
                  Kumpulkan <span className="font-bold text-yellow-300">{reward.target} {REWARD_LABEL[reward.rewardType]}</span> pada video ini
                  untuk membuka kode reward.
                </p>

                {/* Progress */}
                <div className="mt-4">
                  <div className="flex justify-between text-xs font-bold text-white/90 mb-1.5">
                    <span>Progress</span>
                    <span>{reward.total} / {reward.target}</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-white/20 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-yellow-300 to-orange-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${reward.progress}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                  <p className="mt-2 text-2xl font-extrabold text-yellow-300">{reward.progress}%</p>
                </div>

                <button
                  onClick={onClose}
                  className="mt-5 w-full rounded-full bg-white/20 hover:bg-white/30 text-white font-bold text-sm py-2.5 transition-colors"
                >
                  Mengerti
                </button>
              </>
            ) : !claimResult ? (
              /* ── Unlocked, not yet claimed ── */
              <>
                <motion.div
                  className="mx-auto mb-3 h-16 w-16 rounded-full bg-yellow-400 flex items-center justify-center"
                  animate={{ scale: [1, 1.12, 1] }}
                  transition={{ repeat: Infinity, duration: 1.6 }}
                >
                  <Star className="h-8 w-8 text-white" fill="currentColor" />
                </motion.div>
                <h3 className="text-lg font-extrabold text-white">🎉 Reward Terbuka!</h3>
                <p className="mt-1.5 text-sm text-white/85">Target berhasil dicapai! Tekan tombol di bawah untuk mengambil kode reward.</p>
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="mt-5 w-full rounded-full bg-yellow-400 hover:bg-yellow-300 text-purple-800 font-extrabold text-sm py-2.5 transition-colors disabled:opacity-60"
                >
                  {claiming ? "Mengambil..." : "Ambil Kode Reward"}
                </button>
              </>
            ) : (
              /* ── Code revealed ── */
              <>
                <motion.div
                  className="mx-auto mb-3 h-16 w-16 rounded-full bg-yellow-400 flex items-center justify-center"
                  animate={{ rotate: [0, 360], scale: [1, 1.15, 1] }}
                  transition={{ rotate: { duration: 0.6 }, scale: { duration: 0.6 } }}
                >
                  <Star className="h-8 w-8 text-white" fill="currentColor" />
                </motion.div>
                <h3 className="text-lg font-extrabold text-white">🎉 REWARD TERBUKA!</h3>
                <p className="mt-1.5 text-sm text-white/85">Target berhasil dicapai!</p>

                <p className="mt-4 text-xs font-bold text-white/70 uppercase tracking-wider">Kode</p>
                <div className="mt-1.5 rounded-2xl bg-white/15 border-2 border-dashed border-white/40 px-4 py-3">
                  <p className="text-xl font-extrabold tracking-[0.2em] text-yellow-300 select-all">
                    {claimResult.code}
                  </p>
                </div>

                <button
                  onClick={copyCode}
                  className="mt-4 w-full rounded-full bg-yellow-400 hover:bg-yellow-300 text-purple-800 font-extrabold text-sm py-2.5 transition-colors flex items-center justify-center gap-2"
                >
                  {copied ? <><Check className="h-4 w-4" /> Tersalin!</> : <><Copy className="h-4 w-4" /> Salin Kode</>}
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
