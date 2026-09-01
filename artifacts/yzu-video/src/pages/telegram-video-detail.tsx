/**
 * Telegram Video Detail & Player page.
 *
 * Shows a single Telegram video with a native HTML5 <video> player that
 * streams from /api/telegram-videos/:id/stream. The browser automatically
 * sends Range requests for seeking — the backend handles 206 Partial Content.
 *
 * If the video is premium and the user lacks access, a lock screen is shown.
 */
import { useEffect, useState, useRef } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  ArrowLeft, Film, Lock, HardDrive, Clock, Loader2, AlertCircle, Star,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { tgApi, formatFileSize, formatDuration, type TelegramVideo } from "@/lib/telegram-api";
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

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    tgApi.getVideo(id)
      .then((v) => { setVideo(v); setError(null); })
      .catch((err) => setError(err.message || "Failed to load video"))
      .finally(() => setLoading(false));
  }, [id]);

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

  const streamUrl = tgApi.streamUrl(id);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-4 max-w-4xl">
        {/* Back */}
        <Link href="/telegram-videos">
          <Button variant="ghost" size="sm" className="mb-3">
            <ArrowLeft className="h-4 w-4 mr-1" /> Katalog
          </Button>
        </Link>

        {/* Video Player */}
        <div className="bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            controls
            className="w-full max-h-[70vh]"
            src={streamUrl}
            controlsList="nodownload"
          />
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
