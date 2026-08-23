import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { fmtRp, fmtDateTime } from "@/lib/admin-api";
import {
  Loader2, QrCode, Link2, ListOrdered, Gauge, Image as ImageIcon,
  CheckCircle2, AlertCircle, Zap,
} from "lucide-react";

const QC = ["temanqris", "temanqris-links", "temanqris-orders", "temanqris-usage", "temanqris-myqris"];

export default function AdminTemanQris() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Gateway state ──────────────────────────────────────────────────────────
  const { data: gateway, isLoading: gwLoading } = useQuery({
    queryKey: ["temanqris-gateway"],
    queryFn: () => adminFetch<{ state: string }>("/temanqris/gateway"),
  });

  // ── Usage ──────────────────────────────────────────────────────────────────
  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ["temanqris-usage"],
    queryFn: () => adminFetch<any>("/temanqris/usage"),
  });

  // ── My QRIS ─────────────────────────────────────────────────────────────────
  const { data: myQris, isLoading: myQrisLoading } = useQuery({
    queryKey: ["temanqris-myqris"],
    queryFn: () => adminFetch<{ qris: any[] }>("/temanqris/my-qris"),
  });

  // ── Payment links ───────────────────────────────────────────────────────────
  const { data: linksData, isLoading: linksLoading } = useQuery({
    queryKey: ["temanqris-links"],
    queryFn: () => adminFetch<{ payment_links: any[] }>("/temanqris/payment-links"),
  });

  // ── Orders ─────────────────────────────────────────────────────────────────
  const [orderStatus, setOrderStatus] = useState("");
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["temanqris-orders", orderStatus],
    queryFn: () =>
      adminFetch<{ orders: any[] }>(
        `/temanqris/orders${orderStatus ? `?status=${orderStatus}` : ""}`,
      ),
  });

  const connected = gateway?.state === "CONNECTED";

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 md:p-8 max-w-5xl">
          <div className="mb-6">
            <h1 className="text-3xl font-heading font-bold flex items-center gap-2">
              <QrCode className="h-7 w-7" /> TemanQRIS
            </h1>
            <p className="text-muted-foreground mt-1">
              Kelola QRIS, payment link, dan status order sesuai dokumentasi API TemanQRIS.
            </p>
          </div>

          {/* Gateway status banner */}
          <div className={`mb-6 flex items-center gap-3 rounded-xl border p-4 ${
            connected ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
          }`}>
            {gwLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : connected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-600" />
            )}
            <div>
              <p className="font-semibold">
                Gateway: {gwLoading ? "Memeriksa…" : connected ? "Terhubung" : "Belum dikonfigurasi"}
              </p>
              {!connected && (
                <p className="text-sm text-muted-foreground">
                  Set <code className="text-xs">TEMANQRIS_API_KEY</code> di environment untuk mengaktifkan endpoint.
                </p>
              )}
            </div>
          </div>

          <Tabs defaultValue="generate">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 mb-6">
              <TabsTrigger value="generate"><Zap className="h-4 w-4 md:mr-1.5" /><span className="hidden md:inline">Generate</span></TabsTrigger>
              <TabsTrigger value="render"><ImageIcon className="h-4 w-4 md:mr-1.5" /><span className="hidden md:inline">Render</span></TabsTrigger>
              <TabsTrigger value="links"><Link2 className="h-4 w-4 md:mr-1.5" /><span className="hidden md:inline">Links</span></TabsTrigger>
              <TabsTrigger value="orders"><ListOrdered className="h-4 w-4 md:mr-1.5" /><span className="hidden md:inline">Orders</span></TabsTrigger>
              <TabsTrigger value="status"><Gauge className="h-4 w-4 md:mr-1.5" /><span className="hidden md:inline">Status</span></TabsTrigger>
            </TabsList>

            {/* ── Generate QRIS ─────────────────────────────────────────────── */}
            <TabsContent value="generate">
              <GenerateTab onToast={toast} invalidate={() => qc.invalidateQueries({ queryKey: QC })} />
            </TabsContent>

            {/* ── Render QR ─────────────────────────────────────────────────── */}
            <TabsContent value="render">
              <RenderTab onToast={toast} />
            </TabsContent>

            {/* ── Payment Links ─────────────────────────────────────────────── */}
            <TabsContent value="links">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Payment Links</CardTitle>
                  <CardDescription>Semua payment link yang sudah dibuat.</CardDescription>
                </CardHeader>
                <CardContent>
                  {linksLoading ? (
                    <CenterSpinner />
                  ) : (linksData?.payment_links?.length ?? 0) === 0 ? (
                    <Empty text="Belum ada payment link." />
                  ) : (
                    <div className="space-y-2">
                      {linksData?.payment_links?.map((l: any) => (
                        <LinkRow key={l.id ?? l.link_code} link={l} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Orders ────────────────────────────────────────────────────── */}
            <TabsContent value="orders">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ListOrdered className="h-4 w-4" /> Daftar Order</CardTitle>
                  <CardDescription>Cek status pembayaran order via API.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {["", "pending", "awaiting_confirmation", "paid", "expired", "cancelled"].map((s) => (
                      <Button
                        key={s || "all"}
                        size="sm"
                        variant={orderStatus === s ? "default" : "outline"}
                        onClick={() => setOrderStatus(s)}
                      >
                        {s || "Semua"}
                      </Button>
                    ))}
                  </div>
                  {ordersLoading ? (
                    <CenterSpinner />
                  ) : (ordersData?.orders?.length ?? 0) === 0 ? (
                    <Empty text="Tidak ada order." />
                  ) : (
                    <div className="space-y-2">
                      {ordersData?.orders?.map((o: any, i: number) => (
                        <OrderRow key={o.order_id ?? i} order={o} onToast={toast} invalidate={() => qc.invalidateQueries({ queryKey: ["temanqris-orders", orderStatus] })} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Status: usage + my-qris ──────────────────────────────────── */}
            <TabsContent value="status">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4" /> API Usage</CardTitle>
                    <CardDescription>Sisa limit pemakaian API.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {usageLoading ? <CenterSpinner /> : (
                      <pre className="rounded-lg bg-muted p-4 text-xs overflow-auto max-h-64">
                        {JSON.stringify(usage?.usage ?? usage ?? {}, null, 2)}
                      </pre>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><QrCode className="h-4 w-4" /> My QRIS (Statis)</CardTitle>
                    <CardDescription>Daftar QRIS statis yang tersimpan di TemanQRIS.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myQrisLoading ? <CenterSpinner /> : (myQris?.qris?.length ?? 0) === 0 ? (
                      <Empty text="Belum ada QRIS statis. Upload via tab Generate atau endpoint /temanqris/upload." />
                    ) : (
                      <div className="space-y-2">
                        {myQris?.qris?.map((q: any) => (
                          <div key={q.id ?? q.qris_data_id} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <p className="font-medium text-sm">{q.name ?? `QRIS #${q.id ?? q.qris_data_id}`}</p>
                              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{q.qris_string ?? q.qris ?? "—"}</p>
                            </div>
                            <Badge variant="outline">ID: {q.id ?? q.qris_data_id}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}

// ── Generate tab ─────────────────────────────────────────────────────────────
function GenerateTab({ onToast, invalidate }: { onToast: any; invalidate: () => void }) {
  const [form, setForm] = useState({
    amount: "", fee_type: "", fee_value: "", qris_id: "",
    order_id: "", webhook_url: "", callback_url: "",
  });
  const [result, setResult] = useState<any>(null);

  const mut = useMutation({
    mutationFn: (data: any) => adminFetch<any>("/temanqris/generate", {
      method: "POST", body: JSON.stringify(data),
    }),
    onSuccess: (data) => {
      setResult(data);
      invalidate();
      onToast({ title: "✅ QRIS berhasil dibuat" });
    },
    onError: (e: any) => onToast({ title: "Gagal generate", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return onToast({ title: "Amount wajib diisi", variant: "destructive" });
    const body: any = { amount };
    if (form.fee_type) body.fee_type = form.fee_type;
    if (form.fee_value) body.fee_value = Number(form.fee_value);
    if (form.qris_id) body.qris_id = Number(form.qris_id);
    if (form.order_id) body.order_id = form.order_id;
    if (form.webhook_url) body.webhook_url = form.webhook_url;
    if (form.callback_url) body.callback_url = form.callback_url;
    mut.mutate(body);
  };

  const set = (k: string, v: string) => setResult(null) || setForm((p) => ({ ...p, [k]: v }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Generate Dynamic QRIS</CardTitle>
        <CardDescription>Buat QRIS dinamis dengan nominal. Isi order_id, webhook_url, callback_url untuk notifikasi otomatis.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (Rp) *" value={form.amount} onChange={(v) => set("amount", v)} type="number" />
          <Field label="Order ID" value={form.order_id} onChange={(v) => set("order_id", v)} placeholder="INV-2026-0001" />
          <Field label="Fee Type" value={form.fee_type} onChange={(v) => set("fee_type", v)} placeholder="rupiah / percent" />
          <Field label="Fee Value" value={form.fee_value} onChange={(v) => set("fee_value", v)} type="number" />
          <Field label="QRIS ID" value={form.qris_id} onChange={(v) => set("qris_id", v)} type="number" />
          <Field label="Webhook URL" value={form.webhook_url} onChange={(v) => set("webhook_url", v)} placeholder="https://…" />
          <div className="col-span-2">
            <Field label="Callback URL" value={form.callback_url} onChange={(v) => set("callback_url", v)} placeholder="https://…/thank-you" />
          </div>
        </div>
        <Button onClick={submit} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Generate QRIS
        </Button>

        {result && (
          <div className="mt-2 space-y-4 rounded-xl border p-4">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {result.qrImage ? (
                <img src={result.qrImage} alt="QRIS" className="h-44 w-44 rounded-lg border bg-white p-2" />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-lg border text-xs text-muted-foreground">Tidak ada gambar</div>
              )}
              <div className="text-sm space-y-1">
                <p><b>Amount:</b> {fmtRp(result.amount)}</p>
                {result.fee?.type && <p><b>Fee:</b> {result.fee.type} {result.fee.value}</p>}
                {result.qrisString && <p className="break-all"><b>QRIS:</b> <code className="text-xs">{result.qrisString.slice(0, 48)}…</code></p>}
                {result.paymentLink?.url && (
                  <p><b>Link:</b>{" "}
                    <a className="text-blue-600 underline" target="_blank" rel="noreferrer"
                      href={result.paymentLink.url.startsWith("http") ? result.paymentLink.url : `https://temanqris.com${result.paymentLink.url}`}>
                      {result.paymentLink.linkCode ?? "Buka"}
                    </a>
                  </p>
                )}
                {result.expiresAt && <p><b>Expired:</b> {fmtDateTime(result.expiresAt)}</p>}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Render tab ───────────────────────────────────────────────────────────────
function RenderTab({ onToast }: { onToast: any }) {
  const [qrisString, setQrisString] = useState("");
  const [qrisDataId, setQrisDataId] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (data: any) => adminFetch<any>("/temanqris/render", {
      method: "POST", body: JSON.stringify(data),
    }),
    onSuccess: (data) => {
      setQrImage(data.qr_image ?? null);
      onToast({ title: "✅ QR dirender" });
    },
    onError: (e: any) => onToast({ title: "Render gagal", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    const body: any = {};
    if (qrisString) body.qris_string = qrisString;
    if (qrisDataId) body.qris_data_id = Number(qrisDataId);
    if (!qrisString && !qrisDataId) return onToast({ title: "Isi qris_string atau qris_data_id", variant: "destructive" });
    mut.mutate(body);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Render QR Image</CardTitle>
        <CardDescription>Generate gambar QR dari string QRIS atau saved ID.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>QRIS String</Label>
          <Textarea value={qrisString} onChange={(e) => setQrisString(e.target.value)} placeholder="00020101021226..." className="font-mono text-xs h-24" />
        </div>
        <div className="space-y-1.5">
          <Label>Atau QRIS Data ID</Label>
          <Input type="number" value={qrisDataId} onChange={(e) => setQrisDataId(e.target.value)} placeholder="123" />
        </div>
        <Button onClick={submit} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Render
        </Button>
        {qrImage && (
          <div className="flex justify-center rounded-xl border p-4">
            <img src={qrImage} alt="QR" className="h-48 w-48 rounded-lg border bg-white p-2" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Row components ───────────────────────────────────────────────────────────
function LinkRow({ link }: { link: any }) {
  const url = link.url?.startsWith("http") ? link.url : `https://temanqris.com${link.url ?? ""}`;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{link.description ?? link.link_code ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{fmtRp(link.amount)} · {link.link_code}</p>
        {url && <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline truncate block max-w-[220px]">{url}</a>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusBadge status={link.is_expired ? "expired" : link.is_active ? "active" : "inactive"} />
        <span className="text-[10px] text-muted-foreground">{link.view_count ?? 0} views</span>
      </div>
    </div>
  );
}

function OrderRow({ order, onToast, invalidate }: { order: any; onToast: any; invalidate: () => void }) {
  const verifyMut = useMutation({
    mutationFn: () => adminFetch<any>(`/temanqris/orders/${encodeURIComponent(order.order_id)}/verify`, { method: "POST" }),
    onSuccess: () => { onToast({ title: "✅ Order diverifikasi" }); invalidate(); },
    onError: (e: any) => onToast({ title: "Verifikasi gagal", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{order.order_id ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{fmtRp(order.amount)} · {fmtDateTime(order.paid_at ?? order.created_at)}</p>
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={order.status} />
        {order.status !== "paid" && (
          <Button size="sm" variant="outline" disabled={verifyMut.isPending} onClick={() => verifyMut.mutate()}>
            {verifyMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Verify
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
    active: "bg-emerald-100 text-emerald-700 border-emerald-200",
    awaiting_confirmation: "bg-blue-100 text-blue-700 border-blue-200",
    pending: "bg-amber-100 text-amber-700 border-amber-200",
    expired: "bg-red-100 text-red-700 border-red-200",
    cancelled: "bg-slate-100 text-slate-600 border-slate-200",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <Badge variant="outline" className={map[status ?? ""] ?? "bg-slate-100 text-slate-600 border-slate-200"}>
      {status ?? "—"}
    </Badge>
  );
}

function CenterSpinner() {
  return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
