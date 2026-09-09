/**
 * Admin: AutoUP — Automatic video import from Telegram sources.
 *
 * Owner/admin page for managing AutoUP configs that automatically detect
 * new videos in Telegram sources via MTProto and import them into the
 * website catalog.
 *
 * Features:
 * - Dashboard stats (total, active, inactive, succeeded, failed)
 * - Add / edit / delete / toggle AutoUP configs
 * - Processing logs with status filter
 * - Source dropdown (only connected Telegram sources)
 */
import { useState, useEffect, useCallback } from "react";
import {
  Plus, RefreshCw, Trash2, Edit, Power, FileText,
  Loader2, Zap, CheckCircle2, XCircle, Film, Clock,
  AlertTriangle, X,
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
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { fmtRp, fmtDateTime, relativeTime } from "@/lib/admin-api";
import {
  autoupApi,
  type AutoUpConfig, type AutoUpStats, type AutoUpProcessingLog, type AutoUpSource,
} from "@/lib/autoup-api";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-600",
  processing: "bg-blue-500/10 text-blue-600",
  completed: "bg-green-500/10 text-green-600",
  failed: "bg-red-500/10 text-red-600",
  skipped: "bg-gray-500/10 text-gray-600",
};

export default function AdminAutoUpPage() {
  return (
    <AdminLayout>
      <AutoUpContent />
    </AdminLayout>
  );
}

function AutoUpContent() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<AutoUpConfig[]>([]);
  const [stats, setStats] = useState<AutoUpStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AutoUpConfig | null>(null);
  const [logsConfig, setLogsConfig] = useState<AutoUpConfig | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await autoupApi.list();
      setConfigs(data.configs);
      setStats(data.stats);
    } catch (err) {
      toast({ title: "Gagal memuat data", description: String(err.message || err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggle = async (config: AutoUpConfig) => {
    try {
      await autoupApi.toggle(config.id);
      toast({ title: config.enabled ? "AutoUP dinonaktifkan" : "AutoUP diaktifkan" });
      loadData();
    } catch (err) {
      toast({ title: "Gagal mengubah status", description: String(err.message || err), variant: "destructive" });
    }
  };

  const handleDelete = async (config: AutoUpConfig) => {
    if (!confirm(`Hapus AutoUP "${config.name}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await autoupApi.delete(config.id);
      toast({ title: "AutoUP berhasil dihapus" });
      loadData();
    } catch (err) {
      toast({ title: "Gagal menghapus", description: String(err.message || err), variant: "destructive" });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            AutoUP
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Import otomatis video dari Telegram ke katalog website
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setEditingConfig(null); setShowForm(true); }}>
            <Plus className="h-4 w-4" />
            Tambah AutoUP
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total AutoUP" value={stats?.total ?? 0} icon={<Zap className="h-4 w-4" />} />
        <StatCard label="Aktif" value={stats?.active ?? 0} icon={<Power className="h-4 w-4" />} color="text-green-600" />
        <StatCard label="Nonaktif" value={stats?.inactive ?? 0} icon={<Power className="h-4 w-4" />} color="text-gray-500" />
        <StatCard label="Video Berhasil" value={stats?.videosSucceeded ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} color="text-green-600" />
        <StatCard label="Video Gagal" value={stats?.videosFailed ?? 0} icon={<XCircle className="h-4 w-4" />} color="text-red-600" />
      </div>

      {/* Config List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : configs.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Film className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Belum ada konfigurasi AutoUP.</p>
          <p className="text-sm mt-1">Klik "Tambah AutoUP" untuk membuat konfigurasi pertama.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => (
            <ConfigCard
              key={config.id}
              config={config}
              onToggle={() => handleToggle(config)}
              onEdit={() => { setEditingConfig(config); setShowForm(true); }}
              onLogs={() => setLogsConfig(config)}
              onDelete={() => handleDelete(config)}
            />
          ))}
        </div>
      )}

      {/* Form Dialog */}
      {showForm && (
        <AutoUpFormDialog
          editingConfig={editingConfig}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadData(); }}
        />
      )}

      {/* Logs Dialog */}
      {logsConfig && (
        <AutoUpLogsDialog
          config={logsConfig}
          onClose={() => setLogsConfig(null)}
        />
      )}
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, color = "text-primary",
}: { label: string; value: number; icon: React.ReactNode; color?: string }) {
  return (
    <Card className="p-3 md:p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span className={color}>{icon}</span>
        {label}
      </div>
      <p className="text-xl md:text-2xl font-bold">{value}</p>
    </Card>
  );
}

// ── Config Card ───────────────────────────────────────────────────────────────

function ConfigCard({
  config, onToggle, onEdit, onLogs, onDelete,
}: {
  config: AutoUpConfig;
  onToggle: () => void;
  onEdit: () => void;
  onLogs: () => void;
  onDelete: () => void;
}) {
  const sourceDisconnected = config.source && config.source.status === "DISCONNECTED";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {/* Left: info */}
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{config.name}</h3>
            <Badge variant={config.enabled ? "default" : "secondary"}>
              {config.enabled ? "ACTIVE" : "INACTIVE"}
            </Badge>
            <Badge variant={config.isPremium ? "default" : "outline"}>
              {config.isPremium ? "PREMIUM" : "GRATIS"}
            </Badge>
            {config.isPremium && config.price != null && (
              <span className="text-sm font-medium text-muted-foreground">{fmtRp(config.price)}</span>
            )}
          </div>

          {/* Source info */}
          {config.source ? (
            <div className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">{config.source.name}</span>
              <span className="text-xs">·</span>
              <span className="text-xs">{config.source.type}</span>
              <span className="text-xs">·</span>
              <span className="text-xs font-mono">{config.source.chatId}</span>
              {sourceDisconnected && (
                <Badge variant="destructive" className="text-xs">Source Telegram tidak terhubung</Badge>
              )}
            </div>
          ) : (
            <div className="text-sm text-red-500">Source tidak ditemukan</div>
          )}

          {/* Description */}
          {config.description && (
            <p className="text-sm text-muted-foreground line-clamp-1">{config.description}</p>
          )}

          {/* Stats */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              {config.processedCount} berhasil
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="h-3 w-3 text-red-600" />
              {config.failedCount} gagal
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {config.lastProcessedAt ? relativeTime(config.lastProcessedAt) : "Belum diproses"}
            </span>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={onLogs}>
            <FileText className="h-3.5 w-3.5" />
            Logs
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggle}
            className={config.enabled ? "text-orange-600" : "text-green-600"}
          >
            <Power className="h-3.5 w-3.5" />
            {config.enabled ? "OFF" : "ON"}
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Form Dialog ────────────────────────────────────────────────────────────────

function AutoUpFormDialog({
  editingConfig, onClose, onSaved,
}: {
  editingConfig: AutoUpConfig | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [sources, setSources] = useState<AutoUpSource[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: editingConfig?.name ?? "",
    telegramSourceId: editingConfig?.telegramSourceId ?? "",
    isPremium: editingConfig?.isPremium ?? false,
    price: editingConfig?.price ?? 1000,
    description: editingConfig?.description ?? "",
    enabled: editingConfig?.enabled ?? true,
  });

  useEffect(() => {
    autoupApi.sources().then(setSources).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast({ title: "Nama wajib diisi", variant: "destructive" }); return; }
    if (!form.telegramSourceId) { toast({ title: "Sumber Telegram wajib dipilih", variant: "destructive" }); return; }

    try {
      setSaving(true);
      const body = {
        name: form.name.trim(),
        telegramSourceId: form.telegramSourceId,
        isPremium: form.isPremium,
        price: form.isPremium ? Number(form.price) : undefined,
        description: form.description.trim() || undefined,
        enabled: form.enabled,
      };
      if (editingConfig) {
        await autoupApi.update(editingConfig.id, body);
        toast({ title: "AutoUP berhasil diperbarui" });
      } else {
        await autoupApi.create(body);
        toast({ title: "AutoUP berhasil dibuat" });
      }
      onSaved();
    } catch (err) {
      toast({ title: "Gagal menyimpan", description: String((err as Error).message || err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingConfig ? "Edit AutoUP" : "Tambah AutoUP"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">Nama AutoUP</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Video Channel A"
            />
          </div>

          {/* Source */}
          <div className="space-y-1.5">
            <Label>Sumber Telegram</Label>
            <Select
              value={form.telegramSourceId}
              onValueChange={(v) => setForm({ ...form, telegramSourceId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih sumber..." />
              </SelectTrigger>
              <SelectContent>
                {sources.length === 0 && (
                  <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                    Tidak ada source yang terhubung
                  </div>
                )}
                {sources.map((src) => (
                  <SelectItem key={src.id} value={src.id}>
                    <div className="flex items-center gap-2">
                      <span>{src.name}</span>
                      <span className="text-xs text-muted-foreground">· {src.type}</span>
                      {src.status === "DISCONNECTED" && (
                        <span className="text-xs text-red-500">· tidak terhubung</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sources.length === 0 && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Tidak ada source Telegram yang aktif. Tambahkan source terlebih dahulu.
              </p>
            )}
          </div>

          {/* Video Type */}
          <div className="space-y-1.5">
            <Label>Tipe Video</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={!form.isPremium ? "default" : "outline"}
                size="sm"
                onClick={() => setForm({ ...form, isPremium: false })}
                className="flex-1"
              >
                GRATIS
              </Button>
              <Button
                type="button"
                variant={form.isPremium ? "default" : "outline"}
                size="sm"
                onClick={() => setForm({ ...form, isPremium: true })}
                className="flex-1"
              >
                PREMIUM
              </Button>
            </div>
          </div>

          {/* Price (if premium) */}
          {form.isPremium && (
            <div className="space-y-1.5">
              <Label>Nominal</Label>
              <Select
                value={String(form.price)}
                onValueChange={(v) => setForm({ ...form, price: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1000">Rp1.000</SelectItem>
                  <SelectItem value="5000">Rp5.000</SelectItem>
                  <SelectItem value="10000">Rp10.000</SelectItem>
                  <SelectItem value="20000">Rp20.000</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Deskripsi (opsional)</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Video pilihan terbaru yang diperbarui secara otomatis."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Jika kosong, video akan memiliki deskripsi kosong/null.
            </p>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Status</Label>
            <Switch
              id="enabled"
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {editingConfig ? "Simpan" : "Buat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Logs Dialog ───────────────────────────────────────────────────────────────

function AutoUpLogsDialog({
  config, onClose,
}: {
  config: AutoUpConfig;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AutoUpProcessingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await autoupApi.logs(config.id, filter === "ALL" ? undefined : filter);
      setLogs(data);
    } catch (err) {
      toast({ title: "Gagal memuat log", description: String((err as Error).message || err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [config.id, filter, toast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Log AutoUP: {config.name}
          </DialogTitle>
        </DialogHeader>

        {/* Filter */}
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="w-full justify-start flex-wrap">
            <TabsTrigger value="ALL">ALL</TabsTrigger>
            <TabsTrigger value="completed">COMPLETED</TabsTrigger>
            <TabsTrigger value="failed">FAILED</TabsTrigger>
            <TabsTrigger value="skipped">SKIPPED</TabsTrigger>
            <TabsTrigger value="processing">PROCESSING</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Logs */}
        <ScrollArea className="h-[50vh] w-full">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Tidak ada log untuk filter ini.
            </div>
          ) : (
            <div className="space-y-2 pr-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                >
                  {/* Thumbnail */}
                  {log.thumbnail ? (
                    <img
                      src={log.thumbnail}
                      alt=""
                      className="h-12 w-16 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-16 rounded bg-muted flex items-center justify-center shrink-0">
                      <Film className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{log.title || "Video Baru"}</span>
                      <Badge className={`text-xs ${STATUS_COLORS[log.status] ?? ""}`}>
                        {STATUS_LABELS[log.status] ?? log.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>Msg ID: {log.telegramMessageId}</span>
                      <span>·</span>
                      <span>{fmtDateTime(log.processedAt || log.createdAt)}</span>
                    </div>
                    {log.errorMessage && (
                      <p className="text-xs text-red-500 truncate">{log.errorMessage}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4" />
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
