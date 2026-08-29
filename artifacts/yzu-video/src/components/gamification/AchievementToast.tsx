/**
 * AchievementToast — lightweight toast notification shown when an achievement
 * is unlocked. Auto-dismisses after a few seconds.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useLocation } from "wouter";

interface AchievementToastProps {
  open: boolean;
  achievement: {
    icon: string;
    name: string;
    description: string;
    expReward: number;
  } | null;
  onClose: () => void;
}

export function AchievementToast({ open, achievement, onClose }: AchievementToastProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && achievement && (
        <motion.div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm"
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-purple-100 overflow-hidden cursor-pointer"
            onClick={() => {
              onClose();
              navigate("/achievements");
            }}
          >
            <div className="flex items-center gap-3 p-3">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center text-2xl shrink-0">
                {achievement.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-extrabold text-purple-600 uppercase tracking-wide">
                  🎉 Achievement Unlocked!
                </p>
                <p className="text-sm font-bold text-slate-800 truncate">{achievement.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{achievement.description}</p>
                {achievement.expReward > 0 && (
                  <p className="text-[11px] font-bold text-purple-600">+{achievement.expReward} EXP</p>
                )}
              </div>
            </div>
            <div className="px-3 pb-2">
              <span className="text-[10px] font-bold text-purple-500">Lihat Achievement →</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
;
}
