import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Megaphone, MessageSquare, Mail, Plus, Pin, MessageCircle,
  Share2, ExternalLink, Search, ArrowRight, Crown, ShieldCheck,
  Globe, Loader2, ArrowLeft, MoreVertical,
} from "lucide-react";
import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";
import { id as localeId } from "date-fns/locale";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Announcement {
  id: string; title: string; content: string;
  imageUrl?: string; videoUrl?: string; linkUrl?: string; linkLabel?: string;
  isPinned: boolean; authorUsername: string; authorAvatar?: string;
  createdAt: string; updatedAt: string;
  reactions: { emoji: string; count: number }[];
  commentCount: number;
  myReactions: string[];
}

interface GlobalRoom {
  id: string; name: string; slug: string; description?: string;
  imageUrl?: string; isLocked: boolean; slowModeSeconds: number;
  memberCount: number;
}

interface Message {
  id: string; roomId: string; content: string; messageType: string;
  fileUrl?: string; fileName?: string; replyToId?: string;
  isPinned: boolean; isDeleted: boolean; editedAt?: string;
  createdAt: string; authorId: string; authorUsername: string;
  authorAvatar?: string; authorRole: string;
  reactions: { emoji: string; count: number }[];
  myReactions: string[];
}

interface Conversation {
  conversationId: string; isPinned: boolean; isFavorite: boolean; isMuted: boolean;
  unread: number;
  otherUser: { userId: string; username: string; avatar?: string; role?: string } | null;
  lastMessage: { content: string; messageType: string; createdAt: string; senderId: string } | null;
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "announcements", label: "Pengumuman", icon: Megaphone },
  { id: "chats",         label: "Chats",      icon: MessageSquare },
  { id: "dm",           label: "DM",          icon: Mail },
] as const;
type Tab = typeof TABS[number]["id"];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: localeId });
}

function shortTime(date: string | Date) {
  const d = new Date(date);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Kemarin";
  return format(d, "dd/MM");
}

function AvatarEl({ username, avatar, size = "md", online }: {
  username: string; avatar?: string | null; size?: "sm" | "md" | "lg"; online?: boolean;
}) {
  const sz = { sm: "h-8 w-8 text-xs", md: "h-11 w-11 text-sm", lg: "h-12 w-12 text-base" }[size];
  return (
    <div className="relative shrink-0">
      {avatar
        ? <img src={avatar} alt={username} className={`${sz} rounded-full object-cover`} />
        : (
          <div className={`${sz} rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-extrabold`}>
            {username[0]?.toUpperCase()}
          </div>
        )
      }
      {online && (
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-400 border-2 border-white" />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role?: string }) {
  if (role === "owner") return (
    <span className="flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 leading-none">
      <Crown className="h-2.5 w-2.5" /> Owner
    </span>
  );
  if (role === "admin") return (
    <span className="flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 leading-none">
      <ShieldCheck className="h-2.5 w-2.5" /> Admin
    </span>
  );
  return null;
}

// ─── Announcement Card ─────────────────────────────────────────────────────────

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
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${ann.isPinned ? "border-amber-200" : "border-slate-100"}`}>
      {ann.isPinned && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-50 border-b border-amber-100">
          <Pin className="h-3 w-3 text-amber-500" />
          <span className="text-[11px] font-extrabold text-amber-600 uppercase tracking-wide">Disematkan</span>
        </div>
      )}
      {ann.imageUrl && <img src={ann.imageUrl} alt="" className="w-full h-40 object-cover" />}
      <div className="p-4">
        <div className="flex items-center gap-2.5 mb-3">
          <AvatarEl username={ann.authorUsername} avatar={ann.authorAvatar} size="sm" />
          <div>
            <p className="text-[11px] font-extrabold text-amber-600">Yzu视频</p>
            <p className="text-[10px] text-slate-400">{timeAgo(ann.createdAt)}</p>
          </div>
        </div>
        <h3 className="font-extrabold text-slate-800 text-base leading-snug mb-2">{ann.title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{displayContent}</p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-purple-500 font-bold mt-1">
            {expanded ? "Sembunyikan" : "Selengkapnya"}
          </button>
        )}
        {ann.linkUrl && (
          <a href={ann.linkUrl} target="_blank" rel="noopener noreferrer"
            className="mt-3 flex items-center gap-2 text-sm font-bold text-purple-600 bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 hover:bg-purple-100 transition-colors">
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
                className={`flex items-center gap-0.5 px-2 py-1 rounded-full text-xs font-bold border transition-all
                  ${mine ? "bg-purple-100 border-purple-300 text-purple-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:border-purple-200"}`}>
                {e}{r ? ` ${r.count}` : ""}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-50">
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
    </div>
  );
}

// ─── Comment Modal ─────────────────────────────────────────────────────────────

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
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-t-3xl p-5 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-slate-800">Komentar</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 mb-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
          ) : comments.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">Belum ada komentar</div>
          ) : (
            comments.map((c: any) => (
              <div key={c.id} className="flex gap-2.5">
                <AvatarEl username={c.authorUsername} avatar={c.authorAvatar} size="sm" />
                <div>
                  <p className="text-[11px] font-bold text-slate-600">{c.authorUsername}</p>
                  <p className="text-sm text-slate-700 mt-0.5">{c.content}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(c.createdAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
        {userId ? (
          <div className="flex gap-2">
            <input value={content} onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && content.trim() && submit.mutate()}
              placeholder="Tulis komentar..."
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:border-purple-300 bg-slate-50" />
            <Button onClick={() => submit.mutate()} disabled={!content.trim() || submit.isPending}
              className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none">Kirim</Button>
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">Login untuk berkomentar</p>
        )}
      </div>
    </div>
  );
}

// ─── New DM Modal ──────────────────────────────────────────────────────────────

function NewDMModal({ onClose }: { onClose: () => void }) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const qc = useQueryClient();

  const { data: users = [] } = useQuery({
    queryKey: ["dm-user-search", query],
    queryFn: () => adminFetch<any[]>(`/dm/search-users?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });

  const startDM = useMutation({
    mutationFn: (targetUserId: string) =>
      adminFetch<{ conversationId: string }>("/dm/conversations/start", {
        method: "POST", body: JSON.stringify({ targetUserId }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["dm-conversations"] });
      setLocation(`/chat/dm/${data.conversationId}`);
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-t-3xl p-5 max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-slate-800 text-lg">Pesan Baru</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari username..." autoFocus
            className="w-full pl-9 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:border-purple-300" />
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {query.length < 2 ? (
            <p className="text-center text-sm text-slate-400 py-10">Ketik minimal 2 karakter untuk mencari</p>
          ) : users.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-10">Pengguna tidak ditemukan</p>
          ) : (
            users.map((u: any) => (
              <button key={u.id} onClick={() => startDM.mutate(u.id)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-purple-50 transition-colors active:scale-[0.98]">
                <AvatarEl username={u.username} avatar={u.avatar} size="md" />
                <div className="text-left flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-sm text-slate-800">{u.username}</p>
                    <RoleBadge role={u.role} />
                  </div>
                  <p className="text-[11px] text-slate-400 capitalize">{u.role}</p>
                </div>
                {startDM.isPending ? <Loader2 className="h-4 w-4 animate-spin text-purple-400" /> : <ArrowRight className="h-4 w-4 text-slate-300" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DM Conversation Card ──────────────────────────────────────────────────────

function DMCard({ conv, currentUserId }: { conv: Conversation; currentUserId?: string }) {
  const [, setLocation] = useLocation();
  const isMine = conv.lastMessage?.senderId === currentUserId;

  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
      onClick={() => setLocation(`/chat/dm/${conv.conversationId}`)}
    >
      <AvatarEl
        username={conv.otherUser?.username ?? "?"}
        avatar={conv.otherUser?.avatar}
        size="md"
      />
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {conv.isPinned && <Pin className="h-3 w-3 text-purple-400 shrink-0" />}
            <p className={`font-bold text-sm truncate ${conv.unread > 0 ? "text-slate-900" : "text-slate-700"}`}>
              {conv.otherUser?.username ?? "Pengguna"}
            </p>
            <RoleBadge role={conv.otherUser?.role} />
          </div>
          <span className={`text-[11px] shrink-0 ${conv.unread > 0 ? "text-purple-500 font-bold" : "text-slate-400"}`}>
            {conv.lastMessage ? shortTime(conv.lastMessage.createdAt) : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {conv.isMuted && <span className="text-[10px]">🔇</span>}
          <p className={`text-xs truncate flex-1 ${conv.unread > 0 ? "font-semibold text-slate-700" : "text-slate-400"}`}>
            {conv.lastMessage
              ? isMine
                ? `Kamu: ${conv.lastMessage.messageType !== "text" ? `[${conv.lastMessage.messageType}]` : conv.lastMessage.content}`
                : conv.lastMessage.messageType !== "text"
                  ? `[${conv.lastMessage.messageType}]`
                  : conv.lastMessage.content
              : "Belum ada pesan"}
          </p>
          {conv.unread > 0 && (
            <span className="h-5 min-w-[20px] rounded-full bg-purple-500 text-white text-[10px] font-extrabold flex items-center justify-center px-1.5 shrink-0">
              {conv.unread > 99 ? "99+" : conv.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Global Chat Pane ──────────────────────────────────────────────────────────

function GlobalChatPane({ userId }: { userId?: string }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; content: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch global room by slug
  const { data: roomList = [], isLoading: loadingRoom } = useQuery({
    queryKey: ["chat-room-global"],
    queryFn: () => adminFetch<GlobalRoom[]>("/chat/rooms?slug=global"),
    staleTime: 60000,
  });
  const room = roomList[0] ?? null;

  const loadMessages = useCallback(async (before?: string) => {
    if (!room) return [];
    const url = `/chat/rooms/${room.id}/messages?limit=40${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    return adminFetch<Message[]>(url);
  }, [room?.id]);

  // Initial load
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    adminFetch<Message[]>(`/chat/rooms/${room.id}/messages?limit=40`).then((data) => {
      if (!cancelled) {
        setMessages(data);
        setHasMore(data.length >= 40);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "instant" }), 50);
      }
    });
    return () => { cancelled = true; };
  }, [room?.id]);

  // Polling
  useEffect(() => {
    if (!room) return;
    const interval = setInterval(async () => {
      try {
        const latest = await adminFetch<Message[]>(`/chat/rooms/${room.id}/messages?limit=40`);
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = latest.filter((m) => !existingIds.has(m.id));
          const updated = prev.map((m) => {
            const u = latest.find((l) => l.id === m.id);
            return u ? { ...m, ...u } : m;
          });
          if (newMsgs.length === 0) return updated;
          const atBottom = bottomRef.current &&
            bottomRef.current.getBoundingClientRect().bottom <= window.innerHeight + 200;
          if (atBottom) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          return [...updated, ...newMsgs];
        });
      } catch {}
    }, 4000);
    return () => clearInterval(interval);
  }, [room?.id]);

  // Mark read
  useEffect(() => {
    if (userId && room) {
      adminFetch(`/chat/rooms/${room.id}/read`, { method: "POST" }).catch(() => {});
    }
  }, [room?.id, userId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !room || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const older = await adminFetch<Message[]>(`/chat/rooms/${room.id}/messages?limit=40&before=${encodeURIComponent(messages[0].createdAt)}`);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 40);
    } finally { setLoadingMore(false); }
  };

  const sendMsg = async (content: string) => {
    if (!userId) { setLocation("/login"); return; }
    if (!room) return;
    try {
      const msg = await adminFetch<Message>(`/chat/rooms/${room.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, messageType: "text", replyToId: replyTo?.id ?? null }),
      });
      setMessages((prev) => [...prev, msg]);
      setReplyTo(null);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) { alert(err.message); }
  };

  const attachFile = async (file: File) => {
    if (!userId) { setLocation("/login"); return; }
    if (!room) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("yzu_token");
      const res = await fetch("/api/chat/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const upload = await res.json();
      if (!res.ok) throw new Error(upload.error ?? "Upload failed");
      const type = upload.folder === "chat-images" ? "image"
        : upload.folder === "chat-videos" ? "video"
        : upload.folder === "voice-notes" ? "voice" : "file";
      const msg = await adminFetch<Message>(`/chat/rooms/${room.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "", messageType: type, fileUrl: upload.url, fileName: upload.originalName }),
      });
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) { alert(err.message); } finally { setIsUploading(false); }
  };

  const deleteMsg = async (msgId: string, deleteType: "soft" | "hard") => {
    if (!room) return;
    await adminFetch(`/chat/rooms/${room.id}/messages/${msgId}`, { method: "DELETE" });
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  };

  const editMsg = async (msgId: string, content: string) => {
    if (!room) return;
    const updated = await adminFetch<Message>(`/chat/rooms/${room.id}/messages/${msgId}`, {
      method: "PATCH", body: JSON.stringify({ content }),
    });
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, ...updated } : m));
  };

  const reactMsg = async (msgId: string, emoji: string) => {
    if (!room) return;
    await adminFetch(`/chat/rooms/${room.id}/messages/${msgId}/react`, {
      method: "POST", body: JSON.stringify({ emoji }),
    });
    const latest = await adminFetch<Message[]>(`/chat/rooms/${room.id}/messages?limit=40`);
    setMessages(latest);
  };

  // Group messages by date
  function groupMessages(msgs: Message[]) {
    const groups: { date: string; messages: Message[] }[] = [];
    for (const m of msgs) {
      const d = format(new Date(m.createdAt), "d MMMM yyyy", { locale: localeId });
      const last = groups[groups.length - 1];
      if (last?.date === d) last.messages.push(m);
      else groups.push({ date: d, messages: [m] });
    }
    return groups;
  }

  if (loadingRoom) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <Globe className="h-12 w-12 text-slate-200 mb-3" />
        <p className="font-bold text-slate-500">Global chat belum tersedia</p>
        <p className="text-sm text-slate-400 mt-1">Owner perlu membuat room chat komunitas</p>
      </div>
    );
  }

  const groups = groupMessages(messages);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Messages scroll area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
        {/* Load more button */}
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs text-purple-500 font-bold bg-purple-50 px-4 py-1.5 rounded-full hover:bg-purple-100 transition-colors"
            >
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : "Muat pesan lama"}
            </button>
          </div>
        )}

        {messages.length === 0 && !loadingMore && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Globe className="h-10 w-10 text-slate-200 mb-2" />
            <p className="font-bold text-slate-400 text-sm">Jadilah yang pertama memulai obrolan!</p>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.date}>
            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-[10px] font-bold text-slate-400 px-2">{group.date}</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            {group.messages.map((msg, i) => {
              const prev = group.messages[i - 1];
              const showAvatar = !prev || prev.authorId !== msg.authorId;
              return (
                <MessageBubble
                  key={msg.id}
                  id={msg.id}
                  content={msg.content}
                  messageType={msg.messageType}
                  fileUrl={msg.fileUrl}
                  fileName={msg.fileName}
                  replyToId={msg.replyToId}
                  isPinned={msg.isPinned}
                  isDeleted={msg.isDeleted}
                  editedAt={msg.editedAt}
                  createdAt={msg.createdAt}
                  authorUsername={msg.authorUsername}
                  authorAvatar={msg.authorAvatar}
                  authorRole={msg.authorRole}
                  reactions={msg.reactions}
                  myReactions={msg.myReactions}
                  isMine={msg.authorId === userId}
                  showAvatar={showAvatar}
                  onReply={() => setReplyTo({ id: msg.id, username: msg.authorUsername, content: msg.content })}
                  onReact={(emoji) => reactMsg(msg.id, emoji)}
                  onEdit={() => {
                    const newContent = prompt("Edit pesan:", msg.content);
                    if (newContent?.trim()) editMsg(msg.id, newContent.trim());
                  }}
                  onDelete={() => deleteMsg(msg.id, "soft")}
                />
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-100 bg-white px-3 py-2">
        <ChatInput
          onSend={sendMsg}
          onAttach={attachFile}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          disabled={isUploading || room.isLocked}
          placeholder={room.isLocked ? "Room dikunci oleh admin" : "Kirim pesan..."}
        />
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ChatHomePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("chats");
  const [commentAnn, setCommentAnn] = useState<Announcement | null>(null);
  const [showNewDM, setShowNewDM] = useState(false);
  const [dmSearch, setDmSearch] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: announcements = [], isLoading: loadingAnn } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => adminFetch<Announcement[]>("/announcements?limit=30"),
    refetchInterval: 30000,
    enabled: activeTab === "announcements",
  });

  const { data: conversations = [], isLoading: loadingDMs } = useQuery({
    queryKey: ["dm-conversations"],
    queryFn: () => adminFetch<Conversation[]>("/dm/conversations"),
    refetchInterval: 6000,
    enabled: activeTab === "dm" && !!user,
  });

  const { data: chatUnread } = useQuery({
    queryKey: ["chat-unread"],
    queryFn: () => adminFetch<{ unread: number }>("/chat/unread"),
    refetchInterval: 10000,
    enabled: !!user,
  });
  const { data: dmUnread } = useQuery({
    queryKey: ["dm-unread"],
    queryFn: () => adminFetch<{ unread: number }>("/dm/unread"),
    refetchInterval: 6000,
    enabled: !!user,
  });
  const { data: annUnread } = useQuery({
    queryKey: ["announcements-unread"],
    queryFn: () => adminFetch<{ unread: number }>("/announcements-unread"),
    refetchInterval: 30000,
    enabled: !!user,
  });

  const reactToAnn = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) =>
      adminFetch(`/announcements/${id}/react`, { method: "POST", body: JSON.stringify({ emoji }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  // ── Filtered DMs ─────────────────────────────────────────────────────────────

  const filteredConvs = conversations.filter((c) =>
    !dmSearch || c.otherUser?.username?.toLowerCase().includes(dmSearch.toLowerCase())
  );

  const tabUnreads: Record<Tab, number> = {
    announcements: annUnread?.unread ?? 0,
    chats:         chatUnread?.unread ?? 0,
    dm:            dmUnread?.unread ?? 0,
  };

  const isChatsTab = activeTab === "chats";

  return (
    <div className={isChatsTab ? "h-[100dvh] flex flex-col overflow-hidden" : "min-h-screen bg-gradient-to-b from-slate-50 to-white pb-24"}>

      {/* ── Sticky Header ── */}
      <div className="sticky top-0 z-40 bg-white border-b border-slate-100 shrink-0">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-0">

          {/* Title row */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">Chat</h1>
            </div>
            {activeTab === "dm" && user && (
              <button
                onClick={() => setShowNewDM(true)}
                className="h-9 px-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white text-sm font-bold flex items-center gap-1.5 shadow-md shadow-purple-200"
              >
                <Plus className="h-3.5 w-3.5" /> Pesan
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const unread = tabUnreads[tab.id];
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-extrabold border-b-2 transition-all relative
                    ${isActive
                      ? "text-purple-600 border-purple-500"
                      : "text-slate-400 border-transparent hover:text-slate-600"
                    }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                  {unread > 0 && (
                    <span className="absolute top-1 right-2 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Chats tab: Global Public Chat ── */}
      {isChatsTab && (
        <GlobalChatPane userId={user?.id} />
      )}

      {/* ── Announcements tab ── */}
      {activeTab === "announcements" && (
        <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
          {loadingAnn ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                <Skeleton className="h-4 w-2/3 mb-2" />
                <Skeleton className="h-20 w-full" />
              </div>
            ))
          ) : announcements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Megaphone className="h-12 w-12 text-slate-200 mb-3" />
              <p className="font-bold text-slate-500">Belum ada pengumuman</p>
              <p className="text-sm text-slate-400 mt-1">Pengumuman dari owner akan muncul di sini</p>
            </div>
          ) : (
            announcements.map((ann) => (
              <AnnouncementCard key={ann.id} ann={ann} userId={user?.id}
                onReact={(id, emoji) => reactToAnn.mutate({ id, emoji })}
                onComment={setCommentAnn} />
            ))
          )}
        </div>
      )}

      {/* ── DM tab: Instagram-style conversation list ── */}
      {activeTab === "dm" && (
        <div className="max-w-lg mx-auto w-full">
          {/* Search bar */}
          <div className="sticky top-[105px] z-30 bg-white/95 backdrop-blur-sm px-4 py-3 border-b border-slate-50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                value={dmSearch}
                onChange={(e) => setDmSearch(e.target.value)}
                placeholder="Cari percakapan..."
                className="w-full pl-9 pr-4 py-2.5 rounded-full border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
              />
            </div>
          </div>

          {!user ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <Mail className="h-12 w-12 text-slate-200 mb-3" />
              <p className="font-bold text-slate-500">Login untuk melihat pesan</p>
              <p className="text-sm text-slate-400 mt-1">Masuk ke akun untuk mulai chat</p>
            </div>
          ) : loadingDMs ? (
            <div className="divide-y divide-slate-50">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-11 w-11 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <Mail className="h-12 w-12 text-slate-200 mb-3" />
              <p className="font-bold text-slate-500">
                {dmSearch ? "Percakapan tidak ditemukan" : "Belum ada percakapan"}
              </p>
              {!dmSearch && (
                <>
                  <p className="text-sm text-slate-400 mt-1 mb-5">Mulai obrolan baru dengan seseorang</p>
                  <button
                    onClick={() => setShowNewDM(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white font-bold text-sm shadow-md shadow-purple-200"
                  >
                    <Plus className="h-4 w-4" /> Pesan Baru
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {filteredConvs.map((conv) => (
                <DMCard key={conv.conversationId} conv={conv} currentUserId={user?.id} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {commentAnn && <CommentModal ann={commentAnn} userId={user?.id} onClose={() => setCommentAnn(null)} />}
      {showNewDM && <NewDMModal onClose={() => setShowNewDM(false)} />}

      <BottomNav />
    </div>
  );
}
