import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { DropCard } from "@/components/chat/DropCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Users, Pin, MoreVertical, Hash, Lock, Search,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

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

function groupMessagesByDate(msgs: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  for (const m of msgs) {
    const d = format(new Date(m.createdAt), "d MMMM yyyy", { locale: localeId });
    const last = groups[groups.length - 1];
    if (last?.date === d) last.messages.push(m);
    else groups.push({ date: d, messages: [m] });
  }
  return groups;
}

export default function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; content: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Room info ──────────────────────────────────────────────────────────────

  const { data: room, isLoading: loadingRoom } = useQuery({
    queryKey: ["chat-room", id],
    queryFn: () => adminFetch<Room>(`/chat/rooms/${id}`),
  });

  // ── Pinned messages ─────────────────────────────────────────────────────────

  const { data: pinnedMessages = [] } = useQuery({
    queryKey: ["chat-pinned", id],
    queryFn: () => adminFetch<Message[]>(`/chat/rooms/${id}/pinned`),
    enabled: !!id,
    staleTime: 30000,
  });
  const topPinned = pinnedMessages[0] ?? null;

  // ── Messages load ─────────────────────────────────────────────────────────

  const loadMessages = useCallback(async (before?: string) => {
    const url = `/chat/rooms/${id}/messages?limit=40${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    return adminFetch<Message[]>(url);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    loadMessages().then((data) => {
      if (!cancelled) {
        setMessages(data);
        setHasMore(data.length >= 40);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "instant" }), 50);
      }
    });
    return () => { cancelled = true; };
  }, [id, loadMessages]);

  // ── Real-time polling (2.5s) ───────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const latest = await loadMessages();
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
    }, 2500);
    return () => clearInterval(interval);
  }, [loadMessages]);

  // ── Typing indicator polling ────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await adminFetch<{ username: string }[]>(`/chat/rooms/${id}/typing`);
        setTypingUsers(data.map((d) => d.username).filter((u) => u !== user?.username));
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [id, user?.username]);

  // ── Mark as read ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (user && id) {
      adminFetch(`/chat/rooms/${id}/read`, { method: "POST" }).catch(() => {});
    }
  }, [id, user]);

  // ── Load more ─────────────────────────────────────────────────────────────

  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const older = await loadMessages(messages[0]?.createdAt);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 40);
    } finally { setLoadingMore(false); }
  };

  // ── Notify typing ────────────────────────────────────────────────────────

  const notifyTyping = useCallback(() => {
    if (!id || !user) return;
    adminFetch(`/chat/rooms/${id}/typing`, { method: "POST" }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  }, [id, user]);

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMsg = async (content: string) => {
    if (!user) { setLocation("/login"); return; }
    try {
      const msg = await adminFetch<Message>(`/chat/rooms/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, messageType: "text", replyToId: replyTo?.id ?? null }),
      });
      setMessages((prev) => [...prev, msg]);
      setReplyTo(null);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) { alert(err.message); }
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
      const upload = await res.json();
      if (!res.ok) throw new Error(upload.error ?? "Upload failed");
      const type = upload.folder === "chat-images" ? "image"
        : upload.folder === "chat-videos" ? "video"
        : upload.folder === "voice-notes" ? "voice" : "file";
      const msg = await adminFetch<Message>(`/chat/rooms/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: upload.originalName ?? "", messageType: type, fileUrl: upload.url, fileName: upload.originalName }),
      });
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) { alert(err.message); } finally { setIsUploading(false); }
  };

  // ── React ────────────────────────────────────────────────────────────────

  const reactToMsg = async (msgId: string, emoji: string) => {
    if (!user) return;
    try {
      await adminFetch(`/chat/rooms/${id}/messages/${msgId}/react`, {
        method: "POST", body: JSON.stringify({ emoji }),
      });
      const latest = await loadMessages();
      setMessages(latest);
    } catch {}
  };

  // ── Delete ───────────────────────────────────────────────────────────────

  const deleteMsg = async (msgId: string) => {
    try {
      await adminFetch(`/chat/rooms/${id}/messages/${msgId}`, { method: "DELETE" });
      setMessages((prev) => prev.map((m) =>
        m.id === msgId ? { ...m, isDeleted: true, content: "[Pesan dihapus]" } : m
      ));
    } catch {}
  };

  // ── Join room ────────────────────────────────────────────────────────────

  const joinRoom = async () => {
    if (!user) { setLocation("/login"); return; }
    try {
      await adminFetch(`/chat/rooms/${id}/join`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["chat-room", id] });
    } catch (err: any) { alert(err.message); }
  };

  const canModerate = ["admin", "owner"].includes(user?.role ?? "");
  const isBanned    = room?.membership?.isBanned ?? false;

  // ── Group messages ────────────────────────────────────────────────────────

  const grouped = messages.map((m, i) => {
    const prev = messages[i - 1];
    const showAvatar = !prev || prev.authorId !== m.authorId ||
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000;
    return { ...m, showAvatar };
  });
  const dateGroups = groupMessagesByDate(grouped);

  // ── Loading skeleton ──────────────────────────────────────────────────────

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

  if (!room) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] gap-3">
        <p className="font-bold text-slate-500">Grup tidak ditemukan</p>
        <button onClick={() => setLocation("/chat")} className="text-purple-500 font-bold text-sm">← Kembali</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50">
      {/* ── Top Navigation Bar (Telegram-style) ── */}
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
            <img src={room.imageUrl} alt={room.name} className="h-9 w-9 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
              <Hash className="h-4.5 w-4.5 text-white" />
            </div>
          )}

          {/* Group info */}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {}}>
            <div className="flex items-center gap-1.5">
              <p className="font-extrabold text-slate-800 truncate text-[15px]">{room.name}</p>
              {room.isLocked && <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <Users className="h-3 w-3" />
              {room.memberCount.toLocaleString()} anggota
              {room.category && (
                <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-500">
                  {room.category}
                </span>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 shrink-0">
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
                    onClick={() => adminFetch(`/chat/rooms/${id}/leave`, { method: "POST" })
                      .then(() => { qc.invalidateQueries({ queryKey: ["chat-room", id] }); setLocation("/chat"); })}
                  >
                    Keluar dari Grup
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={joinRoom}>Bergabung</DropdownMenuItem>
                )}
                {room.rules && (
                  <DropdownMenuItem onClick={() => alert(room.rules)}>Peraturan Grup</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Pinned message banner */}
        {topPinned && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-100">
            <span className="text-amber-500 shrink-0 text-sm">📌</span>
            <p className="flex-1 text-[11px] text-amber-800 font-medium truncate">
              <span className="font-extrabold">Disematkan: </span>{topPinned.content}
            </p>
          </div>
        )}
      </div>

      {/* ── Active Drops ── */}
      <DropCard userId={user?.id} />

      {/* ── Messages area ── */}
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

        {messages.length === 0 && !loadingMore && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Hash className="h-10 w-10 text-slate-200 mb-3" />
            <p className="font-bold text-slate-400">Jadilah yang pertama mengirim pesan!</p>
            {room.description && (
              <p className="text-sm text-slate-400 mt-1 max-w-[240px]">{room.description}</p>
            )}
          </div>
        )}

        {/* Grouped messages */}
        {dateGroups.map((dg) => (
          <div key={dg.date}>
            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 h-px bg-slate-100" />
              <span className="text-[11px] text-slate-400 font-bold px-2">{dg.date}</span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div className="space-y-0.5">
              {dg.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  id={msg.id}
                  content={msg.content}
                  messageType={msg.messageType}
                  fileUrl={msg.fileUrl}
                  fileName={msg.fileName}
                  authorUsername={msg.authorUsername}
                  authorAvatar={msg.authorAvatar}
                  authorRole={msg.authorRole}
                  authorSubscriptionStatus={msg.authorSubscriptionStatus}
                  authorVerificationBadge={msg.authorVerificationBadge}
                  createdAt={msg.createdAt}
                  editedAt={msg.editedAt}
                  isPinned={msg.isPinned}
                  isDeleted={msg.isDeleted}
                  isMine={msg.authorId === user?.id}
                  reactions={msg.reactions}
                  myReactions={msg.myReactions}
                  showAvatar={(msg as any).showAvatar}
                  onReact={(emoji) => reactToMsg(msg.id, emoji)}
                  onReply={() => setReplyTo({ id: msg.id, username: msg.authorUsername, content: msg.content })}
                  onEdit={msg.authorId === user?.id ? () => {
                    const newContent = prompt("Edit pesan:", msg.content);
                    if (newContent?.trim()) {
                      adminFetch(`/chat/rooms/${id}/messages/${msg.id}`, {
                        method: "PATCH", body: JSON.stringify({ content: newContent }),
                      }).then(() => loadMessages().then(setMessages));
                    }
                  } : undefined}
                  onDelete={msg.authorId === user?.id || canModerate ? () => deleteMsg(msg.id) : undefined}
                  canModerate={canModerate}
                />
              ))}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* ── Typing indicator ── */}
      <TypingIndicator names={typingUsers} />

      {/* ── Input ── */}
      {isBanned ? (
        <div className="p-4 bg-red-50 border-t border-red-100 text-center text-sm font-bold text-red-600">
          Anda di-ban dari grup ini
        </div>
      ) : (
        <ChatInput
          onSend={sendMsg}
          onAttach={attachFile}
          onTyping={notifyTyping}
          placeholder={room.isLocked && !canModerate ? "Grup dikunci 🔒" : `Pesan ke ${room.name}...`}
          disabled={(room.isLocked && !canModerate) || !user}
          isUploading={isUploading}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          slowModeSeconds={room.slowModeSeconds}
        />
      )}
    </div>
  );
}
