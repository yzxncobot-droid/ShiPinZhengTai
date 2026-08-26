/**
 * LevelBadge — reusable component for displaying a user's level badge.
 * Shows the level number + tier icon/name. Compact enough for chat, comments,
 * video cards, and profile headers.
 */

import { useState, useRef, useEffect } from "react";
import { useUserBadgeInfo, type DisplayBadge } from "@/lib/gamification-api";
import { MiniProfileCard } from "./MiniProfileCard";

interface LevelBadgeProps {
  userId: string;
  username?: string;
  avatar?: string | null;
  size?: "xs" | "sm" | "md";
  showLevel?: boolean;
  showBadges?: boolean;
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: { level: "text-[8px] px-1 py-0.5", badge: "text-[8px]", gap: "gap-0.5" },
  sm: { level: "text-[9px] px-1.5 py-0.5", badge: "text-[9px]", gap: "gap-1" },
  md: { level: "text-[10px] px-2 py-0.5", badge: "text-[10px]", gap: "gap-1" },
};

export function LevelBadge({
  userId, username, avatar, size = "sm", showLevel = true, showBadges = true, onClick,
}: LevelBadgeProps) {
  const { data: badgeInfo, isLoading } = useUserBadgeInfo(userId);
  const [showMiniCard, setShowMiniCard] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const s = SIZE_MAP[size];

  // Close mini card when clicking outside
  useEffect(() => {
    if (!showMiniCard) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMiniCard(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMiniCard]);

  if (isLoading || !badgeInfo) {
    return showLevel ? (
      <span className={`inline-flex items-center ${s.gap}`}>
        <span className={`bg-slate-100 text-slate-400 font-bold rounded-full ${s.level} animate-pulse`}>Lv.?</span>
      </span>
    ) : null;
  }

  const levelBadge = badgeInfo.levelBadge;
  const displayBadges = (badgeInfo.displayBadges ?? []).slice(0, 2);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (onClick) onClick();
          else setShowMiniCard(!showMiniCard);
        }}
        className={`inline-flex items-center ${s.gap} transition-transform hover:scale-105`}
      >
        {showLevel && (
          <span
            className="font-bold rounded-full inline-flex items-center gap-0.5 whitespace-nowrap"
            style={{
              backgroundColor: `${levelBadge.color}20`,
              color: levelBadge.color,
              fontSize: s.level,
              padding: size === "xs" ? "1px 4px" : "2px 6px",
            }}
          >
            <span>{levelBadge.icon}</span>
            <span>Lv.{badgeInfo.level}</span>
          </span>
        )}
        {showBadges && displayBadges.map((badge: DisplayBadge, i: number) => (
          <span
            key={i}
            className="inline-flex items-center justify-center rounded-full shrink-0"
            style={{
              backgroundColor: `${badge.color}20`,
              fontSize: s.badge,
              width: size === "xs" ? 14 : 16,
              height: size === "xs" ? 14 : 16,
            }}
            title={badge.name}
          >
            {badge.icon}
          </span>
        ))}
      </button>

      {showMiniCard && (
        <MiniProfileCard
          userId={userId}
          username={username}
          avatar={avatar}
          onClose={() => setShowMiniCard(false)}
        />
      )}
    </div>
  );
}
