import { useState } from "react";
import { format } from "date-fns";
import { MoreHorizontal, Reply, Trash2, Edit3, Pin, PinOff, Smile, Crown, ShieldCheck, Shield } from "lucide-react";
import { VerificationBadge } from "@/components/ui/VerificationBadge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

const QUICK_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🔥", "👏", "🎉"];

interface Reaction { emoji: string; count: number }

interface Props {
  id: string;
  content: string;
  messageType?: string;
  fileUrl?: string;
  fileName?: string;
  authorId: string;
  authorUsername: string;
  authorAvatar?: string | null;
  authorRole?: string;
  authorSubscriptionStatus?: string;
  authorVerificationBadge?: string | null;
  createdAt: string | Date;
  editedAt?: string | Date | null;
  isPinned?: boolean;
  isDeleted?: boolean;
  isMine?: boolean;
  reactions?: Reaction[];
  myReactions?: string[];
  replyToId?: string | null;
  showAvatar?: boolean;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDeleteForAll?: () => void;
  onPin?: () => void;
  onClickUser?: (userId: string, username: string) => void;
  canModerate?: boolean;
  canPin?: boolean;
}

function Avatar({ username, avatar, size = "sm" }: { username: string; avatar?: string | null; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm";
  if (avatar) {
    return <img src={avatar} alt={username} className={`${sz} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold shrink-0`}>
      {username[0]?.toUpperCase()}
    </div>
  );
}

function RoleBadge({ role, subscriptionStatus }: { role?: string; subscriptionStatus?: string }) {
  if (role === "owner") return (
    <span className="flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 leading-none">
      <Crown className="h-2.5 w-2.5" /> Owner
    </span>
  );
  if (role === "admin") return (
    <span className="flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 leading-none">
      <ShieldCheck className="h-2.5 w-2.5" /> Admin
    </span>
  );
  if (role === "moderator") return (
    <span className="flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 leading-none">
      <Shield className="h-2.5 w-2.5" /> Mod
    </span>
  );
  if (role === "verified_creator") return (
    <span className="flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 leading-none">
      ✓ Creator
    </span>
  );
  if (subscriptionStatus === "active") return (
    <span className="flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 leading-none">
      <Crown className="h-2.5 w-2.5" /> Premium
    </span>
  );
  return null;
}

function MediaContent({ fileUrl, fileName, messageType }: { fileUrl: string; fileName?: string | null; messageType: string }) {
  if (messageType === "image") {
    return (
      <a href={fileUrl} target="_blank" rel="noopener noreferrer">
        <img src={fileUrl} alt={fileName ?? "image"} className="max-w-[240px] rounded-xl object-cover border border-slate-100 cursor-pointer hover:opacity-90 transition-opacity" />
      </a>
    );
  }
  if (messageType === "video") {
    return <video src={fileUrl} controls className="max-w-[280px] rounded-xl border border-slate-100" />;
  }
  if (messageType === "voice") {
    return <audio src={fileUrl} controls className="w-full max-w-[240px]" />;
  }
  if (messageType === "file") {
    return (
      <a href={fileUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 transition-colors rounded-xl px-3 py-2 text-sm font-medium text-slate-700">
        <span>📎</span>
        <span className="truncate max-w-[180px]">{fileName ?? "File"}</span>
      </a>
    );
  }
  return null;
}

export function MessageBubble({
  id, content, messageType = "text", fileUrl, fileName,
  authorId, authorUsername, authorAvatar, authorRole, authorSubscriptionStatus, authorVerificationBadge,
  createdAt, editedAt, isPinned, isDeleted, isMine = false,
  reactions = [], myReactions = [], replyToId,
  showAvatar = true, onReact, onReply, onEdit, onDelete, onDeleteForAll, onPin, onClickUser, canModerate, canPin,
}: Props) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const timeStr = (() => {
    try {
      const d = new Date(createdAt);
      return isNaN(d.getTime()) ? "--:--" : format(d, "HH:mm");
    } catch {
      return "--:--";
    }
  })();

  const bubbleBase = isMine
    ? "bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-t-2xl rounded-bl-2xl rounded-br-md"
    : "bg-white border border-slate-100 text-slate-800 rounded-t-2xl rounded-br-2xl rounded-bl-md shadow-sm";

  return (
    <div className={`flex gap-2.5 group ${isMine ? "flex-row-reverse" : ""} py-0.5`}>
      {/* Avatar — clickable for profile */}
      {showAvatar ? (
        <div className="shrink-0 mt-auto">
          <button
            className="relative focus:outline-none"
            onClick={() => onClickUser?.(authorId, authorUsername)}
          >
            <Avatar username={authorUsername} avatar={authorAvatar} />
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-400 border-2 border-white" />
          </button>
        </div>
      ) : (
        <div className="w-9 shrink-0" />
      )}

      {/* Bubble */}
      <div className={`flex flex-col ${isMine ? "items-end" : "items-start"} max-w-[75%]`}>
        {/* Author + time */}
        {showAvatar && (
          <div className={`flex items-center gap-1.5 mb-1 ${isMine ? "flex-row-reverse" : ""}`}>
            <button
              onClick={() => onClickUser?.(authorId, authorUsername)}
              className="text-[12px] font-extrabold text-slate-800 hover:text-purple-600 transition-colors focus:outline-none"
            >
              {authorUsername}
            </button>
            <VerificationBadge verificationBadge={authorVerificationBadge} size="xs" showTooltip={false} />
            <RoleBadge role={authorRole} subscriptionStatus={authorSubscriptionStatus} />
            <span className="text-[10px] text-slate-400">{timeStr}</span>
          </div>
        )}

        {isPinned && (
          <div className={`flex items-center gap-1 text-[10px] text-amber-500 font-bold mb-0.5 ${isMine ? "flex-row-reverse" : ""}`}>
            <Pin className="h-2.5 w-2.5" /> Pinned
          </div>
        )}

        {/* Content */}
        <div className={`relative px-3.5 py-2.5 ${bubbleBase} ${isDeleted ? "opacity-60 italic" : ""}`}>
          {fileUrl && (
            <div className="mb-2">
              <MediaContent fileUrl={fileUrl} fileName={fileName} messageType={messageType ?? "file"} />
            </div>
          )}
          {content && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{content}</p>
          )}
        </div>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1.5 ${isMine ? "justify-end" : ""}`}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact?.(r.emoji)}
                className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold border transition-all
                  ${myReactions.includes(r.emoji)
                    ? "bg-purple-100 border-purple-300 text-purple-700"
                    : "bg-white border-slate-200 text-slate-600 hover:border-purple-200"
                  }`}
              >
                {r.emoji} <span className="text-[10px]">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Edited marker */}
        {editedAt && (
          <span className="text-[9px] text-slate-400 italic mt-0.5">(diedit)</span>
        )}
      </div>

      {/* Action buttons (appear on hover) */}
      <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity self-center ${isMine ? "flex-row-reverse" : ""}`}>
        {/* Emoji react */}
        {onReact && !isDeleted && (
          <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
            <PopoverTrigger asChild>
              <button className="h-7 w-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:border-purple-300 transition-colors">
                <Smile className="h-3.5 w-3.5 text-slate-500" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align={isMine ? "end" : "start"}>
              <div className="flex gap-1">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => { onReact(e); setShowEmojiPicker(false); }}
                    className="text-lg hover:scale-125 transition-transform p-0.5"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Reply */}
        {onReply && !isDeleted && (
          <button
            onClick={onReply}
            className="h-7 w-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:border-purple-300 transition-colors"
          >
            <Reply className="h-3.5 w-3.5 text-slate-500" />
          </button>
        )}

        {/* More actions */}
        {(isMine || canModerate || canPin) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-7 w-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:border-purple-300 transition-colors">
                <MoreHorizontal className="h-3.5 w-3.5 text-slate-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isMine ? "end" : "start"}>
              {isMine && !isDeleted && onEdit && (
                <DropdownMenuItem onClick={onEdit} className="gap-2">
                  <Edit3 className="h-3.5 w-3.5" /> Edit
                </DropdownMenuItem>
              )}
              {/* Pin action for admin/owner */}
              {canPin && !isDeleted && onPin && (
                <DropdownMenuItem onClick={onPin} className="gap-2 text-amber-600 focus:text-amber-600">
                  {isPinned
                    ? <><PinOff className="h-3.5 w-3.5" /> Unpin</>
                    : <><Pin className="h-3.5 w-3.5" /> Pin pesan</>
                  }
                </DropdownMenuItem>
              )}
              {(isMine || canModerate) && <DropdownMenuSeparator />}
              {isMine && !isDeleted && onDelete && (
                <DropdownMenuItem onClick={onDelete} className="gap-2 text-red-600 focus:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" /> Hapus untuk saya
                </DropdownMenuItem>
              )}
              {isMine && !isDeleted && onDeleteForAll && (
                <DropdownMenuItem onClick={onDeleteForAll} className="gap-2 text-red-600 focus:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" /> Hapus untuk semua
                </DropdownMenuItem>
              )}
              {canModerate && !isMine && !isDeleted && onDelete && (
                <DropdownMenuItem onClick={onDelete} className="gap-2 text-red-600 focus:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" /> Hapus (moderasi)
                </DropdownMenuItem>
              )}
              {/* View profile */}
              {!isMine && onClickUser && (
                <DropdownMenuItem onClick={() => onClickUser(authorId, authorUsername)} className="gap-2">
                  👤 Lihat Profil
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
