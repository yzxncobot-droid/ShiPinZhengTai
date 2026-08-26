import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle, Clock,
  Database, Cloud, Server, Wifi, HardDrive, FolderOpen,
} from "lucide-react";

type CheckStatus = "ok" | "healthy" | "error" | "bucket_missing" | "unavailable" | "unknown" | "checking";

function StatusIcon({ status }: { status: CheckStatus | string }) {
  if (status === "ok" || status === "healthy") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "error" || status === "bucket_missing") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (status === "unavailable") return <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function StatusLabel({ status, error }: { status: string; error?: string | null }) {
  if (status === "ok" || status === "healthy") return <span className="text-green-600 font-semibold text-sm">CONNECTED</span>;
  if (status === "error") return <span className="text-red-600 font-semibold text-sm">ERROR{error ? `: ${error}` : ""}</span>;
  if (status === "bucket_missing") return <span className="text-red-600 font-semibold text-sm">BUCKET NOT FOUND</span>;
  if (status === "unavailable") return <span className="text-yellow-600 font-semibold text-sm">UNAVAILABLE</span>;
  return <span className="text-muted-foreground font-semibold text-sm">UNKNOWN</span>;
}

function CheckRow({
  icon: Icon,
  label,
  status,
  detail,
  error,
  loading,
}: {
  icon: any;
  label: string;
  status: string;
  detail?: string;
  error?: string | null;
  loading?: boolean;
}) {
  const ok = status === "ok" || status === "healthy";
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${ok ? "border-green-200 bg-green-50 dark:bg-green-950/20" : status === "error" || status === "bucket_missing" ? "border-red-200 bg-red-50 dark:bg-red-950/20" : "border-border bg-muted/30"}`}>
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${ok ? "bg-green-100 dark:bg-green-900/40" : status === "error" || status === "bucket_missing" ? "bg-red-100 dark:bg-red-900/40" : "bg-muted"}`}>
        <Icon className={`h-4 w-4 ${ok ? "text-green-600" : status === "error" || status === "bucket_missing" ? "text-red-600" : "text-muted-foreground"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {loading ? <Skeleton className="h-3 w-24 mt-1" /> : (
          detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>
        )}
      </div>
      {loading ? <Skeleton className="h-5 w-20" /> : <StatusIcon status={status} />}
      {!loading && <StatusLabel status={status} error={error} />}
    </div>
  );
}

export default function AdminSystemCheck() {
  const { data, isLoading, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["system-check"],
    queryFn: () => adminFetch("/system/status"),
    refetchInterval: 60000,
  });

  const s = data as any;
  const folders = s?.supabase?.folders ?? {};
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID") : "—";

  const FOLDER_DEFS = [
    { key: "videos",           label: "yzx/videos",            desc: "Upload file video" },
    { key: "thumbnails",       label: "yzx/thumnails",         desc: "Upload thumbnail video" },
    { key: "payments",         label: "yzx/payments",          desc: "Bukti transfer pembayaran" },
    { key: "bundles",          label: "yzx/bundles",           desc: "Video bundle" },
    { key: "bundleThumbnails", label: "yzx/bundle-thumbnails", desc: "Thumbnail bundle" },
  ];

  const allBucketsOk = FOLDER_DEFS.every((f) => folders[f.key]?.status === "ok");

  return (
    <ProtectedRoute allowedRoles={["owner", "admin"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-3xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">System Check</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Terakhir: {lastUpdated}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Core Services */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" />
                Layanan Utama
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <CheckRow
                icon={Database}
                label="Neon PostgreSQL"
                status={s?.database?.status ?? "unknown"}
                detail={s?.database?.latencyMs != null ? `Latensi: ${s.database.latencyMs}ms` : s?.database?.error}
                error={s?.database?.error}
                loading={isLoading}
              />
              <CheckRow
                icon={Wifi}
                label="Cloudflare KV"
                status={s?.redis?.status ?? "unknown"}
                detail={s?.redis?.latencyMs != null ? `Latensi: ${s.redis.latencyMs}ms` : s?.redis?.error}
                error={s?.redis?.error}
                loading={isLoading}
              />
              <CheckRow
                icon={Cloud}
                label={`Supabase Storage (bucket: ${s?.supabase?.bucket ?? "yzx"})`}
                status={s?.supabase?.status ?? "unknown"}
                detail={s?.supabase?.bucketExists ? "Bucket ditemukan" : "Bucket tidak ditemukan"}
                error={s?.supabase?.error}
                loading={isLoading}
              />
            </CardContent>
          </Card>

          {/* Bucket Folders */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Supabase Storage Buckets
                </CardTitle>
                {!isLoading && (
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${allBucketsOk ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {allBucketsOk ? "Semua OK" : "Ada Error"}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {FOLDER_DEFS.map((f) => (
                <CheckRow
                  key={f.key}
                  icon={HardDrive}
                  label={f.label}
                  status={folders[f.key]?.status ?? "unknown"}
                  detail={f.desc}
                  error={folders[f.key]?.error}
                  loading={isLoading}
                />
              ))}
            </CardContent>
          </Card>

          {/* Environment */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Environment Variables
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "NEON_DATABASE_URL", key: "neonUrlSet" },
                { label: "SUPABASE_URL", key: "supabaseKeySet" },
                { label: "SESSION_SECRET", key: "sessionSecretSet" },
                { label: "JWT_SECRET", key: "jwtSecretSet" },
                { label: "UPSTASH_REDIS_REST_URL", key: "upstashUrlSet" },
              ].map(({ label, key }) => {
                const isSet = s?.environment?.[key];
                return (
                  <div key={key} className="flex items-center justify-between py-1.5 border-b last:border-0">
                    <span className="text-sm font-mono text-muted-foreground">{label}</span>
                    {isLoading ? <Skeleton className="h-4 w-20" /> : (
                      <span className={`text-xs font-bold flex items-center gap-1 ${isSet ? "text-green-600" : "text-red-500"}`}>
                        {isSet ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                        {isSet ? "SET" : "NOT SET"}
                      </span>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
