/**
 * Admin: Telegram Video Import Guide
 *
 * Shows instructions for importing old videos via forward to the bot.
 * Also shows the current import queue status.
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Bot, Inbox, ArrowRight, Film, Send, CheckCircle2, Loader2, AlertTriangle,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tgApi, type BotInfo } from "@/lib/telegram-api";

export default function AdminTelegramImport() {
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [queueStats, setQueueStats] = useState({ pending: 0, processing: 0, completed: 0, failed: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [info, stats] = await Promise.all([
        tgApi.getBotInfo().catch(() => null),
        tgApi.getQueueStats().catch(() => null),
      ]);
      setBotInfo(info);
      if (stats) setQueueStats(stats);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const steps = [
    {
      icon: "1️⃣",
      title: "Buka Telegram",
      desc: "Buka Telegram Group atau Channel yang berisi video lama.",
    },
    {
      icon: "2️⃣",
      title: "Forward Video ke Bot",
      desc: botInfo?.username
        ? `Forward video ke @${botInfo.username}`
        : "Forward video ke bot Telegram Anda",
    },
    {
      icon: "3️⃣",
      title: "Bot Memproses Otomatis",
      desc: "Bot akan membaca metadata video dan memasukkannya ke queue.",
    },
    {
      icon: "4️⃣",
      title: "Video Muncul di Website",
      desc: "Video akan otomatis muncul di katalog Telegram Videos.",
    },
  ];

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Telegram Video Import</h1>
            <p className="text-sm text-muted-foreground">Import video lama via forward ke bot</p>
          </div>
          <Link href="/admin/telegram-sources">
            <Button variant="outline" size="sm">← Kembali</Button>
          </Link>
        </div>

        {/* Bot Status */}
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Bot className="h-5 w-5 text-blue-500" />
            </div>
            <div className="flex-1">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : botInfo?.configured ? (
                <>
                  <p className="font-medium text-sm">Bot Connected</p>
                  <p className="text-xs text-muted-foreground">
                    {botInfo.username ? `@${botInfo.username}` : "Bot token configured"}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-sm text-orange-600">Bot Not Configured</p>
                  <p className="text-xs text-muted-foreground">
                    Set TELEGRAM_BOT_TOKEN environment variable
                  </p>
                </>
              )}
            </div>
          </div>
        </Card>

        {/* Instructions */}
        <Card className="p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Send className="h-4 w-4" /> Cara Import Video Lama
          </h2>
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-2xl shrink-0">{step.icon}</span>
                <div className="flex-1">
                  <p className="font-medium text-sm">{step.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{step.desc}</p>
                </div>
                {i < steps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90 mt-1" />
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Queue Status */}
        <Card className="p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Import Queue Status
          </h2>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{queueStats.pending}</p>
              <p className="text-xs text-muted-foreground">⏳ Pending</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{queueStats.processing}</p>
              <p className="text-xs text-muted-foreground">🔄 Processing</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{queueStats.completed}</p>
              <p className="text-xs text-muted-foreground">✅ Completed</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold">{queueStats.failed}</p>
              <p className="text-xs text-muted-foreground">❌ Failed</p>
            </div>
          </div>
          {queueStats.pending > 0 || queueStats.processing > 0 ? (
            <div className="flex items-center gap-2 text-sm text-yellow-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing videos... Check back in a moment.
            </div>
          ) : queueStats.failed > 0 ? (
            <div className="flex items-center gap-2 text-sm text-red-500">
              <AlertTriangle className="h-4 w-4" />
              {queueStats.failed} failed imports. Go to Telegram Storage to retry.
            </div>
          ) : queueStats.completed > 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {queueStats.completed} videos imported successfully.
            </div>
          ) : null}
        </Card>

        {/* Link to catalog */}
        <Link href="/telegram-videos">
          <Card className="p-4 hover:bg-muted/50 cursor-pointer transition-colors">
            <div className="flex items-center gap-3">
              <Film className="h-5 w-5 text-purple-500" />
              <div className="flex-1">
                <p className="font-medium text-sm">Lihat Katalog Telegram Videos</p>
                <p className="text-xs text-muted-foreground">Browse all imported videos</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Card>
        </Link>

        {/* Info */}
        <Card className="p-4 bg-blue-500/5 border-blue-500/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-blue-600 mb-1">Catatan</p>
              <ul className="space-y-1 text-xs">
                <li>• Tidak ada batas jumlah video yang bisa di-import</li>
                <li>• Video duplikat otomatis di-skip (unique: source + message ID)</li>
                <li>• Video binary tetap di Telegram — website hanya menyimpan metadata</li>
                <li>• Bot API membatasi download file hingga 20 MB (batasan eksternal Telegram)</li>
                <li>• Anda bisa forward banyak video sekaligus — queue akan memproses semuanya</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
