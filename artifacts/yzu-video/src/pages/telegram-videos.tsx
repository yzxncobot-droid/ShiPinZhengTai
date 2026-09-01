/**
 * Telegram Videos — public catalog page.
 *
 * Lists all indexed Telegram videos from enabled sources, with optional
 * source filter and search. This is a SEPARATE catalog from the existing
 * video system — no existing page is modified.
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Film, Search, Lock, Clock, HardDrive, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { tgApi, formatFileSize, formatDuration, type TelegramVideo } from "@/lib/telegram-api";

export default function TelegramVideosPage() {
  const [videos, setVideos] = useState<TelegramVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState<{ id: string; name: string; videoCount: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, srcs] = await Promise.all([
        tgApi.listVideos({ page, limit: 24, sourceId: sourceFilter || undefined, search: search || undefined }),
        tgApi.listVideoSources(),
      ]);
      setVideos(data.data);
      setTotal(data.total);
      setSources(srcs);
    } catch {
      setVideos([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, sourceFilter, search]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / 24) || 1;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Film className="h-5 w-5 text-purple-500" />
            Telegram Videos
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {total} videos from Telegram sources
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search Telegram videos..."
              className="pl-9"
            />
          </div>
          <Select
            value={sourceFilter || "all"}
            onValueChange={(v) => { setSourceFilter(v === "all" ? "" : v); setPage(1); }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.videoCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Video Grid */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : videos.length === 0 ? (
          <div className="text-center py-16">
            <Film className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No Telegram videos found.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {videos.map((v) => (
                <Link key={v.id} href={`/telegram-videos/${v.id}`}>
                  <Card className="overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">
                    {/* Thumbnail placeholder */}
                    <div className="aspect-video bg-muted flex items-center justify-center relative">
                      <Film className="h-8 w-8 text-muted-foreground/40" />
                      {v.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                          {formatDuration(v.duration)}
                        </span>
                      )}
                      {v.isPremium && (
                        <Badge variant="default" className="absolute top-1 left-1 gap-0.5 text-xs">
                          <Lock className="h-2.5 w-2.5" /> Premium
                        </Badge>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-sm font-medium truncate">{v.title}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        {v.sourceName && <span className="truncate">{v.sourceName}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        {v.fileSize != null && (
                          <span className="flex items-center gap-0.5">
                            <HardDrive className="h-2.5 w-2.5" />{formatFileSize(v.fileSize)}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <Button
                  variant="outline" size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline" size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
