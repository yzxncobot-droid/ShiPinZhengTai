import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/layout/BottomNav";
import {
  Megaphone, MessageSquare, Search, Pin, ExternalLink, MessageCircle,
  Share2, Users, Hash, Lock, Globe2, Crown, ShieldCheck, ChevronRight,
  X, Loader2, Plus, CheckCircle2, Bell, Sparkles,
} from "lucide-react";
import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface Announcement {
  id: string; title: string; content: string;
  imageUrl?: string; videoUrl?: string; linkUrl?: string; linkLabel?: string;
  isPinned: boolean; authorUsername: string; authorAvatar?: string;
  createdAt: string; updatedAt: string;
  reactions: { emoji: string; count: number }[];
  commentCount: number;
  myReactions: string[];
}

interface Group {
  id: string; name: string; slug: string; description?: string;
  imageUrl?: string; isLocked: boolean; slowModeSeconds: number;
  category?: string; isPinnedGroup: boolean; isPublic: boolean; sortOrder: number;
  memberCount: number; createdAt: string;
  latestMessage: { content: string; messageType: string; authorUsername: string; createdAt: string } | null;
  unreadCount: number;
}

// ─── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "chats" as const, label: "Chats", icon: MessageSquare },
  { id: "announcements" as const, label: "Pengumuman", icon: Megaphone },
];
type Tab = "chats" | "announcements";

const ALL_CATEGORIES = [
  "General","Gaming","Minecraft","Roblox","Anime","Movies",
  "Music","Programming","Trading","Education","Marketplace",
  "Technology","Sports","Memes","Photography",
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: localeId });
}

function shortTime(date: string | Date) {
  const d = new Date(date);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Kemarin";
  return format(d, "dd/MM");
}

function formatMsgPreview(msg: Group["latestMessage"] | null, description?: string): string {
  if (!msg) return description ?? "Belum ada pesan";
  const prefix = `${msg.authorUsername}: `;
  if (msg.messageType === "image") return `${prefix}🖼️ Gambar`;
  if (msg.messageType === "video") return `${prefix}🎬 Video`;
  if (msg.messageType === "voice") return `${prefix}🎤 Pesan suara`;
  if (msg.messageType === "file") return `${prefix}📎 File`;
  if (msg.messageType === "gif") return `${prefix}GIF`;
  return `${prefix}${msg.content}`;
}

// ─── Group Avatar ─────────────────────────────────────────────────────────────────

function GroupAvatar({ group }: { group: Group }) {
  if (group.imageUrl) {
    return <img src={group.imageUrl} alt={group.name} className="h-14 w-14 rounded-2xl object-cover shrink-0 shadow-sm" />;
  }
  const colors = [
    "from-purple-500 to-pink-500", "from-blue-500 to-cyan-500",
    "from-green-500 to-teal-500", "from-orange-500 to-red-500",
    "from-indigo-500 to-purple-500", "from-amber-500 to-orange-500",
  ];
  const color = colors[group.name.charCodeAt(0) % colors.length];
  return (
    <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center shrink-0 shadow-sm`}>
      <Hash className="h-7 w-7 text-white" />
    </div>
  );
}

// ─── Group Card ──────────────────────────────────────────────────────────────────

function GroupCard({ group, onClick }: { group: Group; onClick: () => void }) {
  const timeRef = group.latestMessage?.createdAt ?? group.createdAt;
  const preview = formatMsgPreview(group.latestMessage, group.description);
  const hasUnread = group.unreadCount > 0;

  return (
    <motion.button
      layout
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left ${hasUnread ? "bg-purple-50/50" : "hover:bg-slate-50"}`}
    >
      <div className="relative">
        <GroupAvatar group={group} />
        {group.isPinnedGroup && (
          <div className="absolute -top-1 -right-1 h-4 w-4 bg-amber-400 rounded-full flex items-center justify-center shadow-sm">
            <Pin className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`font-extrabold text-sm truncate ${hasUnread ? "text-slate-900" : "text-slate-700"}`}>
            {group.name}
          </span>
          {group.isLocked && <Lock className="h-3 w-3 text-slate-300 shrink-0" />}
          {group.category && (
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-500 border border-purple-100 shrink-0 hidden sm:inline">
              {group.category}
            </span>
          )}
        </div>
        <p className={`text-xs truncate ${hasUnread ? "font-semibold text-slate-700" : "text-slate-400 font-medium"}`}>
          {preview}
        </p>
        <div className="flex items-center gap-1 mt-1">
          <Users className="h-3 w-3 text-slate-300" />
          <span className="text-[10px] text-slate-400 font-medium">{group.memberCount.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className={`text-[11px] ${hasUnread ? "text-purple-500 font-bold" : "text-slate-400"}`}>
          {shortTime(timeRef)}
        </span>
        {hasUnread && (
          <span className="h-5 min-w-[20px] rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-extrabold flex items-center justify-center px-1.5 shadow-sm">
            {group.unreadCount > 99 ? "99+" : group.unreadCount}
          </span>
        )}
      </div>
    </motion.button>
  );
}

// ─── Groups Pane ─────────────────────────────────────────────────────────────────

function GroupsPane({ userId, userRole }: { userId?: string; userRole?: string }) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["chat-groups", debouncedSearch, category],
    queryFn: () => adminFetch<Group[]>(
      `/chat/groups?search=${encodeURIComponent(debouncedSearch)}&category=${encodeURIComponent(category)}`
    ),
    refetchInterval: 8000,
    staleTime: 4000,
  });

  const isAdmin = userRole === "admin" || userRole === "owner";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari grup..."
            className="w-full pl-10 pr-9 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-medium focus:outline-none focus:border-purple-300 focus:bg-white transition-all placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-4 w-4 text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto bg-white border-b border-slate-50" style={{ scrollbarWidth: "none" }}>
        {["Semua", "📌 Pinned", "🔔 Unread", ...ALL_CATEGORIES].map((cat) => {
          const rawCat = cat.startsWith("📌") ? "__pinned__" : cat.startsWith("🔔") ? "__unread__" : cat;
          const active = cat === "Semua" ? category === "" : category === rawCat;
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat === "Semua" ? "" : rawCat)}
              className={`shrink-0 text-xs font-bold px-3.5 py-1.5 rounded-full border transition-all ${
                active
                  ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white border-transparent shadow-sm"
                  : "bg-white border-slate-200 text-slate-500 hover:border-purple-200 hover:text-purple-500"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Groups list */}
      <div className="flex-1 overflow-y-auto bg-white relative">
        {isLoading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-14 w-14 rounded-2xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center px-6">
            <div className="h-20 w-20 bg-purple-50 rounded-full flex items-center justify-center mb-4">
              <Globe2 className="h-10 w-10 text-purple-200" />
            </div>
            <p className="font-extrabold text-slate-600 text-base">
              {search || category ? "Tidak ada grup yang cocok" : "Belum ada grup"}
            </p>
            <p className="text-sm text-slate-400 mt-1 font-medium">
              {search || category ? "Coba kata kunci lain" : "Owner bisa membuat grup baru di panel admin"}
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            <div className="divide-y divide-slate-50">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  onClick={() => setLocation(`/chat/room/${group.id}`)}
                />
              ))}
            </div>
          </AnimatePresence>
        )}

        {/* Floating create button (admin only) */}
        {isAdmin && (
          <div className="absolute bottom-6 right-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="h-14 w-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center shadow-xl shadow-purple-500/30 pulse-glow"
            >
              <Plus className="h-6 w-6" />
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Announcement Card ────────────────────────────────────────────────────────────

function AnnouncementCard({ ann, userId, onReact, onComment }: {
  ann: Announcement; userId?: string;
  onReact: (id: string, emoji: string) => void;
  onComment: (ann: Announcement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = ann.content.length > 220;
  const displayContent = isLong && !expanded ? ann.content.slice(0, 220) + "…" : ann.content;
  const QUICK = ["❤️", "👍", "🔥", "🎉", "😢"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-3xl shadow-sm border overflow-hidden ${ann.isPinned ? "border-amber-200" : "border-slate-100"}`}
    >
      {ann.isPinned && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100">
          <Pin className="h-3 w-3 text-amber-500" />
          <span className="text-[11px] font-extrabold text-amber-600 uppercase tracking-wide">📌 Disematkan</span>
        </div>
      )}
      {ann.imageUrl && <img src={ann.imageUrl} alt="" className="w-full h-44 object-cover" />}
      <div className="p-4">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">
            {ann.authorUsername[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-[11px] font-extrabold text-purple-600 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> FUN+ Official
            </p>
            <p className="text-[10px] text-slate-400 font-medium">{timeAgo(ann.createdAt)}</p>
          </div>
        </div>
        <h3 className="font-extrabold text-slate-800 text-base leading-snug mb-2">{ann.title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{displayContent}</p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-purple-500 font-bold mt-1 hover:text-purple-700">
            {expanded ? "Sembunyikan ↑" : "Selengkapnya ↓"}
          </button>
        )}
        {ann.linkUrl && (
          <a href={ann.linkUrl} target="_blank" rel="noopener noreferrer"
            className="mt-3 flex items-center gap-2 text-sm font-bold text-purple-600 bg-purple-50 border border-purple-100 rounded-2xl px-3 py-2.5 hover:bg-purple-100 transition-colors">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {ann.linkLabel ?? ann.linkUrl}
          </a>
        )}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {QUICK.map((e) => {
            const r = ann.reactions.find((rx) => rx.emoji === e);
            const mine = ann.myReactions.includes(e);
            return (
              <button key={e}
                onClick={() => userId && onReact(ann.id, e)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all ${
                  mine
                    ? "bg-purple-100 border-purple-300 text-purple-700 shadow-sm"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:border-purple-200 hover:bg-purple-50"
                }`}>
                {e}{r && r.count > 0 ? ` ${r.count}` : ""}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-50">
          <button onClick={() => onComment(ann)} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-purple-600 transition-colors">
            <MessageCircle className="h-4 w-4" />
            {ann.commentCount > 0 && <span>{ann.commentCount}</span>}
            <span>Komentar</span>
          </button>
          <button className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-pink-500 transition-colors">
            <Share2 className="h-4 w-4" /> Bagikan
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Comment Modal ─────────────────────────────────────────────────────────────────

function CommentModal({ ann, userId, onClose }: { ann: Announcement; userId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState("");

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["announcement-comments", ann.id],
    queryFn: () => adminFetch<any[]>(`/announcements/${ann.id}/comments`),
    refetchInterval: 10000,
  });

  const submit = useMutation({
    mutationFn: () => adminFetch(`/announcements/${ann.id}/comments`, { method: "POST", body: JSON.stringify({ content }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcement-comments", ann.id] }); setContent(""); },
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-white w-full max-w-lg rounded-t-3xl p-5 max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-slate-800 text-base">💬 Komentar</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
            <X className="h-4 w-4 text-slate-600" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 mb-4">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
            : comments.length === 0
            ? <div className="text-center py-10 text-slate-400 text-sm font-medium">Belum ada komentar. Jadilah yang pertama!</div>
            : comments.map((c: any) => (
                <div key={c.id} className="flex gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold text-xs shrink-0">
                    {c.authorUsername?.[0]?.toUpperCase()}
                  </div>
                  <div className="bg-slate-50 rounded-2xl rounded-tl-sm px-3 py-2 flex-1">
                    <p className="text-[11px] font-bold text-purple-600">{c.authorUsername}</p>
                    <p className="text-sm text-slate-700 mt-0.5 leading-relaxed">{c.content}</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">{timeAgo(c.createdAt)}</p>
                  </div>
                </div>
              ))
          }
        </div>
        {userId ? (
          <div className="flex gap-2">
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && content.trim() && submit.mutate()}
              placeholder="Tulis komentar..."
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-purple-300 bg-slate-50 focus:bg-white transition-all"
            />
            <Button
              onClick={() => submit.mutate()}
              disabled={!content.trim() || submit.isPending}
              className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none shadow-md px-4"
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kirim"}
            </Button>
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400 font-medium">Login untuk berkomentar</p>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Announcements Pane ───────────────────────────────────────────────────────────

function AnnouncementsPane({ userId }: { userId?: string }) {
  const qc = useQueryClient();
  const [commentTarget, setCommentTarget] = useState<Announcement | null>(null);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => adminFetch<Announcement[]>("/announcements"),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const reactMutation = useMutation({
    mutationFn: ({ annId, emoji }: { annId: string; emoji: string }) =>
      adminFetch(`/announcements/${annId}/react`, { method: "POST", body: JSON.stringify({ emoji }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <AnimatePresence>
        {commentTarget && (
          <CommentModal ann={commentTarget} userId={userId} onClose={() => setCommentTarget(null)} />
        )}
      </AnimatePresence>
      <div className="p-4 space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-3xl p-4 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))
        ) : announcements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-20 w-20 bg-purple-50 rounded-full flex items-center justify-center mb-4">
              <Megaphone className="h-10 w-10 text-purple-200" />
            </div>
            <p className="font-extrabold text-slate-600 text-base">Belum ada pengumuman</p>
            <p className="text-sm text-slate-400 mt-1 font-medium">Pengumuman dari admin akan muncul di sini</p>
          </div>
        ) : (
          announcements.map((ann) => (
            <AnnouncementCard
              key={ann.id}
              ann={ann}
              userId={userId}
              onReact={(id, emoji) => reactMutation.mutate({ annId: id, emoji })}
              onComment={setCommentTarget}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────────

export default function ChatHomePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("chats");

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50">
      {/* Header */}
      <div className="gradient-funplus shadow-lg">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div>
            <h1 className="font-heading font-extrabold text-xl text-white tracking-tight">Chat</h1>
            <p className="text-white/60 text-[11px] font-medium">Bergabung & ngobrol bareng</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-9 w-9 bg-white/15 rounded-full flex items-center justify-center hover:bg-white/25 transition-colors">
              <Bell className="h-4.5 w-4.5 text-white" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pb-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-extrabold transition-all ${
                tab === t.id
                  ? "bg-white text-purple-700 shadow-md"
                  : "text-white/70 hover:text-white hover:bg-white/15"
              }`}
            >
              <t.icon className={`h-3.5 w-3.5 ${tab === t.id ? "text-purple-600" : "text-white/70"}`} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: tab === "chats" ? -10 : 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: tab === "chats" ? 10 : -10 }}
          transition={{ duration: 0.2 }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          {tab === "chats" && <GroupsPane userId={user?.id} userRole={user?.role} />}
          {tab === "announcements" && <AnnouncementsPane userId={user?.id} />}
        </motion.div>
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}
