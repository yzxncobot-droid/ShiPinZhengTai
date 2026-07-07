import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDateTime } from "@/lib/admin-api";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Wallet, RefreshCw, ArrowUpRight, ArrowDownLeft, TrendingUp } from "lucide-react";

const TYPE_CFG: Record<string, { label: string; cls: string; sign: string }> = {
  topup: { label: "Top-up", cls: "bg-green-500/10 text-green-600", sign: "+" },
  purchase: { label: "Pembelian", cls: "bg-blue-500/10 text-blue-600", sign: "-" },
  withdrawal: { label: "Penarikan", cls: "bg-orange-500/10 text-orange-600", sign: "-" },
  subscription: { label: "Langganan", cls: "bg-purple-500/10 text-purple-600", sign: "-" },
  refund: { label: "Refund", cls: "bg-teal-500/10 text-teal-600", sign: "+" },
};

export default function AdminWallet() {
  const { user } = useAuth();
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

  const { data: walletData, isLoading: wLoading } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => adminFetch("/wallet"),
  });

  const { data: txData, isLoading: txLoading, refetch } = useQuery({
    queryKey: ["transactions", typeFilter, page],
    queryFn: () => adminFetch(`/transactions?${typeFilter !== "all" ? `type=${typeFilter}&` : ""}page=${page}&limit=20`),
    placeholderData: (prev) => prev,
  });

  const balance = (walletData as any)?.balance ?? 0;
  const txList = (txData as any)?.data ?? [];
  const total = (txData as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const credits = txList.filter((t: any) => t.amount > 0).reduce((s: number, t: any) => s + t.amount, 0);
  const debits = txList.filter((t: any) => t.amount < 0).reduce((s: number, t: any) => s + Math.abs(t.amount), 0);

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-4xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold">Wallet Saya</h1>
            <p className="text-sm text-muted-foreground">Saldo dan riwayat transaksi akun {user?.username}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="sm:col-span-1 border-primary/30">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Wallet className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Saldo Saat Ini</p>
                </div>
                {wLoading ? <Skeleton className="h-8 w-32" /> : (
                  <p className="text-3xl font-bold">{fmtRp(balance)}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                    <ArrowDownLeft className="h-5 w-5 text-green-500" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Total Kredit (halaman ini)</p>
                </div>
                <p className="text-2xl font-bold text-green-600">+{fmtRp(credits)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                    <ArrowUpRight className="h-5 w-5 text-red-500" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Total Debit (halaman ini)</p>
                </div>
                <p className="text-2xl font-bold text-red-600">-{fmtRp(debits)}</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex gap-3">
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Tipe" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tipe</SelectItem>
                {Object.entries(TYPE_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </div>

          <div className="bg-card rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium text-muted-foreground">Deskripsi</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Tipe</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Nominal</th>
                  <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Waktu</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {txLoading
                  ? Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={4} className="p-3"><Skeleton className="h-8 w-full" /></td></tr>)
                  : txList.length === 0
                  ? <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">Tidak ada transaksi</td></tr>
                  : txList.map((t: any) => {
                    const cfg = TYPE_CFG[t.type] ?? { label: t.type, cls: "bg-muted text-muted-foreground", sign: "" };
                    return (
                      <tr key={t.id} className="hover:bg-muted/20">
                        <td className="p-3">
                          <p className="font-medium">{t.description || "—"}</p>
                        </td>
                        <td className="p-3">
                          <Badge className={`border-0 text-xs ${cfg.cls}`}>{cfg.label}</Badge>
                        </td>
                        <td className={`p-3 text-right font-bold tabular-nums ${t.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {t.amount >= 0 ? "+" : ""}{fmtRp(t.amount)}
                        </td>
                        <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">{fmtDateTime(t.createdAt)}</td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Halaman {page} dari {totalPages} ({total} total)</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
