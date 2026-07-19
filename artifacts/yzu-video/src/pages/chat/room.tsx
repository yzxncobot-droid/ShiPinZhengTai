import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Users, Pin, MoreVertical, Hash, Lock, Info,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Message {
  id: string; roomId: string; content: string; messageType: string;
  fileUrl?: string; fileName?: string; replyToId?: string;
  isPinned: boolean; isDeleted: boolean; editedAt?: string;
  createdAt: string; authorId: string; authorUsername: string;
  authorAvatar?: string; authorRole: string;
  reactions: { emoji: string; count: number }[];
  myReactions: string[];
}

interface Room {
  id: string; name: string; slug: string; description?: string;
  imageUrl?: string; isLocked: boolean; slowModeSeconds: number;
  rules?: string; memberCount: number;
  membership?: { role: string; isBanned: boolean; isMuted: boolean } | null;
}

export default function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; content: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // ── Room info ──────────────────────────────────────────────────────────────

  const { data: room, isLoading: loadingRoom } = useQuery({
    queryKey: ["chat-room", id],
    queryFn: () => adminFetch<Room>(`/chat/rooms/${id}`),
  });

  // ── Initial messages load ─────────────────────────────────────────────────

  const loadMessages = useCallback(async (before?: string) => {
    const url = `/chat/rooms/${id}/messages?limit=30${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    return adminFetch<Message[]>(url);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    loadMessages().then((data) => {
      if (!cancelled) {
        setMessages(data);
        setHasMore(data.length >= 30);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "instant" }), 50);
      }
    });
    return () => { cancelled = true; };
  }, [id, loadMessages]);

  // ── Polling for new messages ───────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const latest = await loadMessages();
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = latest.filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;
          // Auto scroll if near bottom
          const atBottom = bottomRef.current &&
            bottomRef.current.getBoundingClientRect().bottom <= window.innerHeight + 200;
          if (atBottom) {
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }
          return [...prev.filter((m) => {
            // Update existing messages (reactions, edits, deletes)
            const updated = latest.find((l) => l.id === m.id);
            return true; // keep all
          }).map((m) => {
            const updated = latest.find((l) => l.id === m.id);
            return updated ? { ...m, ...updated } : m;
          }), ...newMsgs];
        });
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [id, loadMessages]);

  // ── Mark as read ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (user && id) {
      adminFetch(`/chat/rooms/${id}/read`, { method: "POST" }).catch(() => {});
    }
  }, [id, user]);

  // ── Load more (older messages) ────────────────────────────────────────────

  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0]?.createdAt;
      const older = await loadMessages(oldest);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 30);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMsg = async (content: string) => {
    if (!user) { setLocation("/login"); return; }
    try {
      const msg = await adminFetch<Message>(`/chat/rooms/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content,
          messageType: "text",
          replyToId: replyTo?.id ?? null,
        }),
      });
      setMessages((prev) => [...prev, msg]);
      setReplyTo(null);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // ── Attach file ───────────────────────────────────────────────────────────

  const attachFile = async (file: File) => {
    if (!user) { setLocation("/login"); return; }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const TOKEN_KEY = "yzu_token";
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch("/api/chat/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const upload = await res.json();
      if (!res.ok) throw new Error(upload.error ?? "Upload failed");

      const type = upload.folder === "chat-images" ? "image"
        : upload.folder === "chat-videos" ? "video"
        : upload.folder === "voice-notes" ? "voice"
        : "file";

      const msg = await adminFetch<Message>(`/chat/rooms/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: upload.fileName,
          messageType: type,
          fileUrl: upload.url,
          fileName: upload.fileName,
        }),
      });
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // ── React ────────────────────────────────────────────────────────────────

  const reactToMsg = async (msgId: string, emoji: string) => {
    if (!user) return;
    try {
      await adminFetch(`/chat/rooms/${id}/messages/${msgId}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      // Refresh messages
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
    } catch (err: any) {
      alert(err.message);
    }
  };

  const canModerate = ["admin", "owner"].includes(user?.role ?? "");
  const isMember = !!room?.membership;
  const isBanned = room?.membership?.isBanned;

  // ── Group messages by sender ──────────────────────────────────────────────

  const grouped = messages.map((m, i) => {
    const prev = messages[i - 1];
    const showAvatar = !prev || prev.authorId !== m.authorId ||
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000;
    return { ...m, showAvatar };
  });

  if (loadingRoom) {
    return (
      <div className="flex flex-col h-screen bg-white">
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
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <p className="font-bold text-slate-500">Room tidak ditemukan</p>
        <button onClick={() => setLocation("/chat")} className="text-purple-500 font-bold text-sm">← Kembali</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => setLocation("/chat")} className="text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>

          {room.imageUrl ? (
            <img src={room.imageUrl} alt={room.name} className="h-8 w-8 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center shrink-0">
              <Hash className="h-4 w-4 text-white" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-extrabold text-slate-800 truncate">{room.name}</p>
              {room.isLocked && <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
            </div>
            <p className="text-[10px] text-slate-400 flex items-center gap-1">
              <Users className="h-2.5 w-2.5" /> {room.memberCount.toLocaleString()} anggota
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
                <MoreVertical className="h-4 w-4 text-slate-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isMember
                ? <DropdownMenuItem onClick={() => adminFetch(`/chat/rooms/${id}/leave`, { method: "POST" }).then(() => { qc.invalidateQueries({ queryKey: ["chat-room", id] }); setLocation("/chat"); })} className="text-red-600">Keluar dari Room</DropdownMenuItem>
                : <DropdownMenuItem onClick={joinRoom}>Bergabung</DropdownMenuItem>
              }
              {room.rules && <DropdownMenuItem onClick={() => alert(room.rules)}>Lihat Peraturan</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Description */}
        {room.description && (
          <div className="px-4 pb-2">
            <p className="text-xs text-slate-500 truncate">{room.description}</p>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {/* Load more */}
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full text-center text-xs text-purple-500 font-bold py-2 hover:underline"
          >
            {loadingMore ? "Memuat..." : "Muat pesan lama"}
          </button>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Hash className="h-10 w-10 text-slate-200 mb-3" />
            <p className="font-bold text-slate-400">Jadilah yang pertama mengirim pesan!</p>
          </div>
        )}

        {grouped.map((msg) => (
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
            createdAt={msg.createdAt}
            editedAt={msg.editedAt}
            isPinned={msg.isPinned}
            isDeleted={msg.isDeleted}
            isMine={msg.authorId === user?.id}
            reactions={msg.reactions}
            myReactions={msg.myReactions}
            showAvatar={msg.showAvatar}
            onReact={(emoji) => reactToMsg(msg.id, emoji)}
            onReply={() => setReplyTo({ id: msg.id, username: msg.authorUsername, content: msg.content })}
            onEdit={msg.authorId === user?.id ? () => {
              const newContent = prompt("Edit pesan:", msg.content);
              if (newContent?.trim()) {
                adminFetch(`/chat/rooms/${id}/messages/${msg.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ content: newContent }),
                }).then(() => loadMessages().then(setMessages));
              }
            } : undefined}
            onDelete={msg.authorId === user?.id || canModerate ? () => deleteMsg(msg.id) : undefined}
            canModerate={canModerate}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {isBanned ? (
        <div className="p-4 bg-red-50 border-t border-red-100 text-center text-sm font-bold text-red-600">
          Anda di-ban dari room ini
        </div>
      ) : (
        <ChatInput
          onSend={sendMsg}
          onAttach={attachFile}
          placeholder={room.isLocked && !canModerate ? "Room dikunci" : `Pesan ke #${room.name}...`}
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
