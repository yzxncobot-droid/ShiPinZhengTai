import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Bell, CheckCheck, Users, MessageCircle, Gift, CreditCard,
  Video, Megaphone, Settings, ChevronRight, Info, Sparkles,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  category: string;
  isRead: boolean;
  actorId?: string;
  actorUsername?: string;
  actorAvatar?: string;
  referenceType?: string;
  referenceId?: string;
  actionUrl?: string;
  createdAt: string;
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "all",          label: "Semua",       icon: Bell },
  { id: "announcement", label: "Pengumuman",  icon: Megaphone },
  { id: "activity",     label: "Aktivitas",   icon: Sparkles },
  { id: "social",       label: "Sosial",      icon: Users },
  { id: "system",       label: "Sistem",      icon: Settings },
];

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function getCategoryIcon(category: string, type: string) {
  switch (category) {
    case "social":       return <Users className="h-3.5 w-3.5" />;
    case "activity":     return <Sparkles className="h-3.5 w-3.5" />;
    case "announcement": return <Megaphone className="h-3.5 w-3.5" />;
    case "payment":      return <CreditCard className="h-3.5 w-3.5" />;
    case "system":       return <Settings className="h-3.5 w-3.5" />;
    default:             return <Info className="h-3.5 w-3.5" />;
  }
}

function getCategoryGradient(category: string) {
  switch (category) {
    case "social":       return "from-blue-500 to-cyan-500";
    case "activity":     return "from-amber-500 to-orange-500";
    case "announcement": return "from-purple-500 to-pink-500";
    case "payment":      return "from-green-500 to-emerald-500";
    case "system":       return "from-slate-500 to-slate-400";
    default:             return "from-purple-500 to-indigo-500";
  }
}

function getCategoryLabel(category: string) {
  switch (category) {
    case "social":       return "Sosial";
    case "activity":     return "Aktivitas";
    case "announcement": return "Pengumuman";
    case "payment":      return "Pembayaran";
    case "system":       return "Sistem";
    default:             return "Info";
  }
}

function timeAgo(date: string) {
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: localeId });
  } catch {
    return "";
  }
}

// ─── Notification Card ────────────────────────────────────────────────────────

function NotifCard({ notif, onRead }: { notif: Notification; onRead: (id: string) => void }) {
  const grad = getCategoryGradient(notif.category);
  const hasActor = !!notif.actorUsername;

  const inner = (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      onClick={() => !notif.isRead && onRead(notif.id)}
      className={`
        flex items-start gap-3 p-4 rounded-2xl border transition-all cursor-pointer
        ${notif.isRead
          ? "bg-white border-slate-100 hover:border-purple-100"
          : "bg-gradient-to-r from-purple-50/60 to-pink-50/40 border-purple-100 shadow-sm"}
      `}
    >
      {/* Avatar / icon */}
      <div className="relative shrink-0 mt-0.5">
        {hasActor ? (
          <Avatar className="h-11 w-11 border-2 border-white shadow-sm">
            <AvatarImage src={notif.actorAvatar ?? ""} />
            <AvatarFallback className={`bg-gradient-to-br ${grad} text-white text-sm font-bold`}>
              {notif.actorUsername?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className={`h-11 w-11 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center shadow-sm`}>
            {getCategoryIcon(notif.category, notif.type)}
          </div>
        )}
        {/* Category badge */}
        <div className={`absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center border-2 border-white shadow-sm`}>
          <span className="text-white">{getCategoryIcon(notif.category, notif.type)}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-gradient-to-r ${grad} text-white uppercase tracking-wide`}>
              {getCategoryLabel(notif.category)}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 shrink-0 font-medium">{timeAgo(notif.createdAt)}</span>
        </div>
        <p className={`text-sm font-bold leading-snug mb-0.5 ${notif.isRead ? "text-slate-600" : "text-slate-800"}`}>
          {notif.title}
        </p>
        <p className={`text-xs leading-relaxed ${notif.isRead ? "text-slate-400" : "text-slate-500"}`}>
          {notif.message}
        </p>
      </div>

      {/* Right */}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {!notif.isRead && (
          <div className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 shadow-sm shadow-purple-300" />
        )}
        <ChevronRight className="h-4 w-4 text-slate-300 mt-auto" />
      </div>
    </motion.div>
  );

  if (notif.actionUrl) {
    return <Link href={notif.actionUrl}>{inner}</Link>;
  }
  return inner;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("all");
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications", activeTab],
    queryFn:  () => adminFetch<Notification[]>(
      `/notifications${activeTab !== "all" ? `?category=${activeTab}` : ""}`
    ),
    refetchInterval: 30000,
    enabled: !!user,
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAll = useMutation({
    mutationFn: () => adminFetch("/notifications/read-all", { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const markOne = useMutation({
    mutationFn: (id: string) => adminFetch(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="max-w-2xl mx-auto px-4 pb-24 pt-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-heading font-extrabold text-slate-800 flex items-center gap-2">
                <Bell className="h-6 w-6 text-purple-500" />
                Notifikasi
                {unreadCount > 0 && (
                  <span className="ml-1 h-6 min-w-[24px] rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-extrabold flex items-center justify-center px-1.5">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </h1>
              <p className="text-sm text-slate-400 font-medium mt-0.5">
                {notifications.length} notifikasi
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || unreadCount === 0}
              className="rounded-xl text-xs font-bold border-purple-200 text-purple-600 hover:bg-purple-50 gap-1.5"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tandai semua dibaca
            </Button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mb-5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border transition-all ${
                    active
                      ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white border-transparent shadow-sm shadow-purple-200"
                      : "bg-white border-slate-200 text-slate-500 hover:border-purple-200 hover:text-purple-500"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Notification list */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-white border border-slate-100 animate-pulse">
                  <div className="h-11 w-11 rounded-full bg-slate-100 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-20 bg-slate-100 rounded-full" />
                    <div className="h-4 w-48 bg-slate-100 rounded-full" />
                    <div className="h-3 w-64 bg-slate-100 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="h-20 w-20 rounded-full bg-purple-50 flex items-center justify-center mb-4">
                <Bell className="h-10 w-10 text-purple-200" />
              </div>
              <h3 className="text-base font-extrabold text-slate-600 mb-1">Semua sudah dibaca!</h3>
              <p className="text-sm text-slate-400 font-medium">Tidak ada notifikasi baru</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              <div className="space-y-2.5">
                {notifications.map((notif) => (
                  <NotifCard key={notif.id} notif={notif} onRead={(id) => markOne.mutate(id)} />
                ))}
              </div>
            </AnimatePresence>
          )}
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
