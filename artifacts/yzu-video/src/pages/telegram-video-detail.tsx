/**
 * Telegram Video Detail & Player page.
 *
 * Shows a single Telegram video with a native HTML5 <video> player that
 * streams from /api/telegram-videos/:id/stream. The browser automatically
 * sends Range requests for seeking — the backend handles 206 Partial Content.
 *
 * If the video is premium and the user lacks access, a lock screen is shown.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  ArrowLeft, Film, Lock, HardDrive, Clock, Loader2, AlertCircle, Star,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { tgApi, formatFileSize, formatDuration, type TelegramVideo } from "@/lib/telegram-api";
import { probeStreamError } from "@/lib/probe-stream-error";
import { describeVideoPlaybackError } from "@/lib/video-playback-error";
import { useAuth } from "@/lib/auth";

export default function TelegramVideoDetailPage() {
  const [, params] = useRoute("/telegram-videos/:id");
  const id = params?.id ?? "";
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const [video, setVideo] = useState<TelegramVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Playback ticket flow — the native <video> element cannot send the
  // Authorization header, so playback authenticates via ?ticket=.
  const [streamSrc, setStreamSrc] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const ticketRetriesRef = useRef(0);
  const ticketRequestId = useRef(0);
  // Metadata-load timeout: if the <video> never receives even metadata within
  // this window, the stream is stalled (not merely slow) — probe the endpoint
  // for the real error and surface it instead of an infinite native spinner.
  const metadataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const METADATA_TIMEOUT_MS = 25000;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    tgApi.getVideo(id)
      .then((v) => { setVideo(v); setError(null); })
      .catch((err) => setError(err.message || "Failed to load video"))
      .finally(() => setLoading(false));
  }, [id]);

  // True once the user is known, the video is loaded, and access is confirmed
  // (the premium-locked / not-logged-in early returns below already handle
  // the cases where this stays false).
  const canStream = !!video && !!user && !(video.isPremium && video.hasAccess === false);
  const thumbnailSrc = video?.thumbnailUrl ||
    (video?.hasThumbnail ? tgApi.thumbnailUrl(video.id) : undefined);

  const loadStreamTicket = useCallback(async (resumeAt?: number) => {
    if (!id) return;
    const requestId = ++ticketRequestId.current;
    setStreamLoading(true);
    setStreamError(null);
    setStreamSrc(null);
    try {
      const { ticket } = await tgApi.createStreamTicket(id);
      if (typeof ticket !== "string" || !ticket) {
        throw new Error("Invalid playback ticket");
      }
      const url = tgApi.streamUrl(id, ticket);
      // "#t=" media fragment resumes at resumeAt after a ticket refresh.
      if (requestId === ticketRequestId.current) {
        setStreamSrc(resumeAt && resumeAt > 0 ? `${url}#t=${resumeAt}` : url);
      }
    } catch {
      if (requestId === ticketRequestId.current) {
        setStreamError("Tidak dapat menyiapkan akses pemutaran. Muat ulang halaman dan masuk kembali jika diminta.");
      }
    } finally {
      if (requestId === ticketRequestId.current) setStreamLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canStream) return;
    ticketRetriesRef.current = 0;
    loadStreamTicket();
  }, [canStream, loadStreamTicket]);

  const handleVideoError = async () => {
    const el = videoRef.current;
    const code = el?.error?.code;
    if (metadataTimeoutRef.current) {
      clearTimeout(metadataTimeoutRef.current);
      metadataTimeoutRef.current = null;
    }

    // Surface HTTP errors immediately instead of repeatedly issuing new
    // tickets for a stream the server has already rejected.
    if (streamSrc) {
      const probed = await probeStreamError(streamSrc);
      if (probed) {
        setStreamError(probed);
        return;
      }
    }

    // A ticket does not expire. Only recover once from a transient media
    // network error, resuming at the current playback position.
    if (code === 2 && ticketRetriesRef.current < 1) {
      ticketRetriesRef.current += 1;
      void loadStreamTicket(el?.currentTime ?? 0);
      return;
    }
    setStreamError(describeVideoPlaybackError(code));
  };

  // Clear the metadata timeout as soon as the video has enough data to play.
  const handleLoadedMetadata = () => {
    if (metadataTimeoutRef.current) {
      clearTimeout(metadataTimeoutRef.current);
      metadataTimeoutRef.current = null;
    }
  };

  // Reset retry budget only after playback actually starts, not merely after
  // metadata arrives; otherwise repeated failures can retry indefinitely.
  const handleVideoPlaying = () => {
    ticketRetriesRef.current = 0;
  };

  // Start a metadata-load watchdog whenever a new stream URL is set. If the
  // video receives no data at all within the timeout, the stream is stalled —
  // probe for the real error and show it instead of an infinite spinner.
  useEffect(() => {
    if (!streamSrc) return;
    if (metadataTimeoutRef.current) clearTimeout(metadataTimeoutRef.current);
    metadataTimeoutRef.current = setTimeout(async () => {
      const el = videoRef.current;
      // readyState 0 (HAVE_NOTHING) → no data arrived at all → stalled.
      if (el && el.readyState === 0) {
        const probed = await probeStreamError(streamSrc);
        setStreamError(
          probed ?? "Video lambat dimuat dari server. Periksa koneksi dan coba lagi.",
        );
      }
    }, METADATA_TIMEOUT_MS);
    return () => {
      if (metadataTimeoutRef.current) clearTimeout(metadataTimeoutRef.current);
    };
  }, [streamSrc]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (error || !video) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-20 text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <p className="text-lg font-semibold mb-2">Video Tidak Ditemukan</p>
          <p className="text-muted-foreground mb-6">{error || "Video tidak ada atau sudah dihapus."}</p>
          <Link href="/telegram-videos">
            <Button>Kembali ke Katalog</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  // Premium lock screen.
  if (video.isPremium && video.hasAccess === false) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-20 text-center max-w-sm">
          <Lock className="h-16 w-16 text-orange-500 mx-auto mb-4" />
          <h1 className="text-lg font-bold mb-2">Premium Video</h1>
          <p className="text-muted-foreground mb-6">
            Video ini memerlukan langganan aktif untuk ditonton.
          </p>
          {user ? (
            <Link href="/topup">
              <Button>
                <Star className="h-4 w-4 mr-1" /> Berlangganan
              </Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button>Login untuk Berlangganan</Button>
            </Link>
          )}
        </div>
      </AppLayout>
    );
  }

  // Not authenticated — streaming requires auth.
  if (!user) {
    return (
      <AppLayout>
        <div className="container mx-auto px-4 py-20 text-center max-w-sm">
          <Lock className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-lg font-bold mb-2">Login Diperlukan</h1>
          <p className="text-muted-foreground mb-6">
            Login untuk menonton video Telegram.
          </p>
          <Link href="/login">
            <Button>Login</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-4 max-w-4xl">
        {/* Back */}
        <Link href="/telegram-videos">
          <Button variant="ghost" size="sm" className="mb-3">
            <ArrowLeft className="h-4 w-4 mr-1" /> Katalog
          </Button>
        </Link>

        {/* Video Player — authenticates via the ?ticket= URL */}
        <div className="bg-black rounded-lg overflow-hidden">
          {streamError ? (
            <div className="relative flex min-h-64 flex-col items-center justify-center gap-3 px-4 py-20 text-center">
              {thumbnailSrc && (
                <img
                  src={thumbnailSrc}
                  alt={video.title}
                  className="absolute inset-0 h-full w-full object-contain opacity-35"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              )}
              <div className="relative z-10 flex flex-col items-center gap-3">
                <AlertCircle className="h-10 w-10 text-red-500" />
                <p className="text-sm font-semibold text-white">Video gagal diputar.</p>
                <p className="text-xs text-white/80">{streamError}</p>
                <Button
                  size="sm" variant="secondary"
                  disabled={streamLoading}
                  onClick={() => {
                    ticketRetriesRef.current = 0;
                    void loadStreamTicket(videoRef.current?.currentTime ?? 0);
                  }}
                >
                  {streamLoading ? "Memuat..." : "Coba Lagi"}
                </Button>
              </div>
            </div>
          ) : streamLoading || !streamSrc ? (
            <div className="relative flex aspect-video items-center justify-center">
              {thumbnailSrc && (
                <img
                  src={thumbnailSrc}
                  alt={video.title}
                  className="absolute inset-0 h-full w-full object-contain opacity-35"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              )}
              <Loader2 className="relative z-10 h-8 w-8 animate-spin text-white/80" />
            </div>
          ) : (
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-[70vh]"
              src={streamSrc}
              poster={thumbnailSrc}
              controlsList="nodownload"
              onError={handleVideoError}
              onLoadedMetadata={handleLoadedMetadata}
              onPlaying={handleVideoPlaying}
            />
          )}
        </div>

        {/* Info */}
        <div className="mt-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-bold flex-1">{video.title}</h1>
            {video.isPremium && (
              <Badge variant="default" className="gap-1 shrink-0">
                <Lock className="h-3 w-3" /> Premium
              </Badge>
            )}
          </div>

          {video.sourceName && (
            <Badge variant="secondary" className="gap-1">
              <Film className="h-3 w-3" /> {video.sourceName}
            </Badge>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {video.duration != null && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {formatDuration(video.duration)}
              </span>
            )}
            {video.fileSize != null && (
              <span className="flex items-center gap-1">
                <HardDrive className="h-3.5 w-3.5" /> {formatFileSize(video.fileSize)}
              </span>
            )}
            {video.telegramDate && (
              <span>{new Date(video.telegramDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span>
            )}
            {video.mimeType && (
              <span className="text-xs">{video.mimeType}</span>
            )}
          </div>

          {/* Caption */}
          {video.caption && (
            <Card className="p-3">
              <p className="text-sm whitespace-pre-wrap">{video.caption}</p>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
