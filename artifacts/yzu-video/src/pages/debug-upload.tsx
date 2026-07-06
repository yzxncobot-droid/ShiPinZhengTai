import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, RefreshCw, UploadCloud, AlertCircle, CheckCircle2, XCircle, Bug } from "lucide-react";
import { useState } from "react";

interface DebugResult {
  supabaseUrl: string;
  serviceKeyPresent: boolean;
  bucket: string;
  bucketStatus: string | null;
  bucketPublic: boolean | null;
  listError: { message: string; statusCode?: number } | null;
  uploadTestResult: "SUCCESS" | "FAILED" | "EXCEPTION" | null;
  uploadTestUrl?: string;
  uploadTestError: { message: string; statusCode?: number } | null;
  timestamp: string;
}

interface UploadTestResult {
  status: "idle" | "uploading" | "success" | "error";
  progress: number;
  url?: string;
  error?: Record<string, any>;
  rawResponse?: string;
}

export default function DebugUploadPage() {
  const { token } = useAuth();
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [uploadTest, setUploadTest] = useState<UploadTestResult>({ status: "idle", progress: 0 });

  const fetchDebug = async () => {
    setDebugLoading(true);
    setDebugError(null);
    try {
      const res = await fetch("/api/upload/debug", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setDebugResult(data);
      } else {
        setDebugError(`HTTP ${res.status}: ${data?.message ?? JSON.stringify(data)}`);
      }
    } catch (e: any) {
      setDebugError(`Koneksi gagal: ${e?.message ?? String(e)}`);
    } finally {
      setDebugLoading(false);
    }
  };

  const handleTestUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadTest({ status: "uploading", progress: 0 });
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (ev) => {
      if (ev.lengthComputable) {
        setUploadTest((prev) => ({ ...prev, progress: Math.round((ev.loaded / ev.total) * 100) }));
      }
    });

    xhr.addEventListener("load", () => {
      const rawResponse = xhr.responseText;
      try {
        const data = JSON.parse(rawResponse);
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadTest({ status: "success", progress: 100, url: data.url, rawResponse });
        } else {
          setUploadTest({ status: "error", progress: 0, error: data, rawResponse });
        }
      } catch {
        setUploadTest({ status: "error", progress: 0, error: { parseError: "Invalid JSON" }, rawResponse });
      }
    });

    xhr.addEventListener("error", () => {
      setUploadTest({
        status: "error",
        progress: 0,
        error: { code: "NETWORK_ERROR", message: "Network error" },
        rawResponse: undefined,
      });
    });

    xhr.open("POST", "/api/upload/payment-proof");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  };

  const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
    <Badge variant={ok ? "default" : "destructive"} className="gap-1">
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </Badge>
  );

  return (
    <ProtectedRoute requiredRole="admin">
      <AppLayout>
        <div className="container mx-auto px-4 md:px-6 py-10 max-w-3xl space-y-8">

          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Bug className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Debug Upload</h1>
              <p className="text-sm text-muted-foreground">Status koneksi Supabase Storage & pengujian upload</p>
            </div>
          </div>

          {/* Section 1: Supabase Connection */}
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">1. Status Koneksi Supabase</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchDebug}
                disabled={debugLoading}
                className="gap-2"
              >
                {debugLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Cek Status
              </Button>
            </div>

            {debugError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="font-mono text-xs break-all">{debugError}</AlertDescription>
              </Alert>
            )}

            {debugResult ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/40 rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">Supabase URL</p>
                    <p className="text-sm font-mono break-all">{debugResult.supabaseUrl}</p>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">Service Key</p>
                    <StatusBadge ok={debugResult.serviceKeyPresent} label={debugResult.serviceKeyPresent ? "Tersedia" : "Tidak Ada"} />
                  </div>
                  <div className="bg-muted/40 rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">Nama Bucket</p>
                    <p className="text-sm font-mono font-bold">{debugResult.bucket}</p>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">Status Bucket</p>
                    <StatusBadge
                      ok={debugResult.bucketStatus === "found"}
                      label={debugResult.bucketStatus ?? "—"}
                    />
                    {debugResult.bucketPublic !== null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Public: {debugResult.bucketPublic ? "Ya" : "Tidak"}
                      </p>
                    )}
                  </div>
                </div>

                {debugResult.listError && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4">
                    <p className="text-xs font-semibold text-destructive mb-1">Error List Bucket</p>
                    <p className="text-xs font-mono text-destructive break-all">{debugResult.listError.message}</p>
                    {debugResult.listError.statusCode && (
                      <p className="text-xs text-muted-foreground mt-1">Status: {debugResult.listError.statusCode}</p>
                    )}
                  </div>
                )}

                <div className={`rounded-xl p-4 border ${debugResult.uploadTestResult === "SUCCESS" ? "bg-green-500/10 border-green-500/20" : "bg-destructive/10 border-destructive/20"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {debugResult.uploadTestResult === "SUCCESS" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <p className="text-sm font-semibold">
                      Test Upload: {debugResult.uploadTestResult ?? "—"}
                    </p>
                  </div>
                  {debugResult.uploadTestResult === "SUCCESS" && debugResult.uploadTestUrl && (
                    <p className="text-xs font-mono text-muted-foreground break-all">{debugResult.uploadTestUrl}</p>
                  )}
                  {debugResult.uploadTestError && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-xs font-mono text-destructive break-all">{debugResult.uploadTestError.message}</p>
                      {debugResult.uploadTestError.statusCode && (
                        <p className="text-xs text-muted-foreground">Status: {debugResult.uploadTestError.statusCode}</p>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">Diperiksa: {new Date(debugResult.timestamp).toLocaleString("id-ID")}</p>
              </div>
            ) : (
              !debugLoading && (
                <p className="text-sm text-muted-foreground">Klik "Cek Status" untuk memeriksa koneksi Supabase.</p>
              )
            )}
          </div>

          {/* Section 2: Manual Upload Test */}
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">2. Tes Upload File</h2>
            <p className="text-sm text-muted-foreground">
              Upload file untuk melihat hasil lengkap dari Supabase — termasuk pesan error asli jika gagal.
            </p>

            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 cursor-pointer bg-muted/20">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleTestUpload}
                disabled={uploadTest.status === "uploading"}
              />
              {uploadTest.status === "uploading" ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Mengupload… {uploadTest.progress}%</p>
                </div>
              ) : (
                <>
                  <UploadCloud className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Klik untuk memilih file</p>
                  <p className="text-xs text-muted-foreground">JPG, PNG, WEBP — maks. 10 MB</p>
                </>
              )}
            </label>

            {uploadTest.status === "success" && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-semibold text-green-700 dark:text-green-400">Upload Berhasil</span>
                </div>
                {uploadTest.url && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">URL File:</p>
                    <a
                      href={uploadTest.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-primary hover:underline break-all"
                    >
                      {uploadTest.url}
                    </a>
                  </div>
                )}
                {uploadTest.rawResponse && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Respons JSON:</p>
                    <pre className="text-xs bg-muted/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(JSON.parse(uploadTest.rawResponse), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {uploadTest.status === "error" && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-semibold text-destructive">Upload Gagal</span>
                </div>
                {uploadTest.error && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Detail Error:</p>
                    <pre className="text-xs bg-muted/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(uploadTest.error, null, 2)}
                    </pre>
                  </div>
                )}
                {uploadTest.rawResponse && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Respons Mentah dari Server:</p>
                    <pre className="text-xs bg-muted/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {uploadTest.rawResponse}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 3: Checklist */}
          <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
            <h2 className="font-semibold text-lg">3. Checklist Setup Supabase</h2>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Buka <strong>Supabase Dashboard → Storage</strong></li>
              <li>Buat bucket baru bernama <code className="bg-muted px-1 rounded">payments</code></li>
              <li>Set bucket sebagai <strong>Public</strong> (agar URL bisa diakses langsung)</li>
              <li>
                Jika bucket bersifat Private, tambahkan RLS policy berikut:<br />
                <code className="block bg-muted/60 rounded p-2 mt-1 text-xs font-mono break-all">
                  INSERT: (auth.role() = 'service_role')
                </code>
              </li>
              <li>Pastikan <code className="bg-muted px-1 rounded">SUPABASE_URL</code> dan <code className="bg-muted px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> sudah tersimpan di Replit Secrets</li>
              <li>Restart API Server setelah menambahkan secrets</li>
            </ol>
          </div>

        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
