import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Server, Database, Cloud, Cpu, HardDrive, CheckCircle2, XCircle, AlertCircle, Clock } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  if (status === "healthy") return <Badge className="bg-green-500/10 text-green-600 border border-green-200 gap-1"><CheckCircle2 className="h-3 w-3" />Sehat</Badge>;
  if (status === "error") return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Error</Badge>;
  return <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" />{status}</Badge>;
}

function InfoRow({ label, value, mono = false }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${mono ? "font-mono" : ""}`}>{String(value ?? "—")}</span>
    </div>
  );
}

export default function AdminSystem() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => adminFetch("/system/status"),
    refetchInterval: 30000,
  });

  const { data: storage } = useQuery({
    queryKey: ["system-storage"],
    queryFn: () => adminFetch("/system/storage"),
    refetchInterval: 60000,
  });

  const s = data as any;
  const stor = storage as any;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID") : "—";

  return (
    <ProtectedRoute allowedRoles={["owner", "admin"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Status Sistem</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />Terakhir diperbarui: {lastUpdated}
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />Refresh
            </Button>
          </div>

          {/* Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                label: "Database (PostgreSQL)",
                icon: Database,
                status: s?.database?.status,
                detail: s?.database?.latencyMs != null ? `${s.database.latencyMs}ms` : s?.database?.error,
                color: "text-blue-500 bg-blue-500/10",
              },
              {
                label: "Supabase Storage",
                icon: Cloud,
                status: s?.supabase?.status,
                detail: s?.supabase?.status === "healthy"
                  ? `Bucket: ${s?.supabase?.bucket}${s?.supabase?.bucketExists ? " ✓" : " ✗"}`
                  : s?.supabase?.error,
                color: "text-green-500 bg-green-500/10",
              },
              {
                label: "Server (Node.js)",
                icon: Server,
                status: s ? "healthy" : isLoading ? "checking" : "unknown",
                detail: s?.uptime?.formatted ? `Uptime: ${s.uptime.formatted}` : "—",
                color: "text-purple-500 bg-purple-500/10",
              },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}>
                      <item.icon className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">{item.label}</p>
                  </div>
                  {isLoading ? <Skeleton className="h-6 w-24" /> : (
                    <>
                      <StatusBadge status={item.status ?? "unknown"} />
                      {item.detail && <p className="text-xs text-muted-foreground mt-1.5">{item.detail}</p>}
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Server Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" />Informasi Server</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full mb-1" />) : (
                  <>
                    <InfoRow label="Node.js Version" value={s?.environment?.nodeVersion} mono />
                    <InfoRow label="Environment" value={s?.environment?.nodeEnv} />
                    <InfoRow label="Uptime" value={s?.uptime?.formatted} />
                    <InfoRow label="Heap Used" value={s?.memory?.heapUsedMB ? `${s.memory.heapUsedMB} MB` : "—"} />
                    <InfoRow label="Heap Total" value={s?.memory?.heapTotalMB ? `${s.memory.heapTotalMB} MB` : "—"} />
                    <InfoRow label="RSS Memory" value={s?.memory?.rssMB ? `${s.memory.rssMB} MB` : "—"} />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Environment Variables */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><HardDrive className="h-4 w-4" />Environment & Storage</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full mb-1" />) : (
                  <>
                    <InfoRow label="DATABASE_URL" value={s?.environment?.databaseUrlSet ? "✅ Tersedia" : "❌ Tidak Ada"} />
                    <InfoRow label="SESSION_SECRET" value={s?.environment?.sessionSecretSet ? "✅ Tersedia" : "❌ Tidak Ada"} />
                    <InfoRow label="Supabase URL" value={s?.environment?.supabaseUrl} mono />
                    <InfoRow label="Bucket Payments" value={s?.supabase?.bucketExists ? "✅ Ditemukan" : "❌ Tidak Ditemukan"} />
                    <InfoRow label="Bucket Public" value={s?.supabase?.bucketPublic != null ? (s.supabase.bucketPublic ? "Ya" : "Tidak") : "—"} />
                    {stor && (
                      <>
                        <InfoRow label="Total File Upload" value={`${stor.totalFiles} file`} />
                        <InfoRow label="Ukuran Storage" value={`${stor.totalSizeMB ?? 0} MB`} />
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* DB Error details */}
          {s?.database?.status === "error" && (
            <Card className="border-destructive/30">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-destructive mb-1">Database Error</p>
                <pre className="text-xs bg-muted/60 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{s.database.error}</pre>
              </CardContent>
            </Card>
          )}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
