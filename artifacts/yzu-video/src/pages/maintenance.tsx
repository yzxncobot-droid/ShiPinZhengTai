/**
 * /maintenance — shown to all non-owner users when Maintenance Mode is active.
 * Owners are never redirected here; they access the site normally.
 */
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-api";
import { Loader2, Wrench, Twitter, MessageCircle, Send, Clock, ExternalLink } from "lucide-react";

interface MaintenanceStatus {
  maintenanceEnabled: boolean;
  maintenanceTitle?: string;
  maintenanceDescription?: string;
  maintenanceImage?: string;
  maintenanceButtonText?: string;
  maintenanceRedirectUrl?: string;
  maintenanceEta?: string | null;
  maintenanceCountdown?: boolean;
  siteName?: string;
  logo?: string;
  discordLink?: string;
  whatsappLink?: string;
  telegramLink?: string;
}

// ── Countdown hook ────────────────────────────────────────────────────────────

function useCountdown(etaIso: string | null | undefined) {
  const calc = () => {
    if (!etaIso) return null;
    const ms = new Date(etaIso).getTime() - Date.now();
    if (ms <= 0) return { done: true, d: 0, h: 0, m: 0, s: 0 };
    const s = Math.floor(ms / 1000);
    return {
      done: false,
      d: Math.floor(s / 86400),
      h: Math.floor((s % 86400) / 3600),
      m: Math.floor((s % 3600) / 60),
      s: s % 60,
    };
  };

  const [time, setTime] = useState(calc);
  useEffect(() => {
    if (!etaIso) return;
    const id = setInterval(() => setTime(calc()), 1000);
    return () => clearInterval(id);
  }, [etaIso]);

  return time;
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
        <span className="text-2xl md:text-3xl font-black text-white tabular-nums">
          {String(value).padStart(2, "0")}
        </span>
      </div>
      <span className="text-[10px] md:text-xs font-bold text-white/60 mt-1.5 uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}

// ── Animated gears ────────────────────────────────────────────────────────────

function GearIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.622 10.395l-1.097-2.65L20 6l-2-2-1.735 1.483-2.707-1.113L12.935 2h-1.954l-.632 2.401-2.645 1.115L6 4 4 6l1.453 1.789-1.08 2.657L2 11v2l2.401.655L5.516 16.3 4 18l2 2 1.791-1.46 2.606 1.072L11 22h2l.604-2.387 2.651-1.098C16.697 19.388 18 20 18 20l2-2-1.484-1.75 1.098-2.652 2.386-.62V11l-2.378-.605Z" />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MaintenancePage() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const countdown = useCountdown(status?.maintenanceCountdown ? status?.maintenanceEta : null);

  useEffect(() => {
    adminFetch<MaintenanceStatus>("/settings/maintenance-status")
      .then(setStatus)
      .catch(() => setStatus({ maintenanceEnabled: true }));
  }, []);

  const title = status?.maintenanceTitle || "Sedang Dalam Pemeliharaan";
  const description =
    status?.maintenanceDescription ||
    "Kami sedang melakukan peningkatan untuk memberikan pengalaman yang lebih baik. Mohon tunggu sebentar.";
  const siteName = status?.siteName || "Yzu视频";
  const hasButton = !!(status?.maintenanceRedirectUrl && status?.maintenanceButtonText);
  const etaFormatted = status?.maintenanceEta
    ? new Date(status.maintenanceEta).toLocaleString("id-ID", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  const socials = [
    { link: status?.discordLink, label: "Discord", icon: <MessageCircle className="h-4 w-4" /> },
    { link: status?.whatsappLink, label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
    { link: status?.telegramLink, label: "Telegram", icon: <Send className="h-4 w-4" /> },
  ].filter(s => !!s.link);

  return (
    <div className="min-h-[100dvh] w-full relative overflow-hidden bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e] flex flex-col items-center justify-center px-4 py-12">

      {/* Decorative blobs */}
      <div className="absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-purple-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[35vw] h-[35vw] rounded-full bg-pink-600/20 blur-[100px] pointer-events-none" />

      {/* Animated gears — decorative */}
      <div className="absolute top-8 right-8 text-white/10 animate-spin" style={{ animationDuration: "12s" }}>
        <GearIcon size={80} />
      </div>
      <div className="absolute bottom-16 left-8 text-white/10 animate-spin" style={{ animationDuration: "8s", animationDirection: "reverse" }}>
        <GearIcon size={56} />
      </div>
      <div className="absolute top-1/2 right-4 text-white/5 animate-spin" style={{ animationDuration: "20s" }}>
        <GearIcon size={120} />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-lg text-center flex flex-col items-center gap-6">

        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-2">
          {status?.logo ? (
            <img src={status.logo} alt={siteName} className="h-10 object-contain" />
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
                <Wrench className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-black text-white">{siteName}</span>
            </div>
          )}
        </div>

        {/* Illustration */}
        {status?.maintenanceImage ? (
          <img
            src={status.maintenanceImage}
            alt="Maintenance"
            className="w-48 h-48 object-contain rounded-3xl"
          />
        ) : (
          <div className="relative w-44 h-44 flex items-center justify-center">
            {/* Pulsing ring */}
            <div className="absolute inset-0 rounded-full bg-purple-500/10 animate-ping" style={{ animationDuration: "2s" }} />
            <div className="absolute inset-4 rounded-full bg-purple-500/10 animate-ping" style={{ animationDuration: "2s", animationDelay: "0.3s" }} />
            {/* Center icon */}
            <div className="relative h-28 w-28 rounded-3xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-xl">
              <div className="animate-spin" style={{ animationDuration: "4s" }}>
                <GearIcon size={56} className="text-purple-300" />
              </div>
            </div>
          </div>
        )}

        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-black text-white leading-tight">
          {title}
        </h1>

        {/* Description */}
        <p className="text-base text-white/70 max-w-md leading-relaxed">
          {description}
        </p>

        {/* ETA */}
        {etaFormatted && (
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl px-4 py-2.5">
            <Clock className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-sm text-white/80 font-medium">
              Estimasi selesai: <strong className="text-white">{etaFormatted}</strong>
            </span>
          </div>
        )}

        {/* Countdown timer */}
        {status?.maintenanceCountdown && status?.maintenanceEta && countdown && !countdown.done && (
          <div className="flex items-center gap-3 md:gap-4">
            <CountdownUnit value={countdown.d} label="Hari" />
            <span className="text-2xl font-black text-white/40 mb-5">:</span>
            <CountdownUnit value={countdown.h} label="Jam" />
            <span className="text-2xl font-black text-white/40 mb-5">:</span>
            <CountdownUnit value={countdown.m} label="Menit" />
            <span className="text-2xl font-black text-white/40 mb-5">:</span>
            <CountdownUnit value={countdown.s} label="Detik" />
          </div>
        )}
        {countdown?.done && (
          <div className="bg-green-500/20 border border-green-400/30 rounded-2xl px-4 py-2.5">
            <p className="text-sm font-bold text-green-300">⏰ Waktu estimasi telah berlalu — segera online!</p>
          </div>
        )}

        {/* Button */}
        {hasButton && (
          <a
            href={status!.maintenanceRedirectUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-extrabold text-sm shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105 transition-all active:scale-95"
          >
            {status!.maintenanceButtonText}
            <ExternalLink className="h-4 w-4" />
          </a>
        )}

        {/* Social links */}
        {socials.length > 0 && (
          <div className="flex items-center gap-3 mt-2">
            {socials.map(s => (
              <a
                key={s.label}
                href={s.link!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all text-xs font-medium"
              >
                {s.icon}
                {s.label}
              </a>
            ))}
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-white/30 mt-4">
          &copy; {new Date().getFullYear()} {siteName}. All rights reserved.
        </p>
      </div>
    </div>
  );
}
