import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, fmtRp, fmtDateTime, relativeTime } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Users, Video, DollarSign, TrendingUp, Eye, Crown, ShieldCheck,
  User, Clock, CheckCircle2, AlertCircle, BarChart3, ArrowUpRight,
  Wallet, Star,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

function StatCard({
  title, value, sub, icon: Icon, color = "primary", trend, loading,
}: {
  title: string; value: string | number; sub?: string; icon: any;
  color?: string; trend?: number; loading?: boolean;
}) {
  const colors: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    green: "bg-green-500/10 text-green-500",
    blue: "bg-blue-500/10 text-blue-500",
    orange: "bg-orange-500/10 text-orange-500",
    purple: "bg-purple-500/10 text-purple-500",
    red: "bg-red-500/10 text-red-500",
  };
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-24 mt-1.5" />
            ) : (
              <p className="text-2xl font-bold mt-1 tracking-tight">{value}</p>
            )}
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend !== undefined && !loading && (
          <div className="flex items-center gap-1 mt-2">
            <ArrowUpRight className={`h-3 w-3 ${trend >= 0 ? "text-green-500" : "text-red-500 rotate-90"}`} />
            <span className={`text-xs font-medium ${trend >= 0 ? "text-green-500" : "text-red-500"}`}>
              {Math.abs(trend)}% vs kemarin
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const TRANSACTION_TYPE_COLORS: Record<string, string> = {
  topup: "bg-green-500/10 text-green-600",
  purchase: "bg-blue-500/10 text-blue-600",
  withdrawal: "bg-orange-500/10 text-orange-600",
  subscription: "bg-purple-500/10 text-purple-600",
  refund: "bg-red-500/10 text-red-600",
};

export default function AdminDashboard() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [revPeriod, setRevPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => adminFetch("/analytics/overview"),
    refetchInterval: 30000,
  });

  const { data: revData, isLoading: revLoading } = useQuery({
    queryKey: ["admin-revenue-chart", revPeriod],
    queryFn: () => adminFetch(`/analytics/revenue?period=${revPeriod}`),
  });

  const { data: topVideos, isLoading: tvLoading } = useQuery({
    queryKey: ["admin-top-videos"],
    queryFn: () => adminFetch("/analytics/videos"),
  });

  const { data: recentActivity, isLoading: raLoading } = useQuery({
    queryKey: ["admin-activity"],
    queryFn: () => adminFetch("/analytics/activity"),
    refetchInterval: 60000,
  });

  const ov = overview as any;

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold">Selamat datang, {user?.username} 👋</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Ringkasan platform Yzu视频 per hari ini
            </p>
          </div>

          {/* Stats Row 1 — Users */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pengguna</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard title="Total Users" value={ov?.totalUsers ?? 0} icon={Users} color="blue" loading={ovLoading} sub={`+${ov?.newUsersToday ?? 0} hari ini`} />
              <StatCard title="Premium" value={ov?.premiumUsers ?? 0} icon={Crown} color="purple" loading={ovLoading} />
              <StatCard title="Admin" value={ov?.adminUsers ?? 0} icon={ShieldCheck} color="orange" loading={ovLoading} />
              <StatCard title="Owner" value={ov?.ownerUsers ?? 0} icon={Crown} color="primary" loading={ovLoading} />
              <StatCard title="Banned" value={ov?.bannedUsers ?? 0} icon={AlertCircle} color="red" loading={ovLoading} />
              <StatCard title="Aktif Langganan" value={ov?.totalActiveSubscriptions ?? 0} icon={Star} color="green" loading={ovLoading} />
            </div>
          </div>

          {/* Stats Row 2 — Videos */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Konten</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard title="Total Video" value={ov?.totalVideos ?? 0} icon={Video} color="blue" loading={ovLoading} sub={`+${ov?.newVideosToday ?? 0} hari ini`} />
              <StatCard title="Video Premium" value={ov?.premiumVideos ?? 0} icon={Crown} color="purple" loading={ovLoading} />
              <StatCard title="Video Gratis" value={ov?.freeVideos ?? 0} icon={Video} color="green" loading={ovLoading} />
              <StatCard title="Total Views" value={(ov?.totalViews ?? 0).toLocaleString("id-ID")} icon={Eye} color="orange" loading={ovLoading} />
            </div>
          </div>

          {/* Stats Row 3 — Revenue (Owner only) */}
          {isOwner && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Keuangan</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <StatCard title="Pendapatan Hari Ini" value={fmtRp(ov?.revenueToday)} icon={DollarSign} color="green" loading={ovLoading} />
                <StatCard title="Pendapatan Bulan Ini" value={fmtRp(ov?.revenueMonth)} icon={TrendingUp} color="primary" loading={ovLoading} />
                <StatCard title="Total Pendapatan" value={fmtRp(ov?.revenueAllTime)} icon={Wallet} color="purple" loading={ovLoading} />
                <StatCard title="Topup Pending" value={ov?.pendingTopups ?? 0} icon={Clock} color="orange" loading={ovLoading} />
                <StatCard title="Penarikan Pending" value={ov?.pendingWithdrawals ?? 0} icon={AlertCircle} color="red" loading={ovLoading} />
              </div>
            </div>
          )}

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Revenue Chart */}
            {isOwner && (
              <Card className="lg:col-span-2">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="text-base">Grafik Pendapatan</CardTitle>
                    <CardDescription>Total topup dikonfirmasi</CardDescription>
                  </div>
                  <Select value={revPeriod} onValueChange={(v) => setRevPeriod(v as any)}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Harian (30 hari)</SelectItem>
                      <SelectItem value="weekly">Mingguan</SelectItem>
                      <SelectItem value="monthly">Bulanan</SelectItem>
                    </SelectContent>
                  </Select>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    {revLoading ? (
                      <Skeleton className="h-full w-full rounded-lg" />
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={revData as any[]}>
                          <defs>
                            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                          <RTooltip
                            contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any) => [fmtRp(v), "Pendapatan"]}
                          />
                          <Area dataKey="amount" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#revGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Top Videos */}
            <Card className={isOwner ? "" : "lg:col-span-2"}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Top Videos</CardTitle>
                <CardDescription>Berdasarkan jumlah tayangan</CardDescription>
              </CardHeader>
              <CardContent>
                {tvLoading ? (
                  <div className="space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : !topVideos || (topVideos as any[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Belum ada video</p>
                ) : (
                  <div className="space-y-2">
                    {(topVideos as any[]).slice(0, 8).map((v: any, i: number) => (
                      <div key={v.id} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground w-4">{i + 1}</span>
                        {v.thumbnail ? (
                          <img src={v.thumbnail} className="h-8 w-12 object-cover rounded" alt="" />
                        ) : (
                          <div className="h-8 w-12 bg-muted rounded flex items-center justify-center">
                            <Video className="h-3 w-3 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{v.title}</p>
                          <p className="text-xs text-muted-foreground">{(v.views ?? 0).toLocaleString("id-ID")} views</p>
                        </div>
                        <Badge variant={v.type === "premium" ? "default" : "secondary"} className="text-xs shrink-0">
                          {v.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Aktivitas Terbaru</CardTitle>
              <CardDescription>20 transaksi terakhir</CardDescription>
            </CardHeader>
            <CardContent>
              {raLoading ? (
                <div className="space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : !recentActivity || (recentActivity as any[]).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Belum ada aktivitas</p>
              ) : (
                <div className="space-y-2">
                  {(recentActivity as any[]).map((t: any) => (
                    <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 transition-colors">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={t.user?.avatar} />
                        <AvatarFallback className="text-xs">{t.user?.username?.slice(0, 2).toUpperCase() ?? "?"}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{t.user?.username ?? "System"}</p>
                        <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${t.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {t.amount >= 0 ? "+" : ""}{fmtRp(t.amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">{relativeTime(t.createdAt)}</p>
                      </div>
                      <Badge
                        className={`text-xs shrink-0 border-0 ${TRANSACTION_TYPE_COLORS[t.type] ?? "bg-muted text-muted-foreground"}`}
                      >
                        {t.type}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
