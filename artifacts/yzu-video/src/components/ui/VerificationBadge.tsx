import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Crown, ShieldCheck, CheckCircle2 } from "lucide-react";

/** Combined badge: verification (blue/gold/sulthan) + role (owner/admin) */
export interface BadgeProps {
  verificationBadge?: string | null;  // "blue" | "gold" | "sulthan" | null
  role?: string;                       // "owner" | "admin" | "meril" | "user"
  subscriptionStatus?: string;         // "active" | "none" | "expired"
  size?: "xs" | "sm" | "md";
  showTooltip?: boolean;
}

const SIZE = {
  xs: { box: "h-3.5 w-3.5", icon: "h-2 w-2",    text: "text-[7px]"  },
  sm: { box: "h-4 w-4",     icon: "h-2.5 w-2.5", text: "text-[8px]"  },
  md: { box: "h-5 w-5",     icon: "h-3 w-3",     text: "text-[9px]"  },
};

function Wrap({ show, tooltip, children }: { show: boolean; tooltip: string; children: React.ReactNode }) {
  if (!show) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children as React.ReactElement}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs px-2 py-1">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Single inline badge icon. Returns null if nothing to show. */
export function VerificationBadge({
  verificationBadge, role, subscriptionStatus, size = "sm", showTooltip = true,
}: BadgeProps) {
  const s = SIZE[size];

  // Sulthan — highest priority
  if (verificationBadge === "sulthan") {
    return (
      <Wrap show={showTooltip} tooltip="👑 Sulthan — Top Creator #1">
        <span className={`inline-flex items-center justify-center ${s.box} rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 shadow-sm shrink-0`}>
          <Crown className={`${s.icon} text-white`} />
        </span>
      </Wrap>
    );
  }

  // Gold verified
  if (verificationBadge === "gold") {
    return (
      <Wrap show={showTooltip} tooltip="✓ Gold Verified — Official Brand/Partner">
        <span className={`inline-flex items-center justify-center ${s.box} rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 shadow-sm shrink-0`}>
          <CheckCircle2 className={`${s.icon} text-white`} />
        </span>
      </Wrap>
    );
  }

  // Blue verified
  if (verificationBadge === "blue") {
    return (
      <Wrap show={showTooltip} tooltip="✓ Verified Creator">
        <span className={`inline-flex items-center justify-center ${s.box} rounded-full bg-blue-500 shadow-sm shrink-0`}>
          <CheckCircle2 className={`${s.icon} text-white`} />
        </span>
      </Wrap>
    );
  }

  // Role-derived badges
  if (role === "owner") {
    return (
      <Wrap show={showTooltip} tooltip="Platform Owner">
        <span className={`inline-flex items-center justify-center ${s.box} rounded-full bg-purple-600 shadow-sm shrink-0`}>
          <Crown className={`${s.icon} text-white`} />
        </span>
      </Wrap>
    );
  }
  if (role === "admin") {
    return (
      <Wrap show={showTooltip} tooltip="Platform Admin">
        <span className={`inline-flex items-center justify-center ${s.box} rounded-full bg-blue-600 shadow-sm shrink-0`}>
          <ShieldCheck className={`${s.icon} text-white`} />
        </span>
      </Wrap>
    );
  }

  return null;
}

/** Compact pill badge — used in leaderboard / profile header for Sulthan label */
export function SulthanPill({ size = "sm" }: { size?: "sm" | "md" }) {
  const cls = size === "md"
    ? "text-[11px] px-2.5 py-1"
    : "text-[9px] px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-center gap-1 ${cls} rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 text-white font-extrabold shadow-sm`}>
      <Crown className="h-3 w-3" />
      Sulthan
    </span>
  );
}

/** Badge name string for display */
export function badgeLabel(badge: string | null | undefined, role?: string): string {
  if (badge === "sulthan") return "👑 Sulthan";
  if (badge === "gold")    return "✓ Gold Verified";
  if (badge === "blue")    return "✓ Verified";
  if (role === "owner")    return "Owner";
  if (role === "admin")    return "Admin";
  return "";
}
