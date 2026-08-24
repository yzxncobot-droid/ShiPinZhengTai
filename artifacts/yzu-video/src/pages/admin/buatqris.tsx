import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, QrCode, CheckCircle2, AlertCircle, Copy, Zap, ShieldCheck, Link2,
} from "lucide-react";

/**
 * Admin BuatQris configuration page.
 *
 * Shows the BuatQris connection state, account ID, webhook secret (masked),
 * and the auto-constructed callback URL. The secret token is NEVER shown —
 * it lives only in the server environment.
 */
export default function AdminBuatQris() {
  const { toast } = useToast();
  const [manualCallbackUrl, setManualCallbackUrl] = useState("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["buatqris-config"],
    queryFn: () => adminFetch<{
      state: string;
      accountId: string | null;
      secretTokenConfigured: boolean;
      webhookSecretConfigured: boolean;
      callbackUrl: string | null;
    }>("/buatqris/config"),
  });

  const connected = config?.state === "CONNECTED";

  const copyCallbackUrl = () => {
    const url = config?.callbackUrl ?? "";
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Callback URL disalin ✅" });
    });
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 md:p-8 max-w-3xl">
          <div className="mb-6">
            <h1 className="text-3xl font-heading font-bold flex items-center gap-2">
              <QrCode className="h-7 w-7" /> BuatQris
            </h1>
            <p className="text-muted-foreground mt-1">
              Konfigurasi pembayaran QRIS otomatis via BuatQris Open API.
            </p>
          </div>

          {/* Gateway status banner */}
          <div className={`mb-6 flex items-center gap-3 rounded-xl border p-4 ${
            connected ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
          }`}>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : connected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-600" />
            )}
            <div>
              <p className="font-semibold">
                Gateway: {isLoading ? "Memeriksa…" : connected ? "Terhubung" : "Belum dikonfigurasi"}
              </p>
              {!connected && (
                <p className="text-sm text-muted-foreground">
                  Set <code className="text-xs">BUATQRIS_ACCOUNT_ID</code> dan{" "}
                  <code className="text-xs">BUATQRIS_SECRET_TOKEN</code> di environment untuk mengaktifkan pembayaran otomatis.
                </p>
              )}
            </div>
          </div>

          {/* Configuration cards */}
          <div className="space-y-4">
            {/* Account ID */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4" /> BuatQris Account ID
                </CardTitle>
                <CardDescription>ID akun BuatQris Anda (dari environment server).</CardDescription>
              </CardHeader>
              <CardContent>
                <Input
                  readOnly
                  value={config?.accountId ?? "(belum diset)"}
                  className="font-mono text-sm"
                />
              </CardContent>
            </Card>

            {/* Secret Token */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4" /> BuatQris Secret Token
                </CardTitle>
                <CardDescription>
                  Secret token hanya tersimpan di server. Tidak pernah ditampilkan atau dikirim ke browser.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Input
                    readOnly
                    value="••••••••••••••••"
                    className="font-mono text-sm"
                  />
                  <Badge variant={config?.secretTokenConfigured ? "default" : "secondary"}>
                    {config?.secretTokenConfigured ? "Terkonfigurasi" : "Belum diset"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Webhook Secret */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4" /> BuatQris Webhook Secret
                </CardTitle>
                <CardDescription>
                  Secret untuk verifikasi signature webhook. Hanya di server.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Input
                    readOnly
                    value="••••••••••••••••"
                    className="font-mono text-sm"
                  />
                  <Badge variant={config?.webhookSecretConfigured ? "default" : "secondary"}>
                    {config?.webhookSecretConfigured ? "Terkonfigurasi" : "Belum diset"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Callback URL */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4" /> Callback URL (Webhook)
                </CardTitle>
                <CardDescription>
                  URL ini otomatis dibuat dari <code className="text-xs">PUBLIC_BASE_URL</code>.
                  Gunakan URL ini di dashboard BuatQris sebagai callback/webhook URL.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Input
                    readOnly
                    value={config?.callbackUrl ?? "(PUBLIC_BASE_URL belum diset)"}
                    className="font-mono text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyCallbackUrl}
                    disabled={!config?.callbackUrl}
                    className="gap-1.5 shrink-0"
                  >
                    <Copy className="h-3.5 w-3.5" /> Salin
                  </Button>
                </div>
                {config?.callbackUrl && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Endpoint: <code className="text-xs">POST /api/webhooks/buatqris</code>
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Environment variables reference */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Environment Variables</CardTitle>
              <CardDescription>Variabel yang diperlukan di server environment.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 font-mono text-xs">
                <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
                  <Badge variant="outline">required</Badge>
                  <code>BUATQRIS_ACCOUNT_ID</code>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
                  <Badge variant="outline">required</Badge>
                  <code>BUATQRIS_SECRET_TOKEN</code>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
                  <Badge variant="outline">required</Badge>
                  <code>BUATQRIS_WEBHOOK_SECRET</code>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
                  <Badge variant="outline">required</Badge>
                  <code>PUBLIC_BASE_URL</code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
