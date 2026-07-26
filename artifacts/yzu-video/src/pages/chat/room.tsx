import { useState, useEffect, useRef, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { DropCard } from "@/components/chat/DropCard";
import { CreateDropModal } from "@/components/chat/CreateDropModal";
import { UserProfileModal } from "@/components/user/UserProfileModal";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Users, Pin, MoreVertical, Hash, Lock, Search,
  AlertTriangle, WifiOff, ShieldOff, RefreshCw, Gift, PinOff,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string; roomId: string; content: string; messageType: string;
  fileUrl?: string; fileName?: string; replyToId?: string;
  isPinned: boolean; isDeleted: boolean; editedAt?: string;
  createdAt: string; authorId: string; authorUsername: string;
  authorAvatar?: string; authorRole: string; authorSubscriptionStatus?: string;
  authorVerificationBadge?: string | null;
  reactions: { emoji: string; count: number }[];
  myReactions: string[];
}

interface Room {
  id: string; name: string; slug: string; description?: string;
  imageUrl?: string; isLocked: boolean; slowModeSeconds: number;
  rules?: string; memberCount: number; category?: string;
  isPinnedGroup?: boolean; isPublic?: boolean;
  membership?: { role: string; isBanned: boolean; isMuted: boolean } | null;
}

// ── Inline Error Boundary (per-section) ───────────────────────────────────────

interface EBState { hasError: boolean; error: Error | null }
class SectionBoundary extends Component<{ label: string; children: ReactNode }, EBState> {
  state: EBState = { hasError: false, error: null };
  static getDerivedStateFromError(e: Error): EBState { return { hasError: true, error: e }; }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error(`[ChatRoom:${this.props.label}] render error:`, e, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-100 rounded-xl m-2 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{this.props.label} gagal ditampilkan.</span>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="ml-auto underline font-bold"
          >Coba lagi</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="px-4 py-1.5 flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce"
            style={{ animationDelay: `${delay}ms` }} />
        ))}
      </div>
      <span className="text-xs text-slate-400">
        <strong className="text-slate-500">{names[0]}</strong>
        {names.length === 1 ? " sedang mengetik..." : ` dan ${names.length - 1} lainnya mengetik...`}
      </span>
    </div>
  );
}

function safeDate(raw: string | Date | null | undefined): string {
  if (!raw) return "--:--";
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? "--:--" : format(d, "d MMMM yyyy", { locale: localeId });
  } catch { return "--:--"; }
}

function groupMessagesByDate(msgs: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  for (const m of msgs) {
    const d = safeDate(m.createdAt);
    const last = groups[groups.length - 1];
    if (last?.date === d) last.messages.push(m);
    else groups.push({ date: d, messages: [m] });
  }
  return groups;
}

// ── Error States ──────────────────────────────────────────────────────────────

function RoomNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-[100dvh] gap-4 px-6 text-center bg-white">
      <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
        <Hash className="h-8 w-8 text-slate-300" />
      </div>
      <h2 className="font-extrabold text-slate-700 text-lg">Room tidak ditemukan</h2>
      <p className="text-sm text-slate-400 max-w-[240px]">
        Room ini mungkin sudah dihapus atau kamu tidak memiliki akses.
      </p>
      <button onClick={onBack} className="text-purple-500 font-bold text-sm flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Chat
      </button>
    </div>
  );
}

function RoomLoadError({ onRetry, onBack }: { onRetry: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-[100dvh] gap-4 px-6 text-center bg-white">
      <div className="h-16 w-16 rounded-2xl bg-red-50 flex items-center justify-center">
        <WifiOff className="h-8 w-8 text-red-300" />
      </div>
      <h2 className="font-extrabold text-slate-700 text-lg">Gagal memuat room</h2>
      <p className="text-sm text-slate-400 max-w-[240px]">
        Terjadi kesalahan jaringan atau server. Coba lagi.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 bg-purple-500 text-white text-sm font-bold px-4 py-2 rounded-2xl"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Coba Lagi
        </button>
        <button onClick={onBack} className="text-slate-500 font-bold text-sm px-4 py-2 rounded-2xl border border-slate-200">
          Kembali
        </button>
      </div>
    </div>
  );
}

function InvalidRoomId({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-[100dvh] gap-4 px-6 text-center bg-white">
      <div className="h-16 w-16 rounded-2xl bg-amber-50 flex items-center justify-center">
        <AlertTriangle className="h-8 w-8 text-amber-300" />
      </div>
      <h2 className="font-extrabold text-slate-700 text-lg">ID Room tidak valid</h2>
      <p className="text-sm text-slate-400">URL room ini tidak valid.</p>
      <button onClick={onBack} className="text-purple-500 font-bold text-sm flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Chat
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [replyTo, setReplyTo] = useState<{ id: string; username: string; content: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isValidId = !!id && UUID_RE.test(id);

  // ── New feature state ──────────────────────────────────────────────────────
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [showCreateDrop, setShowCreateDrop] = useState(false);
  const [dropKey, setDropKey] = useState(0); // bump to refresh DropCard after creating

  // ── Guard: invalid ID ───────────────────────────────────────────────────────

  if (!isValidId) {
    return <InvalidRoomId onBack={() => setLocation("/chat")} />;
  }

  // ── Room info ──────────────────────────────────────────────────────────────

  const {
    data: room,
    isLoading: loadingRoom,
    isError: roomError,
    refetch: refetchRoom,
  } = useQuery({
    queryKey: ["chat-room", id],
    queryFn: () => adminFetch<Room>(`/chat/rooms/${id}`),
    enabled: isValidId,
    retry: 2,
  });

  // ── Pinned messages ─────────────────────────────────────────────────────────

  const { data: pinnedMessages = [], refetch: refetchPinned } = useQuery({
    queryKey: ["chat-pinned", id],
    queryFn: async () => {
      try { return await adminFetch<Message[]>(`/chat/rooms/${id}/pinned`); }
      catch { return []; }
    },
    enabled: isValidId && !!room,
    staleTime: 30000,
  });
  const topPinned = (pinnedMessages ?? [])[0] ?? null;

  // ── Messages load ──────────────────────────────────────────────────────────

  const loadMessages = useCallback(async (before?: string): Promise<Message[]> => {
    if (!id || !UUID_RE.test(id)) return [];
    const url = `/chat/rooms/${id}/messages?limit=40${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    return adminFetch<Message[]>(url);
  }, [id]);

  // Initial load
  useEffect(() => {
    if (!isValidId || !room) return;
    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);
    loadMessages()
      .then((data) => {
        if (cancelled) return;
        const safe = Array.isArray(data) ? data : [];
        setMessages(safe);
        setHasMore(safe.length >= 40);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "instant" }), 50);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[ChatRoom] initial load failed:", err);
        setMessagesError(err?.message ?? "Gagal memuat pesan");
      })
      .finally(() => { if (!cancelled) setMessagesLoading(false); });
    return () => { cancelled = true; };
  }, [id, room, loadMessages, isValidId]);

  // ── Real-time polling (2.5 s) ──────────────────────────────────────────────

  useEffect(() => {
    if (!isValidId || !room) return;
    const interval = setInterval(async () => {
      try {
        const latest = await loadMessages();
        if (!Array.isArray(latest)) return;
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
      } catch (err) {
        console.warn("[ChatRoom] polling error:", err);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [loadMessages, isValidId, room]);

  // ── Typing indicator polling ────────────────────────────────────────────────

  useEffect(() => {
    if (!isValidId || !room) return;
    const interval = setInterval(async () => {
      try {
        const data = await adminFetch<{ users: string[] }>(`/chat/rooms/${id}/typing`);
        const users: string[] = Array.isArray(data?.users) ? data.users : [];
        setTypingUsers(users.filter((u) => u !== (user?.username ?? "")));
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [id, user?.username, isValidId, room]);

  // ── Mark as read ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isValidId || !user?.id) return;
    adminFetch(`/chat/rooms/${id}/read`, { method: "POST" }).catch(() => {});
  }, [id, user?.id, isValidId]);

  // ── Load more ─────────────────────────────────────────────────────────────

  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0]?.createdAt;
      if (!oldest) return;
      const older = await loadMessages(oldest);
      if (!Array.isArray(older)) return;
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 40);
    } catch (err) {
      console.error("[ChatRoom] loadMore failed:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Notify typing ─────────────────────────────────────────────────────────

  const notifyTyping = useCallback(() => {
    if (!isValidId || !user) return;
    adminFetch(`/chat/rooms/${id}/typing`, { method: "POST" }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  }, [id, user, isValidId]);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMsg = async (content: string) => {
    if (!user) { setLocation("/login"); return; }
    if (!content?.trim()) return;
    try {
      const msg = await adminFetch<Message>(`/chat/rooms/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: content.trim(), messageType: "text", replyToId: replyTo?.id ?? null }),
      });
      if (msg && msg.id) {
        setMessages((prev) => [...prev, msg]);
        setReplyTo(null);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch (err: any) {
      console.error("[ChatRoom] sendMsg failed:", err);
      alert(err?.message ?? "Gagal mengirim pesan");
    }
  };

  // ── Attach file ───────────────────────────────────────────────────────────

  const attachFile = async (file: File) => {
    if (!user) { setLocation("/login"); return; }
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
      const upload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(upload?.error ?? "Upload failed");
      const type = upload.folder === "chat-images" ? "image"
        : upload.folder === "chat-videos" ? "video"
        : upload.folder === "voice-notes" ? "voice" : "file";
      const msg = await adminFetch<Message>(`/chat/rooms/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: upload.originalName ?? "",
          messageType: type,
          fileUrl: upload.url,
          fileName: upload.originalName,
        }),
      });
      if (msg && msg.id) {
        setMessages((prev) => [...prev, msg]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch (err: any) {
      console.error("[ChatRoom] attachFile failed:", err);
      alert(err?.message ?? "Upload gagal");
    } finally {
      setIsUploading(false);
    }
  };

  // ── React ─────────────────────────────────────────────────────────────────

  const reactToMsg = async (msgId: string, emoji: string) => {
    if (!user || !msgId || !emoji) return;
    try {
      await adminFetch(`/chat/rooms/${id}/messages/${msgId}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      const latest = await loadMessages();
      if (Array.isArray(latest)) setMessages(latest);
    } catch (err) {
      console.warn("[ChatRoom] reactToMsg failed:", err);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteMsg = async (msgId: string) => {
    if (!msgId) return;
    try {
      await adminFetch(`/chat/rooms/${id}/messages/${msgId}`, { method: "DELETE" });
      setMessages((prev) => prev.map((m) =>
        m.id === msgId ? { ...m, isDeleted: true, content: "[Pesan dihapus]" } : m
      ));
    } catch (err) {
      console.error("[ChatRoom] deleteMsg failed:", err);
    }
  };

  // ── Pin ───────────────────────────────────────────────────────────────────

  const pinMsg = async (msgId: string) => {
    if (!msgId) return;
    try {
      await adminFetch(`/chat/rooms/${id}/messages/${msgId}/pin`, { method: "PATCH" });
      refetchPinned();
      const latest = await loadMessages();
      if (Array.isArray(latest)) setMessages(latest);
    } catch (err: any) {
      console.warn("[ChatRoom] pinMsg failed:", err);
    }
  };

  // ── Join room ─────────────────────────────────────────────────────────────

  const joinRoom = async () => {
    if (!user) { setLocation("/login"); return; }
    try {
      await adminFetch(`/chat/rooms/${id}/join`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["chat-room", id] });
    } catch (err: any) {
      console.error("[ChatRoom] joinRoom failed:", err);
      alert(err?.message ?? "Gagal bergabung");
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const canModerate = ["admin", "owner", "moderator"].includes(user?.role ?? "");
  const canPin      = ["admin", "owner"].includes(user?.role ?? "");
  const canDrop     = ["admin", "owner"].includes(user?.role ?? "");
  const isBanned    = room?.membership?.isBanned ?? false;

  const grouped = messages.map((m, i) => {
    const prev = messages[i - 1];
    const showAvatar = !prev || prev.authorId !== m.authorId ||
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000;
    return { ...m, showAvatar };
  });
  const dateGroups = groupMessagesByDate(grouped);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loadingRoom) {
    return (
      <div className="flex flex-col h-[100dvh] bg-white">
        <div className="h-14 bg-white border-b border-slate-100 flex items-center gap-3 px-4">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className={`h-12 rounded-2xl ${i % 3 === 0 ? "w-2/3" : "w-1/2"} ${i % 2 === 0 ? "" : "ml-auto"}`} />
          ))}
        </div>
      </div>
    );
  }

  // ── Error states ──────────────────────────────────────────────────────────

  if (roomError) {
    return <RoomLoadError onRetry={() => refetchRoom()} onBack={() => setLocation("/chat")} />;
  }

  if (!room) {
    return <RoomNotFound onBack={() => setLocation("/chat")} />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50">

      {/* ── Top Navigation Bar ── */}
      <SectionBoundary label="Header">
        <div className="bg-white border-b border-slate-100 shadow-sm shrink-0">
          <div className="flex items-center gap-2.5 px-3 h-14">

            {/* Back */}
            <button
              onClick={() => setLocation("/chat")}
              className="h-9 w-9 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors shrink-0"
            >
              <ArrowLeft className="h-5 w-5 text-slate-600" />
            </button>

            {/* Group avatar */}
            {room.imageUrl ? (
              <img src={room.imageUrl} alt={room.name ?? "Room"} className="h-9 w-9 rounded-xl object-cover shrink-0" />
            ) : (
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                <Hash className="h-4 w-4 text-white" />
              </div>
            )}

            {/* Group info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-extrabold text-slate-800 truncate text-[15px]">
                  {room.name ?? "Unknown Room"}
                </p>
                {room.isLocked && <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Users className="h-3 w-3" />
                {(room.memberCount ?? 0).toLocaleString()} anggota
                {room.category && (
                  <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-500">
                    {room.category}
                  </span>
                )}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Create Drop button (admin/owner) */}
              {canDrop && (
                <button
                  onClick={() => setShowCreateDrop(true)}
                  className="h-9 w-9 rounded-full hover:bg-purple-50 flex items-center justify-center transition-colors relative"
                  title="Create Drop"
                >
                  <Gift className="h-4 w-4 text-purple-500" />
                </button>
              )}
              <button className="h-9 w-9 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
                <Search className="h-4 w-4 text-slate-500" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-9 w-9 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
                    <MoreVertical className="h-4 w-4 text-slate-500" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {room.membership ? (
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() =>
                        adminFetch(`/chat/rooms/${id}/leave`, { method: "POST" })
                          .then(() => { qc.invalidateQueries({ queryKey: ["chat-room", id] }); setLocation("/chat"); })
                          .catch((err) => alert(err?.message ?? "Gagal keluar"))
                      }
                    >
                      Keluar dari Grup
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={joinRoom}>Bergabung</DropdownMenuItem>
                  )}
                  {room.rules && (
                    <DropdownMenuItem onClick={() => alert(room.rules)}>Peraturan Grup</DropdownMenuItem>
                  )}
                  {canDrop && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowCreateDrop(true)} className="gap-2">
                        <Gift className="h-3.5 w-3.5 text-purple-500" /> Buat Drop
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Pinned message banner */}
          {topPinned && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-100">
              <Pin className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-extrabold text-amber-600 leading-none mb-0.5">
                  {topPinned.authorUsername}
                </p>
                <p className="text-[11px] text-amber-800 font-medium truncate">
                  {topPinned.content ?? ""}
                </p>
              </div>
              {canPin && (
                <button
                  onClick={() => pinMsg(topPinned.id)}
                  className="text-amber-400 hover:text-amber-600 transition-colors shrink-0"
                  title="Unpin"
                >
                  <PinOff className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </SectionBoundary>

      {/* ── Active Drops ── */}
      <SectionBoundary label="DropCard">
        <DropCard key={dropKey} userId={user?.id} roomId={id} />
      </SectionBoundary>

      {/* ── Messages area ── */}
      <SectionBoundary label="Messages">
        <div className="flex-1 overflow-y-auto px-3 py-2">

          {/* Load more */}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full text-center text-xs text-purple-500 font-bold py-3 hover:underline disabled:opacity-50"
            >
              {loadingMore ? "Memuat..." : "↑ Muat pesan lama"}
            </button>
          )}

          {/* Messages loading skeleton */}
          {messagesLoading && (
            <div className="space-y-3 pt-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className={`h-10 rounded-2xl ${i % 2 === 0 ? "w-2/3" : "w-1/2 ml-auto"}`} />
              ))}
            </div>
          )}

          {/* Messages error */}
          {!messagesLoading && messagesError && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <WifiOff className="h-10 w-10 text-slate-200" />
              <p className="font-bold text-slate-400 text-sm">Gagal memuat pesan</p>
              <p className="text-xs text-slate-400">{messagesError}</p>
              <button
                onClick={() => {
                  setMessagesError(null);
                  setMessagesLoading(true);
                  loadMessages()
                    .then((data) => {
                      const safe = Array.isArray(data) ? data : [];
                      setMessages(safe);
                      setHasMore(safe.length >= 40);
                    })
                    .catch((e) => setMessagesError(e?.message ?? "Gagal"))
                    .finally(() => setMessagesLoading(false));
                }}
                className="flex items-center gap-1.5 text-xs text-purple-500 font-bold border border-purple-200 rounded-xl px-3 py-2"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Coba Lagi
              </button>
            </div>
          )}

          {/* Empty state */}
          {!messagesLoading && !messagesError && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Hash className="h-10 w-10 text-slate-200 mb-3" />
              <p className="font-bold text-slate-400">Jadilah yang pertama mengirim pesan!</p>
              {room.description && (
                <p className="text-sm text-slate-400 mt-1 max-w-[240px]">{room.description}</p>
              )}
            </div>
          )}

          {/* Grouped messages */}
          {!messagesLoading && !messagesError && dateGroups.map((dg) => (
            <div key={dg.date}>
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[11px] text-slate-400 font-bold px-2">{dg.date}</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
              <div className="space-y-0.5">
                {dg.messages.map((msg) => (
                  <SectionBoundary key={msg.id} label={`msg:${msg.id}`}>
                    <MessageBubble
                      id={msg.id}
                      content={msg.content ?? ""}
                      messageType={msg.messageType ?? "text"}
                      fileUrl={msg.fileUrl}
                      fileName={msg.fileName}
                      authorId={msg.authorId}
                      authorUsername={msg.authorUsername ?? "Unknown"}
                      authorAvatar={msg.authorAvatar}
                      authorRole={msg.authorRole ?? "meril"}
                      authorSubscriptionStatus={msg.authorSubscriptionStatus}
                      authorVerificationBadge={msg.authorVerificationBadge}
                      createdAt={msg.createdAt}
                      editedAt={msg.editedAt}
                      isPinned={msg.isPinned ?? false}
                      isDeleted={msg.isDeleted ?? false}
                      isMine={msg.authorId === user?.id}
                      reactions={Array.isArray(msg.reactions) ? msg.reactions : []}
                      myReactions={Array.isArray(msg.myReactions) ? msg.myReactions : []}
                      showAvatar={(msg as any).showAvatar ?? true}
                      onReact={(emoji) => reactToMsg(msg.id, emoji)}
                      onReply={() => setReplyTo({ id: msg.id, username: msg.authorUsername ?? "Unknown", content: msg.content ?? "" })}
                      onEdit={msg.authorId === user?.id ? () => {
                        const newContent = prompt("Edit pesan:", msg.content ?? "");
                        if (newContent?.trim()) {
                          adminFetch(`/chat/rooms/${id}/messages/${msg.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ content: newContent }),
                          })
                            .then(() => loadMessages().then((d) => { if (Array.isArray(d)) setMessages(d); }))
                            .catch((err) => alert(err?.message ?? "Edit gagal"));
                        }
                      } : undefined}
                      onDelete={msg.authorId === user?.id || canModerate ? () => deleteMsg(msg.id) : undefined}
                      onPin={canPin ? () => pinMsg(msg.id) : undefined}
                      onClickUser={(userId) => setProfileUserId(userId)}
                      canModerate={canModerate}
                      canPin={canPin}
                    />
                  </SectionBoundary>
                ))}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </SectionBoundary>

      {/* ── Typing indicator ── */}
      <TypingIndicator names={typingUsers} />

      {/* ── Input ── */}
      <SectionBoundary label="ChatInput">
        {isBanned ? (
          <div className="p-4 bg-red-50 border-t border-red-100 text-center text-sm font-bold text-red-600">
            <ShieldOff className="h-4 w-4 inline mr-1.5" />
            Anda di-ban dari grup ini
          </div>
        ) : (
          <ChatInput
            onSend={sendMsg}
            onAttach={attachFile}
            onTyping={notifyTyping}
            placeholder={room.isLocked && !canModerate ? "Grup dikunci 🔒" : `Pesan ke ${room.name ?? "grup"}...`}
            disabled={(room.isLocked && !canModerate) || !user}
            isUploading={isUploading}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            slowModeSeconds={room.slowModeSeconds ?? 0}
          />
        )}
      </SectionBoundary>

      {/* ── Modals ── */}
      {profileUserId && (
        <UserProfileModal
          userId={profileUserId}
          open={!!profileUserId}
          onClose={() => setProfileUserId(null)}
        />
      )}

      {id && (
        <CreateDropModal
          roomId={id}
          open={showCreateDrop}
          onClose={() => setShowCreateDrop(false)}
          onCreated={() => setDropKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
