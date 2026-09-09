/**
 * Telegram Video Picker — for the Admin Upload page.
 *
 * Fetches the existing Telegram video catalog via GET /api/telegram-videos
 * and lets the admin select ONE video. The selected video's id is stored
 * as `telegramVideoId` — the video binary stays in Telegram and is streamed
 * via the existing Telegram streaming system.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Loader2, AlertCircle, Film, Clock, HardDrive,
  CheckCircle2, Send, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  tgApi, formatFileSize, formatDuration, type TelegramVideo,
} from "@/lib/telegram-api";

interface TelegramVideoPickerProps {
  selectedId: string | null;
  onSelect: (video: TelegramVideo) => void;
}

export function TelegramVideoPicker({ selectedId, onSelect }: TelegramVideoPickerProps) {
  const [videos, setVideos] = useState<TelegramVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LIMIT = 12;

  const fetchVideos = useCallback(async (pageNum: number, searchTerm: string, append: boolean) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    try {
      // Use the shared tgApi helper — same service as the public
      // /telegram-videos page, ensuring a single source of data.
      const json = await tgApi.listVideos({
        page: pageNum,
        limit: LIMIT,
        search: searchTerm || undefined,
      });

      setVideos(prev => append ? [...prev, ...json.data] : json.data);
      setTotal(json.total);
      setHasMore(json.page * json.limit < json.total);
      setPage(json.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat video Telegram");
      if (!append) setVideos([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchVideos(1, "", false);
  }, [fetchVideos]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
      fetchVideos(1, value, false);
    }, 400);
  };

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      fetchVideos(page + 1, search, true);
    }
  }, [loadingMore, hasMore, page, search, fetchVideos]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-sky-500" />
        <p className="text-sm font-medium text-gray-500">Memuat video Telegram…</p>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm font-semibold text-red-600">Gagal memuat video Telegram</p>
        <p className="text-xs text-gray-400">{error}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fetchVideos(1, search, false)}
          className="mt-1"
        >
          Coba Lagi
        </Button>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (videos.length === 0 && !search) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <Film className="h-10 w-10 text-gray-300" />
        <p className="text-sm font-semibold text-gray-500">Belum ada video Telegram yang siap digunakan</p>
        <p className="text-xs text-gray-400 max-w-xs">
          Import video dari Telegram terlebih dahulu melalui menu Telegram Sources.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Cari video Telegram…"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 border-sky-200 focus:border-sky-400 bg-sky-50/30"
        />
      </div>

      {/* Video list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[360px] overflow-y-auto space-y-2 pr-1 -mr-1"
      >
        {videos.length === 0 && search ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
            <Search className="h-8 w-8 text-gray-300" />
            <p className="text-sm font-medium text-gray-400">
              Tidak ada video untuk "{search}"
            </p>
          </div>
        ) : (
          videos.map((v) => {
            const isSelected = selectedId === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onSelect(v)}
                className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 transition-all text-left
                  ${isSelected
                    ? "border-sky-400 bg-sky-50 shadow-sm"
                    : "border-gray-200 bg-white hover:border-sky-200 hover:bg-sky-50/50"
                  }`}
              >
                {/* Thumbnail placeholder */}
                <div className="shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-gradient-to-br from-sky-100 to-blue-200 flex items-center justify-center">
                  <Film className="h-6 w-6 text-sky-400" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold truncate ${isSelected ? "text-sky-700" : "text-gray-700"}`}>
                    {v.title || v.fileName || "Video Tanpa Judul"}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                    {v.duration != null && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock className="h-3 w-3" /> {formatDuration(v.duration)}
                      </span>
                    )}
                    {v.fileSize != null && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <HardDrive className="h-3 w-3" /> {formatFileSize(v.fileSize)}
                      </span>
                    )}
                    {v.telegramDate && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Calendar className="h-3 w-3" />
                        {new Date(v.telegramDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                  {v.sourceName && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 mt-1">
                      <Send className="h-3 w-3" /> {v.sourceName}
                    </span>
                  )}
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="shrink-0 flex items-center gap-1 text-sky-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                )}
              </button>
            );
          })
        )}

        {/* Load more indicator */}
        {loadingMore && (
          <div className="flex justify-center py-3">
            <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
          </div>
        )}
      </div>

      {/* Footer count */}
      {videos.length > 0 && (
        <p className="text-xs text-gray-400 text-center">
          Menampilkan {videos.length} dari {total} video
        </p>
      )}
    </div>
  );
}
