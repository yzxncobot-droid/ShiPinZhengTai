import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Megaphone, MessageSquare, Mail, Plus, Hash, Pin,
  ThumbsUp, MessageCircle, Share2, Heart, ChevronRight,
  Lock, Users, Bell, Search, ArrowRight, ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Announcement {
  id: string; title: string; content: string;
  imageUrl?: string; videoUrl?: string; linkUrl?: string; linkLabel?: string;
  isPinned: boolean; authorUsername: string; authorAvatar?: string;
  createdAt: string; updatedAt: string;
  reactions: { emoji: string; count: number }[];
  commentCount: number;
  myReactions: string[];
}

interface ChatRoom {
  id: string; name: string; slug: string; description?: string;
  imageUrl?: string; isLocked: boolean; memberCount: number; unread: number;
}

interface Conversation {
  conversationId: string; isPinned: boolean; isFavorite: boolean; isMuted: boolean;
  unread: number;
  otherUser: { userId: string; username: string; avatar?: string } | null;
  lastMessage: { content: string; messageType: string; createdAt: string; senderId: string } | null;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "announcements", label: "Pengumuman", icon: Megaphone },
  { id: "rooms",         label: "Public Chat", icon: MessageSquare },
  { id: "dm",           label: "Pesan Langsung",    icon: Mail },
] as const;

type Tab = typeof TABS[number]["id"];

// ─── Helper ───────────────────────────────────────────────────────────────────

function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: localeId });
}

function Avatar({ username, avatar, size = "md" }: { username: string; avatar?: string | null; size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-12 w-12 text-base" }[size];
  if (avatar) return <img src={avatar} alt={username} className={`${sz} rounded-full object-cover shrink-0`} />;
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold shrink-0`}>
      {username[0]?.toUpperCase()}
    </div>
  );
}

// ─── Announcement Card ────────────────────────────────────────────────────────

function AnnouncementCard({ ann, userId, onReact, onComment }: {
  ann: Announcement;
  userId?: string;
  onReact: (id: string, emoji: string) => void;
  onComment: (ann: Announcement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = ann.content.length > 200;
  const displayContent = isLong && !expanded ? ann.content.slice(0, 200) + "…" : ann.content;

  const QUICK_REACT = ["❤️", "👍", "🔥", "🎉", "😢"];

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${ann.isPinned ? "border-amber-200" : "border-slate-100"}`}>
      {ann.isPinned && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-50 border-b border-amber-100">
          <Pin className="h-3 w-3 text-amber-500" />
          <span className="text-[11px] font-extrabold text-amber-600 uppercase tracking-wide">Disematkan</span>
        </div>
      )}

      {/* Image */}
      {ann.imageUrl && (
        <img src={ann.imageUrl} alt="" className="w-full h-40 object-cover" />
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-3">
          <Avatar username={ann.authorUsername} avatar={ann.authorAvatar} size="sm" />
          <div>
            <p className="text-[11px] font-bold text-amber-600">Yzu视频</p>
            <p className="text-[10px] text-slate-400">{timeAgo(ann.createdAt)}</p>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-extrabold text-slate-800 text-base leading-snug mb-2">{ann.title}</h3>

        {/* Content */}
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{displayContent}</p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-purple-500 font-bold mt-1">
            {expanded ? "Sembunyikan" : "Selengkapnya"}
          </button>
        )}

        {/* Link */}
        {ann.linkUrl && (
          <a
            href={ann.linkUrl} target="_blank" rel="noopener noreferrer"
            className="mt-3 flex items-center gap-2 text-sm font-bold text-purple-600 bg-purple-50 border border-purple-100 rounded-xl px-3 py-2 hover:bg-purple-100 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {ann.linkLabel ?? ann.linkUrl}
          </a>
        )}

        {/* Quick reactions */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {QUICK_REACT.map((e) => {
            const r = ann.reactions.find((rx) => rx.emoji === e);
            const mine = ann.myReactions.includes(e);
            return (
              <button
                key={e}
                onClick={() => userId && onReact(ann.id, e)}
                className={`flex items-center gap-0.5 px-2 py-1 rounded-full text-xs font-bold border transition-all
                  ${mine ? "bg-purple-100 border-purple-300 text-purple-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:border-purple-200"}`}
              >
                {e} {r ? r.count : ""}
              </button>
            );
          })}
        </div>

        {/* Actions */}
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

// ─── Room Card ────────────────────────────────────────────────────────────────

function RoomCard({ room, onJoin }: { room: ChatRoom; onJoin: (id: string) => void }) {
  const [, setLocation] = useLocation();
  const COLORS = ["from-purple-400 to-pink-400", "from-blue-400 to-cyan-400", "from-amber-400 to-orange-400", "from-green-400 to-teal-400", "from-rose-400 to-pink-500"];
  const color = COLORS[room.name.charCodeAt(0) % COLORS.length];

  return (
    <div
      className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3 cursor-pointer hover:border-purple-200 hover:bg-purple-50/30 transition-all active:scale-[0.98]"
      onClick={() => setLocation(`/chat/room/${room.id}`)}
    >
      {room.imageUrl ? (
        <img src={room.imageUrl} alt={room.name} className="h-12 w-12 rounded-2xl object-cover shrink-0" />
      ) : (
        <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center shrink-0`}>
          <Hash className="h-6 w-6 text-white" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-extrabold text-slate-800 truncate">{room.name}</p>
          {room.isLocked && <Lock className="h-3 w-3 text-slate-400 shrink-0" />}
        </div>
        {room.description && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{room.description}</p>
        )}
        <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
          <Users className="h-3 w-3" /> {room.memberCount.toLocaleString()} anggota
        </p>
      </div>
      {room.unread > 0 && (
        <span className="h-5 min-w-[20px] rounded-full bg-purple-500 text-white text-[10px] font-extrabold flex items-center justify-center px-1.5 shrink-0">
          {room.unread > 99 ? "99+" : room.unread}
        </span>
      )}
    </div>
  );
}

// ─── DM Card ─────────────────────────────────────────────────────────────────

function DMCard({ conv }: { conv: Conversation }) {
  const [, setLocation] = useLocation();

  return (
    <div
      className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3.5 flex items-center gap-3 cursor-pointer hover:border-purple-200 hover:bg-purple-50/30 transition-all active:scale-[0.98]"
      onClick={() => setLocation(`/chat/dm/${conv.conversationId}`)}
    >
      {conv.otherUser ? (
        <div className="relative shrink-0">
          <Avatar username={conv.otherUser.username} avatar={conv.otherUser.avatar} size="md" />
          {conv.isFavorite && (
            <div className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-amber-400 flex items-center justify-center">
              <Heart className="h-2.5 w-2.5 text-white fill-white" />
            </div>
          )}
        </div>
      ) : (
        <div className="h-10 w-10 rounded-full bg-slate-200 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="font-extrabold text-slate-800 truncate">
            {conv.isPinned && <span className="text-purple-400 mr-1">📌</span>}
            {conv.otherUser?.username ?? "Pengguna"}
          </p>
          {conv.lastMessage && (
            <span className="text-[10px] text-slate-400 shrink-0 ml-2">
              {timeAgo(conv.lastMessage.createdAt)}
            </span>
          )}
        </div>
        <p className={`text-xs truncate mt-0.5 ${conv.unread > 0 ? "font-bold text-slate-700" : "text-slate-400"}`}>
          {conv.isMuted && "🔇 "}
          {conv.lastMessage
            ? conv.lastMessage.messageType !== "text"
              ? `[${conv.lastMessage.messageType}]`
              : conv.lastMessage.content
            : "Belum ada pesan"
          }
        </p>
      </div>
      {conv.unread > 0 && (
        <span className="h-5 min-w-[20px] rounded-full bg-purple-500 text-white text-[10px] font-extrabold flex items-center justify-center px-1.5 shrink-0">
          {conv.unread > 99 ? "99+" : conv.unread}
        </span>
      )}
    </div>
  );
}

// ─── Comment Modal ────────────────────────────────────────────────────────────

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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 mb-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
          ) : comments.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">Belum ada komentar</div>
          ) : (
            comments.map((c: any) => (
              <div key={c.id} className="flex gap-2.5">
                <Avatar username={c.authorUsername} avatar={c.authorAvatar} size="sm" />
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
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && content.trim() && submit.mutate()}
              placeholder="Tulis komentar..."
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:border-purple-300 bg-slate-50"
            />
            <Button
              onClick={() => submit.mutate()}
              disabled={!content.trim() || submit.isPending}
              className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none"
            >
              Kirim
            </Button>
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400">Login untuk berkomentar</p>
        )}
      </div>
    </div>
  );
}

// ─── New DM Search ────────────────────────────────────────────────────────────

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
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-t-3xl p-5 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-slate-800">Pesan Baru</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari username..."
            autoFocus
            className="w-full pl-9 pr-4 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:border-purple-300"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {query.length < 2 ? (
            <p className="text-center text-sm text-slate-400 py-8">Ketik minimal 2 karakter</p>
          ) : users.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">Pengguna tidak ditemukan</p>
          ) : (
            users.map((u: any) => (
              <button
                key={u.id}
                onClick={() => startDM.mutate(u.id)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-purple-50 transition-colors"
              >
                <Avatar username={u.username} avatar={u.avatar} size="sm" />
                <div className="text-left">
                  <p className="font-bold text-sm text-slate-800">{u.username}</p>
                  <p className="text-[11px] text-slate-400 capitalize">{u.role}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 ml-auto" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChatHomePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("announcements");
  const [commentAnn, setCommentAnn] = useState<Announcement | null>(null);
  const [showNewDM, setShowNewDM] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: announcements = [], isLoading: loadingAnn } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => adminFetch<Announcement[]>("/announcements?limit=30"),
    refetchInterval: 30000,
  });

  const { data: rooms = [], isLoading: loadingRooms } = useQuery({
    queryKey: ["chat-rooms"],
    queryFn: () => adminFetch<ChatRoom[]>("/chat/rooms"),
    refetchInterval: 15000,
    enabled: activeTab === "rooms",
  });

  const { data: conversations = [], isLoading: loadingDMs } = useQuery({
    queryKey: ["dm-conversations"],
    queryFn: () => adminFetch<Conversation[]>("/dm/conversations"),
    refetchInterval: 8000,
    enabled: activeTab === "dm" && !!user,
  });

  // Unread counts
  const { data: chatUnread } = useQuery({
    queryKey: ["chat-unread"],
    queryFn: () => adminFetch<{ unread: number }>("/chat/unread"),
    refetchInterval: 15000,
    enabled: !!user,
  });
  const { data: dmUnread } = useQuery({
    queryKey: ["dm-unread"],
    queryFn: () => adminFetch<{ unread: number }>("/dm/unread"),
    refetchInterval: 8000,
    enabled: !!user,
  });
  const { data: annUnread } = useQuery({
    queryKey: ["announcements-unread"],
    queryFn: () => adminFetch<{ unread: number }>("/announcements-unread"),
    refetchInterval: 30000,
    enabled: !!user,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const reactToAnn = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) =>
      adminFetch(`/announcements/${id}/react`, { method: "POST", body: JSON.stringify({ emoji }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabUnreads: Record<Tab, number> = {
    announcements: annUnread?.unread ?? 0,
    rooms: chatUnread?.unread ?? 0,
    dm: dmUnread?.unread ?? 0,
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-extrabold text-slate-800">Chat</h1>
              <p className="text-xs text-slate-400">Komunitas & Pesan Langsung</p>
            </div>
            {activeTab === "dm" && user && (
              <Button
                onClick={() => setShowNewDM(true)}
                size="sm"
                className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none shadow-md shadow-purple-500/20 gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Pesan
              </Button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const unread = tabUnreads[tab.id];
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-extrabold rounded-t-xl transition-all relative
                    ${isActive
                      ? "text-purple-600 border-b-2 border-purple-500 bg-purple-50/50"
                      : "text-slate-400 hover:text-slate-600"
                    }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {unread > 0 && (
                    <span className="absolute top-1 right-1 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {/* ── Announcements tab ── */}
        {activeTab === "announcements" && (
          <>
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
                <AnnouncementCard
                  key={ann.id}
                  ann={ann}
                  userId={user?.id}
                  onReact={(id, emoji) => reactToAnn.mutate({ id, emoji })}
                  onComment={setCommentAnn}
                />
              ))
            )}
          </>
        )}

        {/* ── Public Rooms tab ── */}
        {activeTab === "rooms" && (
          <>
            {loadingRooms ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
            ) : rooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <MessageSquare className="h-12 w-12 text-slate-200 mb-3" />
                <p className="font-bold text-slate-500">Belum ada room</p>
                <p className="text-sm text-slate-400 mt-1">Owner akan membuat room chat komunitas</p>
              </div>
            ) : (
              rooms.map((room) => (
                <RoomCard key={room.id} room={room} onJoin={() => {}} />
              ))
            )}
          </>
        )}

        {/* ── DM tab ── */}
        {activeTab === "dm" && (
          <>
            {!user ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Mail className="h-12 w-12 text-slate-200 mb-3" />
                <p className="font-bold text-slate-500">Login untuk melihat pesan</p>
              </div>
            ) : loadingDMs ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Mail className="h-12 w-12 text-slate-200 mb-3" />
                <p className="font-bold text-slate-500">Belum ada percakapan</p>
                <p className="text-sm text-slate-400 mt-1 mb-4">Kirim pesan pertama ke seseorang</p>
                <Button
                  onClick={() => setShowNewDM(true)}
                  className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 border-none gap-2"
                >
                  <Plus className="h-4 w-4" /> Pesan Baru
                </Button>
              </div>
            ) : (
              conversations.map((conv) => (
                <DMCard key={conv.conversationId} conv={conv} />
              ))
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {commentAnn && (
        <CommentModal ann={commentAnn} userId={user?.id} onClose={() => setCommentAnn(null)} />
      )}
      {showNewDM && <NewDMModal onClose={() => setShowNewDM(false)} />}

      <BottomNav />
    </div>
  );
}
