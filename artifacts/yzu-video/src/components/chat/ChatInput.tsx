import { useState, useRef, KeyboardEvent } from "react";
import { Send, Paperclip, Smile, X, Mic, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

const EMOJI_LIST = [
  "😀","😂","😍","🥰","😎","🤔","😢","😡","🔥","❤️",
  "👍","👏","🎉","✅","💯","🙏","😊","😅","🤣","😇",
  "🥳","😴","🤯","🥺","😱","🙌","💪","✨","🚀","💎",
  "🌟","🎯","💰","🏆","👑","🎵","🎮","📱","💡","🌹",
];

interface Props {
  onSend: (content: string, type?: "text") => void | Promise<void>;
  onAttach?: (file: File) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  isUploading?: boolean;
  replyTo?: { username: string; content: string } | null;
  onCancelReply?: () => void;
  slowModeSeconds?: number;
}

export function ChatInput({
  onSend, onAttach, placeholder = "Ketik pesan...",
  disabled = false, isUploading = false,
  replyTo, onCancelReply,
  slowModeSeconds = 0,
}: Props) {
  const [content, setContent] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = content.trim().length > 0 && !disabled && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(content.trim());
      setContent("");
      textareaRef.current?.focus();
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertEmoji = (emoji: string) => {
    setContent((prev) => prev + emoji);
    setEmojiOpen(false);
    textareaRef.current?.focus();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onAttach) {
      onAttach(file);
      e.target.value = "";
    }
  };

  return (
    <div className="p-3 bg-white border-t border-slate-100">
      {/* Reply preview */}
      {replyTo && (
        <div className="flex items-center gap-2 mb-2 bg-purple-50 border border-purple-100 rounded-xl px-3 py-1.5">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-purple-600">{replyTo.username}</p>
            <p className="text-[11px] text-slate-500 truncate">{replyTo.content}</p>
          </div>
          <button onClick={onCancelReply} className="text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Slow mode warning */}
      {slowModeSeconds > 0 && (
        <p className="text-[10px] text-amber-600 font-medium mb-1.5 px-1">
          ⏳ Slow mode: 1 pesan setiap {slowModeSeconds} detik
        </p>
      )}

      <div className="flex items-end gap-2">
        {/* Attach */}
        {onAttach && (
          <>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*,video/mp4,video/webm,application/pdf,.docx,.zip,audio/webm,audio/ogg"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isUploading}
              className="h-10 w-10 rounded-2xl bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center shrink-0 disabled:opacity-40"
            >
              {isUploading
                ? <div className="h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                : <Paperclip className="h-4 w-4 text-slate-500" />
              }
            </button>
          </>
        )}

        {/* Text area + emoji */}
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="resize-none min-h-[40px] max-h-[120px] pr-10 rounded-2xl border-slate-200 focus:border-purple-300 bg-slate-50 text-sm py-2.5 leading-snug"
            style={{ height: "auto" }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          {/* Emoji picker */}
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <button className="absolute right-2.5 bottom-2 text-slate-400 hover:text-purple-500 transition-colors">
                <Smile className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end" side="top">
              <div className="grid grid-cols-10 gap-0.5">
                {EMOJI_LIST.map((e) => (
                  <button
                    key={e}
                    onClick={() => insertEmoji(e)}
                    className="text-xl hover:scale-125 transition-transform p-0.5 rounded"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 transition-all
            ${canSend
              ? "bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md shadow-purple-500/25 hover:scale-105"
              : "bg-slate-100 text-slate-300"
            }`}
        >
          {sending
            ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Send className="h-4 w-4" />
          }
        </button>
      </div>
    </div>
  );
}
