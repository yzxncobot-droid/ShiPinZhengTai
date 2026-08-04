import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { adminFetch } from "@/lib/admin-api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Send, MoreVertical, Phone, Smile, Image as ImageIcon,
  Reply, Check, CheckCheck, Trash2, X, PinIcon, Archive, BellOff,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { id as localeId } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OtherUser {
  userId: string;
  username: string;
  avatar?: string;
  role?: string;
}

interface DmMessage {
  id: string;
  conversationId: string;
  content: string;
  messageType: string;
  fileUrl?: string;
  fileName?: string;
  replyToId?: string;
  isDeletedSender?: boolean;
  editedAt?: string;
  createdAt: string;
  senderId: string;
  senderUsername: string;
  senderAvatar?: string;
  isMine: boolean;
  reactions: { emoji: string; count: number }[];
}

interface Conversation {
  conversationId: string;
  isPinned: boolean;
  isArchived: boolean;
  isFavorite: boolean;
  isMuted: boolean;
  otherUser: OtherUser | null;
  lastMessage: any;
  unread: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const QUICK_EMOJI = ["❤️", "👍", "😂", "😮", "😢", "🔥"];

function msgTime(date: string) {
  const d = new Date(date);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Kemarin " + format(d, "HH:mm");
  return format(d, "dd/MM HH:mm");
}

function dateLabel(date: string) {
  const d = new Date(date);
  if (isToday(d)) return "Hari ini";
  if (isYesterday(d)) return "Kemarin";
  return format(d, "dd MMMM yyyy", { locale: localeId });
}

// ─── Emoji Picker (simple) ────────────────────────────────────────────────────

const EMOJI_LIST = [
  "😀","😂","😍","🥰","😊","🤩","😎","🤔","😢","😭",
  "😡","🥺","🤣","😇","🤗","💀","🙈","🔥","💯","✨",
  "❤️","💕","💖","💗","👍","👎","👏","🙏","💪","🎉",
  "🎊","🎶","🎵","🌹","🌸","🍕","🍦","🏆","⚽","🎮",
];

function EmojiPicker({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="absolute bottom-full mb-2 left-0 bg-white rounded-2xl shadow-xl border border-slate-100 p-3 z-50 w-72"
    >
      <div className="grid grid-cols-10 gap-1">
        {EMOJI_LIST.map((e) => (
          <button
            key={e}
            onClick={() => { onSelect(e); onClose(); }}
            className="h-8 w-8 text-lg hover:bg-slate-100 rounded-lg transition-colors flex items-center justify-center"
          >
            {e}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MsgBubble({
  msg, onReply, onDelete, replyMsg,
}: {
  msg: DmMessage;
  onReply: (m: DmMessage) => void;
  onDelete: (id: string) => void;
  replyMsg?: DmMessage;
}) {
  const [showActions, setShowActions] = useState(false);
  const deleted = msg.isDeletedSender && msg.isMine;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${msg.isMine ? "justify-end" : "justify-start"} mb-1`}
    >
      <div className={`max-w-[75%] group`}>
        {/* Reply preview */}
        {msg.replyToId && replyMsg && (
          <div className={`mb-1 px-3 py-1.5 rounded-xl border-l-2 border-purple-400 bg-slate-50 text-xs text-slate-500 truncate ml-${msg.isMine ? "auto" : "0"} mr-${msg.isMine ? "0" : "auto"}`}>
            <span className="font-bold text-purple-600">{replyMsg.senderUsername}</span>: {replyMsg.content}
          </div>
        )}

        <div className="relative">
          <div
            onDoubleClick={() => onReply(msg)}
            onClick={() => setShowActions((v) => !v)}
            className={`
              px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed relative
              ${msg.isMine
                ? "bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-br-sm"
                : "bg-white border border-slate-100 text-slate-800 shadow-sm rounded-bl-sm"}
              ${deleted ? "opacity-60 italic" : ""}
            `}
          >
            {/* Image */}
            {msg.messageType === "image" && msg.fileUrl && (
              <img
                src={msg.fileUrl}
                alt=""
                className="rounded-xl mb-1.5 max-w-full max-h-52 object-cover cursor-pointer"
              />
            )}
            {/* Sticker */}
            {msg.messageType === "sticker" && msg.fileUrl && (
              <img src={msg.fileUrl} alt="sticker" className="h-24 w-24 object-contain" />
            )}
            <span>{msg.content}</span>

            {/* Time + read tick */}
            <div className={`flex items-center justify-end gap-1 mt-0.5 ${msg.isMine ? "text-white/60" : "text-slate-400"}`}>
              <span className="text-[10px]">{msgTime(msg.createdAt)}</span>
              {msg.isMine && <CheckCheck className="h-3 w-3" />}
            </div>
          </div>

          {/* Reactions */}
          {msg.reactions.length > 0 && (
            <div className={`flex gap-0.5 mt-0.5 ${msg.isMine ? "justify-end" : "justify-start"}`}>
              {msg.reactions.map((r) => (
                <span key={r.emoji} className="text-xs bg-white border border-slate-100 rounded-full px-1.5 py-0.5 shadow-sm">
                  {r.emoji} {r.count}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <AnimatePresence>
            {showActions && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`absolute ${msg.isMine ? "right-0" : "left-0"} bottom-full mb-1 bg-white rounded-2xl shadow-xl border border-slate-100 flex items-center gap-1 p-1.5 z-10`}
              >
                {QUICK_EMOJI.slice(0, 5).map((e) => (
                  <button key={e} className="text-base h-8 w-8 flex items-center justify-center hover:bg-slate-50 rounded-xl transition-colors">
                    {e}
                  </button>
                ))}
                <div className="w-px h-5 bg-slate-100" />
                <button
                  onClick={() => { onReply(msg); setShowActions(false); }}
                  className="h-8 w-8 flex items-center justify-center hover:bg-slate-50 rounded-xl transition-colors text-slate-500"
                >
                  <Reply className="h-4 w-4" />
                </button>
                {msg.isMine && (
                  <button
                    onClick={() => { onDelete(msg.id); setShowActions(false); }}
                    className="h-8 w-8 flex items-center justify-center hover:bg-red-50 rounded-xl transition-colors text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => setShowActions(false)}
                  className="h-8 w-8 flex items-center justify-center hover:bg-slate-50 rounded-xl transition-colors text-slate-400"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DmRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fetch conversation info
  const { data: convList = [] } = useQuery<Conversation[]>({
    queryKey: ["dm-conversations"],
    queryFn: () => adminFetch<Conversation[]>("/dm/conversations"),
    enabled: !!user,
  });
  const conv = convList.find((c) => c.conversationId === id);
  const other = conv?.otherUser;

  // Fetch messages (poll every 2s)
  const { data: messages = [], isLoading } = useQuery<DmMessage[]>({
    queryKey: ["dm-messages", id],
    queryFn: () => adminFetch<DmMessage[]>(`/dm/conversations/${id}/messages`),
    refetchInterval: 2000,
    enabled: !!user && !!id,
  });

  // Mark as read on open/new messages
  useEffect(() => {
    if (!id || !user) return;
    adminFetch(`/dm/conversations/${id}/read`, { method: "POST" }).catch(() => {});
  }, [id, messages.length]);

  // Auto scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMut = useMutation({
    mutationFn: (payload: { content: string; replyToId?: string }) =>
      adminFetch(`/dm/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ ...payload, messageType: "text" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-messages", id] });
      qc.invalidateQueries({ queryKey: ["dm-conversations"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (msgId: string) => adminFetch(`/dm/messages/${msgId}`, {
      method: "DELETE",
      body: JSON.stringify({ deleteFor: "everyone" }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dm-messages", id] }),
  });

  const handleSend = () => {
    const t = text.trim();
    if (!t || sendMut.isPending) return;
    sendMut.mutate({ content: t, replyToId: replyTo?.id });
    setText("");
    setReplyTo(null);
    setShowEmoji(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group messages by date
  const grouped: { label: string; msgs: DmMessage[] }[] = [];
  messages.forEach((msg) => {
    const lbl = dateLabel(msg.createdAt);
    const last = grouped[grouped.length - 1];
    if (last?.label === lbl) { last.msgs.push(msg); }
    else { grouped.push({ label: lbl, msgs: [msg] }); }
  });

  const msgMap = Object.fromEntries(messages.map((m) => [m.id, m]));

  return (
    <div className="flex flex-col h-screen bg-slate-50 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100 shadow-sm shrink-0">
        <button onClick={() => setLocation("/chat")} className="h-9 w-9 rounded-full hover:bg-slate-50 flex items-center justify-center transition-colors">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>

        <div className="relative">
          <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
            <AvatarImage src={other?.avatar ?? ""} />
            <AvatarFallback className="gradient-funplus text-white font-bold">
              {other?.username?.charAt(0).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          {/* We'd show online indicator here if we had presence data */}
        </div>

        <div className="flex-1 min-w-0">
          {other ? (
            <Link href={`/user/${other.username}`}>
              <p className="font-extrabold text-slate-800 text-sm leading-none">{other.username}</p>
            </Link>
          ) : (
            <p className="font-extrabold text-slate-800 text-sm leading-none">Loading...</p>
          )}
          <p className="text-[11px] text-slate-400 font-medium mt-0.5">Pesan langsung</p>
        </div>

        <button
          className="h-9 w-9 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-400 transition-colors"
          aria-label="Call (placeholder)"
        >
          <Phone className="h-4.5 w-4.5" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="h-9 w-9 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-400 transition-colors"
          >
            <MoreVertical className="h-4.5 w-4.5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 mt-1 w-44 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-20">
              {[
                { icon: PinIcon, label: conv?.isPinned ? "Unpin" : "Pin Chat" },
                { icon: Archive, label: conv?.isArchived ? "Unarchive" : "Arsip" },
                { icon: BellOff, label: conv?.isMuted ? "Unmute" : "Senyapkan" },
              ].map(({ icon: Icon, label }) => (
                <button key={label} className="flex items-center gap-3 w-full px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors" onClick={() => setShowMenu(false)}>
                  <Icon className="h-4 w-4 text-slate-400" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "thin" }}>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-full gradient-funplus flex items-center justify-center mb-4 shadow-lg">
              <Avatar className="h-12 w-12">
                <AvatarImage src={other?.avatar ?? ""} />
                <AvatarFallback className="text-white font-bold text-xl bg-transparent">
                  {other?.username?.charAt(0).toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
            </div>
            <p className="font-extrabold text-slate-700 mb-1">Mulai percakapan dengan {other?.username}</p>
            <p className="text-sm text-slate-400 font-medium">Kirim pesan pertamamu! 👋</p>
          </div>
        ) : (
          <>
            {grouped.map(({ label, msgs }) => (
              <div key={label}>
                {/* Date separator */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[11px] font-bold text-slate-400 bg-white px-3 py-1 rounded-full border border-slate-100 shadow-sm">{label}</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                {msgs.map((msg) => (
                  <MsgBubble
                    key={msg.id}
                    msg={msg}
                    onReply={setReplyTo}
                    onDelete={(msgId) => deleteMut.mutate(msgId)}
                    replyMsg={msg.replyToId ? msgMap[msg.replyToId] : undefined}
                  />
                ))}
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Reply preview */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-2 bg-white border-t border-slate-100 flex items-center gap-3"
          >
            <Reply className="h-4 w-4 text-purple-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-purple-600">{replyTo.senderUsername}</p>
              <p className="text-xs text-slate-500 truncate">{replyTo.content}</p>
            </div>
            <button onClick={() => setReplyTo(null)} className="h-6 w-6 flex items-center justify-center hover:bg-slate-50 rounded-full">
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="px-3 py-3 bg-white border-t border-slate-100 shrink-0" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-2">
          {/* Emoji */}
          <div className="relative">
            <button
              onClick={() => setShowEmoji((v) => !v)}
              className="h-10 w-10 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-400 transition-colors"
            >
              <Smile className="h-5 w-5" />
            </button>
            <AnimatePresence>
              {showEmoji && <EmojiPicker onSelect={(e) => setText((t) => t + e)} onClose={() => setShowEmoji(false)} />}
            </AnimatePresence>
          </div>

          {/* Text input */}
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ketik pesan..."
            className="flex-1 h-10 px-4 rounded-full bg-slate-50 border border-slate-200 text-sm font-medium focus:outline-none focus:border-purple-300 focus:bg-white transition-all placeholder:text-slate-400"
          />

          {/* Gallery (placeholder) */}
          <button className="h-10 w-10 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-400 transition-colors">
            <ImageIcon className="h-5 w-5" />
          </button>

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={!text.trim() || sendMut.isPending}
            className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-sm shadow-purple-200 disabled:opacity-40 transition-opacity"
          >
            {sendMut.isPending
              ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Send className="h-4.5 w-4.5" />
            }
          </button>
        </div>
      </div>
    </div>
  );
}
