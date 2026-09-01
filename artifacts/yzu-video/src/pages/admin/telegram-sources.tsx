/**
 * Admin: Telegram Video Storage
 *
 * Isolated admin page for managing Telegram channels/groups as video sources.
 * Lists all sources with connection status, video count, and sync controls.
 * Add / edit / delete / test connection / sync now.
 *
 * Does NOT touch any existing admin page or feature.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Plus, RefreshCw, Trash2, Settings, Wifi, WifiOff, AlertTriangle,
  Loader2, Send, X, CheckCircle2, Activity, Database, Film, Server,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  tgApi, formatFileSize,
  type TelegramSource, type TelegramHealth,
} from "@/lib/telegram-api";
import { fmtDateTime, relativeTime } from "@/lib/admin-api";

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: React.ElementType; label: string }> = {
    CONNECTED: { color: "bg-green-500", icon: CheckCircle2, label: "Connected" },
    DISCONNECTED: { color: "bg-red-500", icon: WifiOff, label: "Disconnected" },
    ERROR: { color: "bg-orange-500", icon: AlertTriangle, label: "Error" },
    SYNCING: { color: "bg-yellow-500", icon: Loader2, label: "Syncing" },
    UNKNOWN: { color: "bg-gray-400", icon: Activity, label: "Unknown" },
  };
  const cfg = map[status] ?? map.UNKNOWN;
  const Icon = cfg.icon;
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span className={`h-2 w-2 rounded-full ${cfg.color}`} />
      <Icon className={`h-3 w-3 ${status === "SYNCING" ? "animate-spin" : ""}`} />
      {cfg.label}
    </Badge>
  );
}

// ── Add/Edit Source Modal ────────────────────────────────────────────────────
function SourceModal({
  open, onClose, onSaved, source,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  source?: TelegramSource | null;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", chatId: "", type: "CHANNEL", description: "", enabled: true,
  });

  useEffect(() => {
    if (source) {
      setForm({
        name: source.name, chatId: source.chatId, type: source.type,
        description: source.description || "", enabled: source.enabled,
      });
    } else {
      setForm({ name: "", chatId: "", type: "CHANNEL", description: "", enabled: true });
    }
  }, [source, open]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.chatId.trim()) {
      toast({ title: "Error", description: "Name and Chat ID are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (source) {
        await tgApi.updateSource(source.id, form);
        toast({ title: "Source updated" });
      } else {
        await tgApi.createSource(form);
        toast({ title: "Source created", description: "Testing connection..." });
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{source ? "Edit Telegram Source" : "Add Telegram Source"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Source Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. FUN+ Kids"
            />
          </div>
          <div>
            <Label>Telegram Chat ID</Label>
            <Input
              value={form.chatId}
              onChange={(e) => setForm({ ...form, chatId: e.target.value })}
              placeholder="e.g. -100123456789"
              disabled={!!source}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use the numeric ID from Telegram. Channels start with -100…
            </p>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CHANNEL">Channel</SelectItem>
                <SelectItem value="GROUP">Group</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description"
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
            <Label>Enabled</Label>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {source ? "Save" : "Add Source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Connection Test Result Modal ─────────────────────────────────────────────
function TestResultModal({
  result, open, onClose,
}: {
  result: { success: boolean; title?: string; type?: string; errorMessage?: string } | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!result) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {result.success ? (
              <><CheckCircle2 className="h-5 w-5 text-green-500" /> Connection Successful</>
            ) : (
              <><X className="h-5 w-5 text-red-500" /> Connection Failed</>
            )}
          </DialogTitle>
        </DialogHeader>
        {result.success ? (
          <div className="space-y-2 py-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Title</span><span className="font-medium">{result.title}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium">{result.type}</span></div>
          </div>
        ) : (
          <div className="py-2">
            <p className="text-sm text-muted-foreground">{result.errorMessage || "Bot/account cannot access this Telegram source."}</p>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild><Button>Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sync Result Modal ────────────────────────────────────────────────────────
function SyncResultModal({
  result, open, onClose,
}: {
  result: any | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!result) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            {result.message || "Sync completed"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2 text-sm">
          {result.newVideos !== undefined && (
            <div className="flex justify-between"><span className="text-muted-foreground">New videos</span><span className="font-medium text-green-600">{result.newVideos}</span></div>
          )}
          {result.updatedVideos !== undefined && (
            <div className="flex justify-between"><span className="text-muted-foreground">Updated</span><span className="font-medium">{result.updatedVideos}</span></div>
          )}
          {result.skippedVideos !== undefined && (
            <div className="flex justify-between"><span className="text-muted-foreground">Skipped</span><span className="font-medium">{result.skippedVideos}</span></div>
          )}
          {result.errorsCount !== undefined && (
            <div className="flex justify-between"><span className="text-muted-foreground">Errors</span><span className="font-medium">{result.errorsCount}</span></div>
          )}
          {result.totalVideos !== undefined && (
            <div className="flex justify-between border-t pt-2 mt-2"><span className="text-muted-foreground">Total videos</span><span className="font-bold">{result.totalVideos}</span></div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button>Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Source Card ──────────────────────────────────────────────────────────────
function SourceCard({
  source, onEdit, onRefresh,
}: {
  source: TelegramSource;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await tgApi.testConnection(source.id);
      setTestResult(result);
      setTestOpen(true);
      onRefresh();
    } catch (err: any) {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await tgApi.syncSource(source.id, false);
      if (result.message === "Sync started") {
        toast({ title: "Sync started", description: "Check back in a moment for results." });
        // Poll for completion.
        setTimeout(() => onRefresh(), 3000);
      } else {
        setSyncResult(result);
        setSyncOpen(true);
        onRefresh();
      }
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${source.name}"? All indexed videos will be removed.`)) return;
    setDeleting(true);
    try {
      await tgApi.deleteSource(source.id);
      toast({ title: "Source deleted" });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{source.name}</h3>
              <StatusBadge status={source.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {source.chatId} · {source.type}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={handleSync} disabled={syncing || source.status === "SYNCING"}>
              {syncing || source.status === "SYNCING" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
            </Button>
          </div>
        </div>

        {source.errorMessage && (
          <p className="text-xs text-orange-500 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{source.errorMessage}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span><Film className="h-3 w-3 inline mr-1" />{source.videoCount} videos</span>
          <span>Last sync: {relativeTime(source.lastSyncAt)}</span>
          <span>Checked: {relativeTime(source.lastConnectionCheck)}</span>
        </div>
      </Card>

      <TestResultModal result={testResult} open={testOpen} onClose={() => setTestOpen(false)} />
      <SyncResultModal result={syncResult} open={syncOpen} onClose={() => setSyncOpen(false)} />
    </>
  );
}

// ── Summary Cards ────────────────────────────────────────────────────────────
function SummaryCards({ health }: { health: TelegramHealth | null }) {
  const cards = [
    { label: "Telegram Sources", value: health?.sources.total ?? 0, icon: Database, color: "text-blue-500" },
    { label: "Connected", value: health?.sources.connected ?? 0, icon: Wifi, color: "text-green-500" },
    { label: "Disconnected", value: (health?.sources.disconnected ?? 0) + (health?.sources.error ?? 0), icon: WifiOff, color: "text-red-500" },
    { label: "Total Videos", value: health?.totalVideos ?? 0, icon: Film, color: "text-purple-500" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="p-3">
          <div className="flex items-center gap-2">
            <c.icon className={`h-4 w-4 ${c.color}`} />
            <span className="text-xs text-muted-foreground">{c.label}</span>
          </div>
          <p className="text-2xl font-bold mt-1">{c.value}</p>
        </Card>
      ))}
    </div>
  );
}

// ── Health Check ─────────────────────────────────────────────────────────────
function HealthCheck({ health }: { health: TelegramHealth | null }) {
  if (!health) return null;
  const items = [
    { label: "Telegram API", status: health.components.telegramApi, icon: Send },
    { label: "Database", status: health.components.database, icon: Database },
    { label: "Indexer", status: health.components.indexer, icon: RefreshCw },
    { label: "Streaming Engine", status: health.components.streaming, icon: Server },
  ];
  return (
    <Card className="p-3">
      <div className="flex flex-wrap gap-4">
      {items.map((item) => {
        const ok = item.status === "ok";
        return (
          <div key={item.label} className="flex items-center gap-1.5 text-sm">
            <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{item.label}</span>
            <span className={`h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-gray-400"}`} />
            <span className={ok ? "text-green-600 text-xs font-medium" : "text-muted-foreground text-xs"}>
              {ok ? "🟢" : "⚪"}
            </span>
          </div>
        );
      })}
      </div>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function AdminTelegramSources() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sources, setSources] = useState<TelegramSource[]>([]);
  const [health, setHealth] = useState<TelegramHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editSource, setEditSource] = useState<TelegramSource | null>(null);

  const load = useCallback(async () => {
    try {
      const [srcs, hlth] = await Promise.all([
        tgApi.listSources(),
        tgApi.getHealth().catch(() => null),
      ]);
      setSources(srcs);
      setHealth(hlth);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = () => { setEditSource(null); setModalOpen(true); };
  const handleEdit = (s: TelegramSource) => { setEditSource(s); setModalOpen(true); };

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Telegram Video Storage</h1>
            <p className="text-sm text-muted-foreground">Manage Telegram channels/groups as video sources</p>
          </div>
          <Button onClick={handleAdd} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Source
          </Button>
        </div>

        {/* Summary */}
        <SummaryCards health={health} />

        {/* Health Check */}
        <HealthCheck health={health} />

        {/* Credentials Warning */}
        {health && health.components.telegramApi === "not_configured" && (
          <Card className="p-4 border-orange-500/50 bg-orange-500/5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-orange-600">Telegram credentials not configured</p>
                <p className="text-muted-foreground mt-1">
                  Set <code className="text-xs bg-muted px-1 rounded">TELEGRAM_BOT_TOKEN</code>,{" "}
                  <code className="text-xs bg-muted px-1 rounded">TELEGRAM_API_ID</code>, and{" "}
                  <code className="text-xs bg-muted px-1 rounded">TELEGRAM_API_HASH</code> environment variables
                  to enable Telegram video indexing and streaming.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Sources List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sources.length === 0 ? (
          <Card className="p-8 text-center">
            <Database className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No Telegram sources yet. Click "Add Source" to get started.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} onEdit={() => handleEdit(s)} onRefresh={load} />
            ))}
          </div>
        )}
      </div>

      <SourceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
        source={editSource}
      />
    </AdminLayout>
  );
}
