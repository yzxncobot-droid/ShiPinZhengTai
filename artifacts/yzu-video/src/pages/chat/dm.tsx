import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, MoreVertical, Archive, BellOff, Heart, Star, Ban,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface DMessage {
  id: string; conversationId: string; content: string;
  messageType: string; fileUrl?: string; fileName?: string;
  replyToId?: string; editedAt?: string; createdAt: string;
  senderId: string; senderUsername: string; senderAvatar?: string;
  isMine: boolean; reactions: { emoji: string; count: number }[];
}

interface ConvInfo {
  conversationId: string; isPinned: boolean; isFavorite: boolean; isMuted: boolean; isArchived: boolean; isBlocked: boolean;
  otherUser: { userId: string; username: string; avatar?: string } | null;
}

export default function DMPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<DMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; content: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // ── Conversation info ─────────────────────────────────────────────────────

  const { data: conversations = [] } = useQuery({
    queryKey: ["dm-conversations"],
    queryFn: () => adminFetch<ConvInfo[]>("/dm/conversations"),
    enabled: !!user,
  });

  const conv = conversations.find((c: any) => c.conversationId === id) as ConvInfo | undefined;
  const otherUser = conv?.otherUser;

  // ── Messages ──────────────────────────────────────────────────────────────

  const loadMessages = async (before?: string) => {
    const url = `/dm/conversations/${id}/messages?limit=30${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    return adminFetch<DMessage[]>(url);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadMessages().then((data) => {
      if (!cancelled) {
        setMessages(data);
        setHasMore(data.length >= 30);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "instant" }), 50);
      }
    });
    return () => { cancelled = true; };
  }, [id, user]);

  // ── Polling ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const latest = await loadMessages();
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = latest.filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev.map((m) => {
            const updated = latest.find((l) => l.id === m.id);
            return updated ? { ...m, ...updated } : m;
          });
          const atBottom = bottomRef.current &&
            bottomRef.current.getBoundingClientRect().bottom <= window.innerHeight + 200;
          if (atBottom) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          return [...prev.map((m) => {
            const updated = latest.find((l) => l.id === m.id);
            return updated ? { ...m, ...updated } : m;
          }), ...newMsgs];
        });
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [id, user]);

  // ── Mark read ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (user && id) {
      adminFetch(`/dm/conversations/${id}/read`, { method: "POST" }).catch(() => {});
    }
  }, [id, user]);

  // ── Load more ─────────────────────────────────────────────────────────────

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const older = await loadMessages(messages[0]?.createdAt);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length >= 30);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Send ─────────────────────────────────────────────────────────────────

  const sendMsg = async (content: string) => {
    if (!user) { setLocation("/login"); return; }
    try {
      const msg = await adminFetch<DMessage>(`/dm/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, messageType: "text", replyToId: replyTo?.id ?? null }),
      });
      setMessages((prev) => [...prev, msg]);
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["dm-conversations"] });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // ── Attach ───────────────────────────────────────────────────────────────

  const attachFile = async (file: File) => {
    if (!user) return;
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
      const msg = await adminFetch<DMessage>(`/dm/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: upload.fileName, messageType: type, fileUrl: upload.url, fileName: upload.fileName }),
      });
      setMessages((prev) => [...prev, msg]);
      qc.invalidateQueries({ queryKey: ["dm-conversations"] });
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
      await adminFetch(`/dm/messages/${msgId}/react`, { method: "POST", body: JSON.stringify({ emoji }) });
      const latest = await loadMessages();
      setMessages(latest);
    } catch {}
  };

  // ── Delete ───────────────────────────────────────────────────────────────

  const deleteMsg = async (msgId: string, forAll = false) => {
    try {
      await adminFetch(`/dm/messages/${msgId}`, {
        method: "DELETE",
        body: JSON.stringify({ deleteFor: forAll ? "everyone" : "me" }),
      });
      setMessages((prev) => prev.map((m) =>
        m.id === msgId ? { ...m, content: "[Pesan dihapus]" } : m
      ));
    } catch {}
  };

  // ── Settings ─────────────────────────────────────────────────────────────

  const updateSettings = async (settings: Record<string, boolean>) => {
    try {
      await adminFetch(`/dm/conversations/${id}/settings`, {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      qc.invalidateQueries({ queryKey: ["dm-conversations"] });
    } catch {}
  };

  const grouped = messages.map((m, i) => {
    const prev = messages[i - 1];
    const showAvatar = !prev || prev.senderId !== m.senderId ||
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000;
    return { ...m, showAvatar };
  });

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <p className="font-bold text-slate-500">Login untuk melihat pesan</p>
        <button onClick={() => setLocation("/login")} className="text-purple-500 font-bold text-sm">Login →</button>
      </div>
    );
  }

  const displayName = otherUser?.username ?? "Percakapan";
  const displayAvatar = otherUser?.avatar;

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 h-14">
          <button onClick={() => setLocation("/chat")} className="text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>

          {displayAvatar ? (
            <img src={displayAvatar} alt={displayName} className="h-9 w-9 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-extrabold text-sm shrink-0">
              {displayName[0]?.toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-slate-800 truncate">{displayName}</p>
            <p className="text-[10px] text-slate-400">Pesan Langsung</p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
                <MoreVertical className="h-4 w-4 text-slate-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => updateSettings({ isPinned: !conv?.isPinned })} className="gap-2">
                📌 {conv?.isPinned ? "Lepas Pin" : "Pin Chat"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateSettings({ isFavorite: !conv?.isFavorite })} className="gap-2">
                <Heart className="h-3.5 w-3.5" /> {conv?.isFavorite ? "Hapus Favorit" : "Favoritkan"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateSettings({ isMuted: !conv?.isMuted })} className="gap-2">
                <BellOff className="h-3.5 w-3.5" /> {conv?.isMuted ? "Aktifkan Notif" : "Bisukan"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateSettings({ isArchived: true })} className="gap-2">
                <Archive className="h-3.5 w-3.5" /> Arsipkan
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => updateSettings({ isBlocked: !conv?.isBlocked })} className="gap-2 text-red-600 focus:text-red-600">
                <Ban className="h-3.5 w-3.5" /> {conv?.isBlocked ? "Buka Blokir" : "Blokir"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Blocked warning */}
      {conv?.isBlocked && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-center text-xs font-bold text-red-600">
          Anda memblokir pengguna ini. Buka blokir untuk mengirim pesan.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore} className="w-full text-center text-xs text-purple-500 font-bold py-2 hover:underline">
            {loadingMore ? "Memuat..." : "Muat pesan lama"}
          </button>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center mb-3">
              <Star className="h-8 w-8 text-purple-300" />
            </div>
            <p className="font-bold text-slate-400">Mulai percakapan dengan <span className="text-purple-500">{displayName}</span></p>
            <p className="text-xs text-slate-400 mt-1">Pesanmu hanya terlihat oleh kamu dan {displayName}</p>
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
            authorId={msg.senderId}
            authorUsername={msg.senderUsername}
            authorAvatar={msg.senderAvatar}
            createdAt={msg.createdAt}
            editedAt={msg.editedAt}
            isMine={msg.isMine}
            reactions={msg.reactions}
            showAvatar={msg.showAvatar}
            onReact={(emoji) => reactToMsg(msg.id, emoji)}
            onReply={() => setReplyTo({ id: msg.id, username: msg.senderUsername, content: msg.content })}
            onEdit={msg.isMine ? () => {
              const newContent = prompt("Edit pesan:", msg.content);
              if (newContent?.trim()) {
                adminFetch(`/dm/messages/${msg.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ content: newContent }),
                }).then(() => loadMessages().then(setMessages));
              }
            } : undefined}
            onDelete={msg.isMine ? () => deleteMsg(msg.id, false) : undefined}
            onDeleteForAll={msg.isMine ? () => deleteMsg(msg.id, true) : undefined}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={sendMsg}
        onAttach={attachFile}
        placeholder={conv?.isBlocked ? "Buka blokir untuk mengirim" : `Pesan ke ${displayName}...`}
        disabled={!!conv?.isBlocked}
        isUploading={isUploading}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}
