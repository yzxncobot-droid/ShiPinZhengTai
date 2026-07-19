import { useState, useRef, KeyboardEvent } from "react";
import { Send, Smile, X, Mic, Image as ImageIcon } from "lucide-react";
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = content.trim().length > 0 && !disabled && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(content.trim());
      setContent("");
      // reset height
      if (textareaRef.current) {
        textareaRef.current.style.height = "40px";
      }
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
    <div className="bg-white border-t border-slate-100 px-3 py-2.5">
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
        {/* Left action buttons: image, video, mic */}
        {onAttach && (
          <>
            <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
            <input type="file" ref={videoInputRef} className="hidden" accept="video/mp4,video/webm" onChange={handleFileChange} />
            <input type="file" ref={voiceInputRef} className="hidden" accept="audio/webm,audio/ogg,audio/mp4" onChange={handleFileChange} />

            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={disabled || isUploading}
              title="Kirim gambar"
              className="h-9 w-9 rounded-2xl hover:bg-slate-100 transition-colors flex items-center justify-center shrink-0 disabled:opacity-40 text-slate-500"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => voiceInputRef.current?.click()}
              disabled={disabled || isUploading}
              title="Kirim pesan suara"
              className="h-9 w-9 rounded-2xl hover:bg-slate-100 transition-colors flex items-center justify-center shrink-0 disabled:opacity-40 text-slate-500"
            >
              <Mic className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Text input + emoji */}
        <div className="flex-1 flex items-end bg-slate-50 border border-slate-200 rounded-2xl focus-within:border-purple-300 transition-colors px-3 py-1.5">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm leading-snug focus:outline-none min-h-[24px] max-h-[120px] py-0.5"
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
              <button className="ml-1.5 text-slate-400 hover:text-purple-500 transition-colors shrink-0 self-end pb-0.5">
                <Smile className="h-5 w-5" />
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

        {/* Send button - purple circle */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-all
            ${canSend
              ? "bg-purple-600 text-white shadow-md shadow-purple-500/30 hover:bg-purple-700 hover:scale-105 active:scale-95"
              : "bg-slate-100 text-slate-300"
            }`}
        >
          {sending
            ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : isUploading
              ? <div className="h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              : <Send className="h-4 w-4" />
          }
        </button>
      </div>
    </div>
  );
}
