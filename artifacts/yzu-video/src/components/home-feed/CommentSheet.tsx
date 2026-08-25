import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { fetchHomeFeedComments, postHomeFeedComment, type HomeFeedComment } from "@/lib/home-feed-api";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/admin-api";

interface CommentSheetProps {
  open: boolean;
  onClose: () => void;
  videoId: string;
  count: number;
  onCommented?: () => void;
}

export function CommentSheet({ open, onClose, videoId, count, onCommented }: CommentSheetProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<HomeFeedComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchHomeFeedComments(videoId)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [open, videoId]);

  async function handleSend() {
    const content = text.trim();
    if (!content || sending || !user) return;
    setSending(true);
    try {
      const created = await postHomeFeedComment(videoId, content);
      setComments((prev) => [created, ...prev]);
      setText("");
      onCommented?.();
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[55] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-[56] mx-auto max-w-[480px] rounded-t-[28px] bg-white flex flex-col"
            style={{ maxHeight: "70vh", paddingBottom: "env(safe-area-inset-bottom)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            {/* Handle */}
            <div className="pt-2.5 pb-1 flex justify-center">
              <div className="h-1.5 w-10 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-2 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-800">
                Komentar <span className="text-slate-400">({count})</span>
              </h3>
              <button onClick={onClose} className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* List */}
            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {loading ? (
                <p className="text-center text-sm text-slate-400 py-8">Memuat komentar...</p>
              ) : comments.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm font-bold text-slate-500">Belum ada komentar</p>
                  <p className="text-xs text-slate-400 mt-1">Jadikan yang pertama mengomentari!</p>
                </div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={c.user?.avatar ?? undefined} />
                      <AvatarFallback className="text-[11px] bg-purple-100 text-purple-700 font-bold">
                        {c.user?.username?.charAt(0).toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-extrabold text-slate-700 truncate">
                          {c.user?.username ?? "Pengguna"}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">{relativeTime(c.createdAt)}</span>
                      </div>
                      <p className="text-sm text-slate-600 break-words mt-0.5">{c.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input */}
            {user ? (
              <div className="border-t border-slate-100 p-3 flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                  placeholder="Tulis komentar..."
                  className="flex-1 h-10 rounded-full bg-slate-100 px-4 text-sm outline-none focus:ring-2 focus:ring-purple-300"
                />
                <button
                  onClick={handleSend}
                  disabled={!text.trim() || sending}
                  className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-500 text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="border-t border-slate-100 p-3 text-center text-xs text-slate-400">
                Login untuk mengomentari.
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
