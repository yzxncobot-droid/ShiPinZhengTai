/**
 * LevelUpModal — animated modal shown when a user levels up.
 * Displays old → new level, EXP gained, and any level reward.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

interface LevelUpModalProps {
  open: boolean;
  oldLevel: number;
  newLevel: number;
  expGained: number;
  reward?: string | null;
  onClose: () => void;
}

export function LevelUpModal({ open, oldLevel, newLevel, expGained, reward, onClose }: LevelUpModalProps) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="relative bg-white rounded-3xl p-8 max-w-xs w-full text-center shadow-2xl overflow-hidden"
            initial={{ scale: 0.5, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 30 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient background glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-100 via-pink-50 to-transparent" />

            {/* Confetti dots */}
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  left: `${15 + (i * 7) % 70}%`,
                  top: `${10 + (i * 13) % 30}%`,
                  backgroundColor: ["#8b5cf6", "#ec4899", "#f59e0b", "#3b82f6", "#22c55e"][i % 5],
                }}
                initial={{ y: 0, opacity: 0 }}
                animate={{ y: -20 - (i % 3) * 10, opacity: [0, 1, 0] }}
                transition={{ duration: 1.5, delay: i * 0.05, repeat: 2 }}
              />
            ))}

            <div className="relative z-10">
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="text-5xl mb-2"
              >
                ✨
              </motion.div>

              <h2 className="text-2xl font-extrabold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-1">
                LEVEL UP!
              </h2>

              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="text-lg font-bold text-slate-400">Lv.{oldLevel}</span>
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  →
                </motion.div>
                <motion.span
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.4, type: "spring" }}
                  className="text-3xl font-extrabold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent"
                >
                  {newLevel}
                </motion.span>
              </div>

              <p className="text-sm font-bold text-purple-600 mb-1">+{expGained} EXP</p>
              <p className="text-xs text-slate-500 mb-3">Teruskan perjalananmu!</p>

              {reward && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-2">
                  <p className="text-[10px] font-bold text-amber-600 uppercase">🎁 Reward Unlocked</p>
                  <p className="text-sm font-bold text-amber-800">{reward}</p>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-bold shadow-lg"
              >
                Lanjutkan
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
