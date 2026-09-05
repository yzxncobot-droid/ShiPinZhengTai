import { useState, Component, type ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/layout/BottomNav";
import { FunLogo } from "@/components/layout/AppLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Megaphone, MessageSquare, Search, Pin, ExternalLink, MessageCircle,
  Share2, Hash, Lock, Globe2, ShieldCheck, Users,
  ChevronDown, X, Loader2, CheckCircle2, Bell, Sparkles, Send,
  MessagesSquare, MessageSquarePlus,
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

interface DmConversation {
  conversationId: string;
  isPinned: boolean; isArchived: boolean; isMuted: boolean;
  otherUser: { userId: string; username: string; avatar?: string; role?: string } | null;
  lastMessage: { content: string; messageType: string; createdAt: string; senderId: string } | null;
  unread: number;
}

interface SearchUser {
  id: string; username: string; avatar?: string; role?: string;
}

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

function dmPreview(c: DmConversation) {
  const m = c.lastMessage;
  if (!m) return "Mulai percakapan...";
  if (m.messageType === "image") return "🖼️ Gambar";
  if (m.messageType === "sticker") return "🎭 Stiker";
  if (m.messageType === "voice") return "🎤 Pesan suara";
  if (m.messageType === "file") return "📎 File";
  return m.content;
}

// ─── Inline Error Boundary ─────────────────────────────────────────────────────

interface EBState { hasError: boolean }
class SectionBoundary extends Component<{ label: string; children: ReactNode }, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: Error) { console.error(`[Chat:${this.props.label}]`, e); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="py-8 text-center text-xs text-slate-400 font-medium">
          Konten ini tidak dapat ditampilkan.
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Group Avatar ──────────────────────────────────────────────────────────────

function GroupAvatar({ group }: { group: Group }) {
  if (group.imageUrl) {
    return <img src={group.imageUrl} alt={group.name} className="h-12 w-12 rounded-2xl object-cover shrink-0 shadow-sm" />;
  }
  const colors = [
    "from-purple-500 to-pink-500", "from-blue-500 to-cyan-500",
    "from-green-500 to-teal-500", "from-orange-500 to-red-500",
    "from-indigo-500 to-purple-500", "from-amber-500 to-orange-500",
  ];
  const color = colors[group.name.charCodeAt(0) % colors.length];
  return (
    <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center shrink-0 shadow-sm`}>
      <Hash className="h-6 w-6 text-white" />
    </div>
  );
}

// ─── Announcement Card (full, used inside modal) ───────────────────────────────

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
              <Sparkles className="h-3 w-3" /> KIDZOO Official
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

// ─── Comment Modal ──────────────────────────────────────────────────────────────

function CommentModal({ ann, userId, userRole, onClose }: { ann: Announcement; userId?: string; userRole?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState("");

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["announcement-comments", ann.id],
    queryFn: () => adminFetch<any[]>(`/announcements/${ann.id}/comments`),
    refetchInterval: 5000,
  });

  // API returns newest-first; a chat thread reads oldest → newest (top to bottom)
  const orderedComments = [...comments].reverse();

  const isOwner = userRole === "owner";

  const submit = useMutation({
    mutationFn: () => adminFetch(`/announcements/${ann.id}/comments`, { method: "POST", body: JSON.stringify({ content }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcement-comments", ann.id] }); setContent(""); },
  });

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-white w-full max-w-lg rounded-t-3xl p-5 max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
            💬 Chat Pengumuman
            <ShieldCheck className="h-4 w-4 text-blue-500" />
          </h3>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
            <X className="h-4 w-4 text-slate-600" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 mb-4">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
            : orderedComments.length === 0
            ? <div className="text-center py-10 text-slate-400 text-sm font-medium">Belum ada pesan.</div>
            : orderedComments.map((c: any) => {
                const mine = c.authorId === userId;
                return (
                  <div key={c.id} className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold text-xs shrink-0 overflow-hidden">
                      {c.authorAvatar
                        ? <img src={c.authorAvatar} className="h-full w-full object-cover" />
                        : c.authorUsername?.[0]?.toUpperCase()}
                    </div>
                    <div className={`rounded-2xl px-3 py-2 max-w-[80%] ${mine ? "bg-purple-500 text-white rounded-tr-sm" : "bg-slate-100 text-slate-700 rounded-tl-sm"}`}>
                      {!mine && <p className="text-[11px] font-bold text-purple-600 mb-0.5">{c.authorUsername}</p>}
                      <p className="text-sm leading-relaxed">{c.content}</p>
                      <p className={`text-[10px] mt-1 font-medium ${mine ? "text-purple-200" : "text-slate-400"}`}>{timeAgo(c.createdAt)}</p>
                    </div>
                  </div>
                );
              })
          }
        </div>
        {isOwner ? (
          <div className="flex gap-2">
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && content.trim() && submit.mutate()}
              placeholder="Kirim pesan sebagai owner..."
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-purple-300 bg-slate-50 focus:bg-white transition-all"
            />
            <Button onClick={() => submit.mutate()} disabled={!content.trim() || submit.isPending}
              className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none shadow-md px-4">
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-3 bg-slate-50 rounded-2xl text-xs font-bold text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            Hanya owner yang dapat mengirim pesan di sini
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Announcements Modal (full feed) ────────────────────────────────────────────

function AnnouncementsModal({ userId, userRole, onClose }: { userId?: string; userRole?: string; onClose: () => void }) {
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
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-slate-50 flex flex-col"
    >
      {/* Modal header */}
      <div className="bg-white border-b border-slate-100 px-4 h-14 flex items-center gap-3 shrink-0">
        <button onClick={onClose} className="h-9 w-9 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors shrink-0">
          <X className="h-5 w-5 text-slate-600" />
        </button>
        <div className="flex-1 flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-purple-600" />
          <h2 className="font-extrabold text-slate-800 text-base">Pengumuman</h2>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
            <AnnouncementCard key={ann.id} ann={ann} userId={userId}
              onReact={(id, emoji) => reactMutation.mutate({ annId: id, emoji })}
              onComment={setCommentTarget} />
          ))
        )}
      </div>

      <AnimatePresence>
        {commentTarget && (
          <CommentModal ann={commentTarget} userId={userId} onClose={() => setCommentTarget(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── New DM Modal ───────────────────────────────────────────────────────────────

function NewDmModal({ userId, onClose }: { userId?: string; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [userSearch, setUserSearch] = useState("");

  const { data: searchResults = [] } = useQuery<SearchUser[]>({
    queryKey: ["dm-search-users", userSearch],
    queryFn: () => adminFetch<SearchUser[]>(`/dm/search-users?q=${encodeURIComponent(userSearch)}`),
    enabled: userSearch.length >= 2,
  });

  const startConv = useMutation({
    mutationFn: (targetUserId: string) =>
      adminFetch<{ conversationId: string }>("/dm/conversations/start", {
        method: "POST",
        body: JSON.stringify({ targetUserId }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["dm-conversations"] });
      onClose();
      setLocation(`/chat/dm/${data.conversationId}`);
    },
  });

  if (!userId) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
        <motion.div initial={{ y: "100%" }} animate={{ y: 0 }}
          className="bg-white w-full max-w-lg rounded-t-3xl p-8 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <MessageCircle className="h-12 w-12 text-purple-200 mx-auto mb-3" />
          <p className="font-extrabold text-slate-600 mb-1">Login untuk DM</p>
          <p className="text-sm text-slate-400">Masuk untuk kirim pesan langsung ke pengguna lain</p>
          <Button onClick={onClose} className="mt-4 rounded-full">Tutup</Button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center" onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-white w-full max-w-lg rounded-t-3xl p-5 max-h-[70vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-slate-800 text-base">💬 Pesan Baru</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
            <X className="h-4 w-4 text-slate-600" />
          </button>
        </div>
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Cari pengguna..."
            className="w-full pl-10 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-sm font-medium focus:outline-none focus:border-purple-300" autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {userSearch.length < 2 ? (
            <p className="text-center text-sm text-slate-400 py-8 font-medium">Ketik minimal 2 karakter</p>
          ) : searchResults.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8 font-medium">Pengguna tidak ditemukan</p>
          ) : (
            searchResults.map((u) => (
              <button key={u.id} onClick={() => startConv.mutate(u.id)} disabled={startConv.isPending}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 transition-colors text-left">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold shrink-0 overflow-hidden">
                  {u.avatar ? <img src={u.avatar} className="h-full w-full object-cover" /> : u.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-sm text-slate-800">{u.username}</p>
                  <p className="text-xs text-slate-400 font-medium capitalize">{u.role}</p>
                </div>
                <Send className="h-4 w-4 text-slate-300" />
              </button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── List Rows ──────────────────────────────────────────────────────────────────

function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="h-5 min-w-[20px] rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-extrabold flex items-center justify-center px-1.5 shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function OnlineDot() {
  return (
    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-white" />
  );
}

function AnnouncementRow({ ann, onClick }: { ann: Announcement; onClick: () => void }) {
  return (
    <div className="px-4 pt-3 bg-white">
      <motion.button
        layout whileTap={{ scale: 0.99 }} onClick={onClick}
        className="w-full flex items-center gap-3 p-3 text-left bg-[#FBFBFF] rounded-3xl border border-slate-100 hover:border-purple-100 transition-colors"
      >
        <div className="relative shrink-0">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-sm">
            <Megaphone className="h-6 w-6 text-white" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 bg-purple-600 rounded-full border-2 border-white flex items-center justify-center">
            <Megaphone className="h-2.5 w-2.5 text-white" />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-extrabold text-sm text-slate-900 truncate">Announcement</span>
            <ShieldCheck className="h-4 w-4 text-blue-500 shrink-0" />
          </div>
          <span className="inline-block text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 mb-1">
            Pengumuman untuk semua pengguna
          </span>
          <p className="text-xs text-slate-500 truncate font-medium">
            {ann.content || ann.title}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className="text-[11px] text-slate-400">{shortTime(ann.createdAt)}</span>
          <UnreadBadge count={1} />
        </div>
      </motion.button>
    </div>
  );
}

function GroupRow({ group, onClick }: { group: Group; onClick: () => void }) {
  const timeRef = group.latestMessage?.createdAt ?? group.createdAt;
  const preview = formatMsgPreview(group.latestMessage, group.description);
  const hasUnread = group.unreadCount > 0;

  return (
    <motion.button
      layout whileTap={{ scale: 0.98 }} onClick={onClick}
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
          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-500 border border-purple-100 shrink-0">
            Grup
          </span>
          {group.isLocked && <Lock className="h-3 w-3 text-slate-300 shrink-0" />}
        </div>
        <p className={`text-xs truncate ${hasUnread ? "font-semibold text-slate-700" : "text-slate-400 font-medium"}`}>
          {preview}
        </p>
        <p className="text-[10px] text-slate-400 font-medium mt-0.5 flex items-center gap-1">
          <Users className="h-2.5 w-2.5" />
          {(group.memberCount ?? 0).toLocaleString("id-ID")} anggota
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className={`text-[11px] ${hasUnread ? "text-purple-500 font-bold" : "text-slate-400"}`}>
          {shortTime(timeRef)}
        </span>
        <UnreadBadge count={group.unreadCount} />
      </div>
    </motion.button>
  );
}

function DmRow({ conv, onClick }: { conv: DmConversation; onClick: () => void }) {
  const hasUnread = conv.unread > 0;
  const other = conv.otherUser;
  return (
    <motion.button
      layout whileTap={{ scale: 0.98 }} onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${hasUnread ? "bg-purple-50/40" : "hover:bg-slate-50"}`}
    >
      <div className="relative shrink-0">
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-sm overflow-hidden">
          {other?.avatar
            ? <img src={other.avatar} className="h-full w-full object-cover" />
            : <span className="text-white font-extrabold text-lg">{other?.username?.charAt(0).toUpperCase() ?? "?"}</span>}
        </div>
        <OnlineDot />
        {conv.isPinned && (
          <div className="absolute -top-0.5 -right-0.5 h-4 w-4 bg-amber-400 rounded-full flex items-center justify-center">
            <Pin className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-extrabold text-sm ${hasUnread ? "text-slate-900" : "text-slate-700"}`}>
          {other?.username ?? "Unknown"}
        </p>
        <p className={`text-xs truncate mt-0.5 ${hasUnread ? "font-semibold text-slate-700" : "text-slate-400 font-medium"}`}>
          {dmPreview(conv)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {conv.lastMessage && (
          <span className={`text-[11px] ${hasUnread ? "text-purple-500 font-bold" : "text-slate-400"}`}>
            {shortTime(conv.lastMessage.createdAt)}
          </span>
        )}
        <UnreadBadge count={conv.unread} />
      </div>
    </motion.button>
  );
}

// ─── Section Label ──────────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-4 pt-4 pb-1.5 bg-white">
      <Icon className="h-3.5 w-3.5 text-purple-500" />
      <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wide">{label}</span>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

type FilterKey = "all" | "groups" | "chats";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "groups", label: "Grup" },
  { key: "chats", label: "Chat" },
];

export default function ChatHomePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);

  // ── Data ──
  const { data: announcements = [], isLoading: loadingAnn } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => adminFetch<Announcement[]>("/announcements"),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: groups = [], isLoading: loadingGroups } = useQuery<Group[]>({
    queryKey: ["chat-groups"],
    queryFn: () => adminFetch<Group[]>("/chat/groups?search=&category="),
    refetchInterval: 8000,
    staleTime: 4000,
  });

  const { data: convs = [], isLoading: loadingConvs } = useQuery<DmConversation[]>({
    queryKey: ["dm-conversations"],
    queryFn: () => adminFetch<DmConversation[]>("/dm/conversations"),
    refetchInterval: 5000,
    enabled: !!user?.id,
  });

  const latestAnnouncement = announcements[0] ?? null;
  const showAnnRow = filter !== "chats" && !!latestAnnouncement;
  const showGroups = filter !== "chats";
  const showChats = filter !== "groups";

  const isEmpty =
    !loadingAnn && !loadingGroups && !loadingConvs &&
    !showAnnRow && groups.length === 0 && (!user || convs.length === 0);

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50">
      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-100 shadow-sm shrink-0">
        {/* Brand row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <FunLogo />
          <div className="flex items-center gap-2">
            <button onClick={() => setLocation("/search")} className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
              <Search className="h-4.5 w-4.5 text-slate-600" />
            </button>
            <Link href="/notifications">
              <button className="relative h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <Bell className="h-4.5 w-4.5 text-slate-600" />
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-orange-500" />
              </button>
            </Link>
            <Link href={user ? "/profile" : "/login"}>
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-extrabold text-sm shadow-sm overflow-hidden">
                {user?.avatar
                  ? <img src={user.avatar} className="h-full w-full object-cover" />
                  : (user?.username?.charAt(0).toUpperCase() ?? "Y")}
              </div>
            </Link>
          </div>
        </div>

        {/* Title + filter dropdown */}
        <div className="flex items-center justify-between px-4 pb-3">
          <h1 className="font-extrabold text-xl text-slate-800 tracking-tight">Percakapan</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 rounded-full bg-purple-50 px-3.5 py-2 text-xs font-bold text-purple-700 border border-purple-100 hover:bg-purple-100 transition-colors">
                {FILTERS.find((f) => f.key === filter)?.label}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {FILTERS.map((f) => (
                <DropdownMenuItem key={f.key} onClick={() => setFilter(f.key)}
                  className={`cursor-pointer justify-between rounded-lg text-xs font-bold ${filter === f.key ? "text-purple-600 bg-purple-50" : "text-slate-600"}`}>
                  {f.label}
                  {filter === f.key && <CheckCircle2 className="h-3.5 w-3.5 text-purple-500" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Unified List ── */}
      <SectionBoundary label="list">
        <div className="flex-1 overflow-y-auto bg-white">
          {/* Announcement at top */}
          {showAnnRow && (
            <>
              {loadingAnn ? (
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Skeleton className="h-12 w-12 rounded-2xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                </div>
              ) : (
                <AnnouncementRow ann={latestAnnouncement} onClick={() => setShowAnnouncements(true)} />
              )}
              <div className="h-px bg-slate-100 mx-4" />
            </>
          )}

          {/* Groups */}
          {showGroups && (
            <>
              <div className="flex items-center justify-between px-4 pt-4 pb-1.5 bg-white">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-purple-500" />
                  <span className="text-[11px] font-extrabold text-purple-600 uppercase tracking-wide">Grup</span>
                </div>
                <button onClick={() => setFilter("groups")} className="text-[11px] font-bold text-purple-500 hover:text-purple-700 transition-colors">
                  Lihat semua &rsaquo;
                </button>
              </div>
              {loadingGroups ? (
                <div className="divide-y divide-slate-50">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                      <Skeleton className="h-12 w-12 rounded-2xl shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="h-16 w-16 bg-purple-50 rounded-full flex items-center justify-center mb-3">
                    <Globe2 className="h-8 w-8 text-purple-200" />
                  </div>
                  <p className="font-extrabold text-slate-600 text-sm">Belum ada grup</p>
                  <p className="text-xs text-slate-400 mt-1 font-medium">Owner bisa membuat grup baru di panel admin</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {groups.map((group) => (
                    <GroupRow key={group.id} group={group} onClick={() => setLocation(`/chat/room/${group.id}`)} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Chats (DM) */}
          {showChats && (
            <>
              <SectionLabel icon={MessageCircle} label="Chat" />
              {!user ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="h-16 w-16 bg-purple-50 rounded-full flex items-center justify-center mb-3">
                    <MessageCircle className="h-8 w-8 text-purple-200" />
                  </div>
                  <p className="font-extrabold text-slate-600 text-sm">Login untuk chat</p>
                  <p className="text-xs text-slate-400 mt-1 font-medium">Masuk untuk kirim pesan langsung</p>
                </div>
              ) : loadingConvs ? (
                <div className="divide-y divide-slate-50">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                      <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-44" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : convs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="h-16 w-16 bg-purple-50 rounded-full flex items-center justify-center mb-3">
                    <MessageCircle className="h-8 w-8 text-purple-200" />
                  </div>
                  <p className="font-extrabold text-slate-600 text-sm">Belum ada DM</p>
                  <p className="text-xs text-slate-400 mt-1 font-medium">Tekan tombol + untuk mulai chat</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {convs.map((c) => (
                    <DmRow key={c.conversationId} conv={c} onClick={() => setLocation(`/chat/dm/${c.conversationId}`)} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Fully empty */}
          {isEmpty && (
            <div className="flex flex-col items-center justify-center py-24 text-center px-6">
              <div className="h-20 w-20 bg-purple-50 rounded-full flex items-center justify-center mb-4">
                <MessagesSquare className="h-10 w-10 text-purple-200" />
              </div>
              <p className="font-extrabold text-slate-600 text-base">Belum ada percakapan</p>
              <p className="text-sm text-slate-400 mt-1 font-medium">Mulai ngobrol bareng teman di grup atau DM</p>
            </div>
          )}

          <div className="h-24" />
        </div>
      </SectionBoundary>

      {/* ── FAB (new DM) ── */}
      <div className="absolute bottom-24 right-4 z-30">
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={() => setShowNewDm(true)}
          className="h-14 w-14 rounded-[1.25rem] bg-gradient-to-br from-purple-600 to-violet-500 text-white flex items-center justify-center shadow-xl shadow-purple-500/40"
        >
          <MessageSquarePlus className="h-6 w-6" />
        </motion.button>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {showNewDm && <NewDmModal userId={user?.id} onClose={() => setShowNewDm(false)} />}
      </AnimatePresence>
      {showAnnouncements && <AnnouncementsModal userId={user?.id} onClose={() => setShowAnnouncements(false)} />}

      <BottomNav />
    </div>
  );
}
