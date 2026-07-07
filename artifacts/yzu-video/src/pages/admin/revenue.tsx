import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, fmtRp } from "@/lib/admin-api";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, DollarSign, Wallet, CreditCard, Star } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#6366f1"];

export default function AdminRevenue() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => adminFetch("/analytics/overview"),
  });

  const { data: revChart, isLoading: chartLoading } = useQuery({
    queryKey: ["revenue-chart", period],
    queryFn: () => adminFetch(`/analytics/revenue?period=${period}`),
  });

  const ov = overview as any;
  const chart = (revChart as any[]) ?? [];

  const revSources = [
    { name: "Top-up Wallet", value: ov?.revenueAllTime ?? 0, color: COLORS[0] },
    { name: "Langganan", value: 0, color: COLORS[1] },
    { name: "Video Premium", value: 0, color: COLORS[2] },
  ].filter(s => s.value > 0);

  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
          <div>
            <h1 className="text-2xl font-bold">Pendapatan</h1>
            <p className="text-sm text-muted-foreground">Laporan pendapatan platform Yzu视频</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Hari Ini", value: ov?.revenueToday, icon: DollarSign, color: "text-green-500", bg: "bg-green-500/10" },
              { label: "Bulan Ini", value: ov?.revenueMonth, icon: TrendingUp, color: "text-blue-500", bg: "bg-blue-500/10" },
              { label: "Sepanjang Waktu", value: ov?.revenueAllTime, icon: Wallet, color: "text-primary", bg: "bg-primary/10" },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${item.bg}`}>
                    <item.icon className={`h-6 w-6 ${item.color}`} />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{item.label}</p>
                    {ovLoading ? <Skeleton className="h-7 w-28 mt-1" /> : <p className="text-xl font-bold mt-0.5">{fmtRp(item.value)}</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Area Chart */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-base">Tren Pendapatan</CardTitle>
                  <CardDescription>Total topup dikonfirmasi per periode</CardDescription>
                </div>
                <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">30 Hari Terakhir</SelectItem>
                    <SelectItem value="weekly">12 Minggu Terakhir</SelectItem>
                    <SelectItem value="monthly">12 Bulan Terakhir</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  {chartLoading ? <Skeleton className="h-full w-full rounded-lg" /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chart}>
                        <defs>
                          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                          tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                        <RTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: any) => [fmtRp(v), "Pendapatan"]} />
                        <Area dataKey="amount" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#areaGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Stats sidebar */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Statistik Topup</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {ovLoading ? Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />) : (
                    <>
                      <div className="flex items-center justify-between p-3 bg-yellow-500/5 rounded-lg border border-yellow-200/30">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-yellow-500" />
                          <span className="text-sm">Menunggu</span>
                        </div>
                        <span className="font-semibold">{ov?.pendingTopups ?? 0}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-green-500/5 rounded-lg border border-green-200/30">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-sm">Dikonfirmasi</span>
                        </div>
                        <span className="font-semibold text-green-600">{fmtRp(ov?.revenueAllTime)}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-blue-500/5 rounded-lg border border-blue-200/30">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-blue-500" />
                          <span className="text-sm">Langganan Aktif</span>
                        </div>
                        <span className="font-semibold">{ov?.totalActiveSubscriptions ?? 0}</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Ringkasan Keuangan</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {[
                      { label: "Penarikan Pending", value: ov?.pendingWithdrawals ?? 0, isCount: true },
                      { label: "Revenue Hari Ini", value: fmtRp(ov?.revenueToday) },
                      { label: "Revenue Bulan Ini", value: fmtRp(ov?.revenueMonth) },
                    ].map((item) => (
                      <div key={item.label} className="flex justify-between py-1.5 border-b last:border-0">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-medium">{item.isCount ? item.value : item.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Bar chart - monthly breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pendapatan per Bulan (12 bulan terakhir)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart.length > 0 ? chart : []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : `${(v/1000).toFixed(0)}k`} />
                    <RTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any) => [fmtRp(v), "Pendapatan"]} />
                    <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={60} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
