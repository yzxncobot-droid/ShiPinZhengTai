import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, fmtRp } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileBarChart, Download, RefreshCw, TrendingUp, Users, Video, CreditCard } from "lucide-react";

export default function AdminReports() {
  const { toast } = useToast();
  const [period, setPeriod] = useState("monthly");

  const { data: overview } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => adminFetch("/analytics/overview"),
  });
  const { data: revChart } = useQuery({
    queryKey: ["revenue-chart-report", period],
    queryFn: () => adminFetch(`/analytics/revenue?period=${period}`),
  });

  const ov = overview as any;
  const chart = (revChart as any[]) ?? [];

  const exportCSV = (data: any[], filename: string) => {
    if (!data.length) { toast({ title: "Tidak ada data untuk diexport", variant: "destructive" }); return; }
    const keys = Object.keys(data[0]);
    const rows = [keys.join(","), ...data.map(r => keys.map(k => JSON.stringify(r[k] ?? "")).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast({ title: `✅ ${filename}.csv berhasil didownload` });
  };

  const reportCards = [
    {
      title: "Laporan Pendapatan",
      desc: "Total topup, revenue per hari/minggu/bulan",
      icon: TrendingUp, color: "text-green-500 bg-green-500/10",
      stats: [
        { label: "Revenue Hari Ini", value: fmtRp(ov?.revenueToday) },
        { label: "Revenue Bulan Ini", value: fmtRp(ov?.revenueMonth) },
        { label: "Revenue All Time", value: fmtRp(ov?.revenueAllTime) },
      ],
      onExport: () => exportCSV(chart.map(r => ({ date: r.date, revenue: r.amount, formatted: fmtRp(r.amount) })), "laporan-revenue"),
    },
    {
      title: "Laporan Pengguna",
      desc: "Statistik total user, premium, admin",
      icon: Users, color: "text-blue-500 bg-blue-500/10",
      stats: [
        { label: "Total User", value: ov?.totalUsers ?? 0 },
        { label: "Premium Aktif", value: ov?.premiumUsers ?? 0 },
        { label: "Admin", value: ov?.adminUsers ?? 0 },
      ],
      onExport: () => exportCSV([{
        total_users: ov?.totalUsers, premium_users: ov?.premiumUsers, admin_users: ov?.adminUsers,
        owner_users: ov?.ownerUsers, banned_users: ov?.bannedUsers, new_today: ov?.newUsersToday,
      }], "laporan-pengguna"),
    },
    {
      title: "Laporan Video",
      desc: "Total video, premium, views",
      icon: Video, color: "text-purple-500 bg-purple-500/10",
      stats: [
        { label: "Total Video", value: ov?.totalVideos ?? 0 },
        { label: "Video Premium", value: ov?.premiumVideos ?? 0 },
        { label: "Total Views", value: (ov?.totalViews ?? 0).toLocaleString("id-ID") },
      ],
      onExport: () => exportCSV([{
        total_videos: ov?.totalVideos, premium_videos: ov?.premiumVideos,
        free_videos: ov?.freeVideos, total_views: ov?.totalViews, new_today: ov?.newVideosToday,
      }], "laporan-video"),
    },
    {
      title: "Laporan Pembayaran",
      desc: "Topup pending, dikonfirmasi, ditolak",
      icon: CreditCard, color: "text-orange-500 bg-orange-500/10",
      stats: [
        { label: "Topup Pending", value: ov?.pendingTopups ?? 0 },
        { label: "Penarikan Pending", value: ov?.pendingWithdrawals ?? 0 },
        { label: "Langganan Aktif", value: ov?.totalActiveSubscriptions ?? 0 },
      ],
      onExport: () => exportCSV([{
        pending_topups: ov?.pendingTopups, pending_withdrawals: ov?.pendingWithdrawals,
        active_subscriptions: ov?.totalActiveSubscriptions,
      }], "laporan-pembayaran"),
    },
  ];

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Laporan</h1>
              <p className="text-sm text-muted-foreground">Export data dalam format CSV</p>
            </div>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">30 Hari Terakhir</SelectItem>
                <SelectItem value="weekly">12 Minggu Terakhir</SelectItem>
                <SelectItem value="monthly">12 Bulan Terakhir</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reportCards.map((card) => (
              <Card key={card.title} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${card.color}`}>
                        <card.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{card.title}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">{card.desc}</CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    {card.stats.map((stat) => (
                      <div key={stat.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{stat.label}</span>
                        <span className="font-semibold">{stat.value}</span>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="w-full gap-2 mt-2" onClick={card.onExport}>
                    <Download className="h-3.5 w-3.5" />Export CSV
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">
                <strong>Catatan:</strong> Export PDF akan segera hadir. Saat ini tersedia export CSV yang dapat dibuka di Excel, Google Sheets, atau aplikasi spreadsheet lainnya.
              </p>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
