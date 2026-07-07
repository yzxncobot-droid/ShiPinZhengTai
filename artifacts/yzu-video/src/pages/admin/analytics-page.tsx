import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Video, Eye, ThumbsUp, Star } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";

export default function AdminAnalyticsPage() {
  const { data: topVideos, isLoading: tvLoading } = useQuery({
    queryKey: ["admin-top-videos"],
    queryFn: () => adminFetch("/analytics/videos"),
  });

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => adminFetch("/analytics/overview"),
  });

  const videos = (topVideos as any[]) ?? [];
  const ov = overview as any;

  const topByViews = videos.slice(0, 10);
  const topByLikes = [...videos].sort((a, b) => b.likes - a.likes).slice(0, 10);

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-sm text-muted-foreground">Statistik performa konten platform</p>
          </div>

          {/* Overview Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Views", value: (ov?.totalViews ?? 0).toLocaleString("id-ID"), icon: Eye, color: "text-blue-500 bg-blue-500/10" },
              { label: "Total Video", value: ov?.totalVideos ?? 0, icon: Video, color: "text-purple-500 bg-purple-500/10" },
              { label: "Video Premium", value: ov?.premiumVideos ?? 0, icon: Star, color: "text-yellow-500 bg-yellow-500/10" },
              { label: "Video Gratis", value: ov?.freeVideos ?? 0, icon: Video, color: "text-green-500 bg-green-500/10" },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}>
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    {ovLoading ? <Skeleton className="h-6 w-16 mt-0.5" /> : <p className="text-xl font-bold">{item.value}</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Videos by Views */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Top 10 Video by Views</CardTitle>
                <CardDescription>Video dengan tayangan terbanyak</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  {tvLoading ? <Skeleton className="h-full w-full" /> : topByViews.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">Belum ada data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topByViews} layout="vertical" margin={{ left: 0, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="title" width={100}
                          tickFormatter={(v) => v?.length > 14 ? v.slice(0, 14) + "…" : v}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <RTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: any) => [v.toLocaleString("id-ID"), "Views"]} />
                        <Bar dataKey="views" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} maxBarSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Top Videos by Likes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Top 10 Video by Likes</CardTitle>
                <CardDescription>Video dengan likes terbanyak</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  {tvLoading ? <Skeleton className="h-full w-full" /> : topByLikes.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">Belum ada data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topByLikes} layout="vertical" margin={{ left: 0, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="title" width={100}
                          tickFormatter={(v) => v?.length > 14 ? v.slice(0, 14) + "…" : v}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <RTooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: any) => [v.toLocaleString("id-ID"), "Likes"]} />
                        <Bar dataKey="likes" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Video Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Performa Semua Video</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left font-medium text-muted-foreground">#</th>
                      <th className="pb-2 text-left font-medium text-muted-foreground">Video</th>
                      <th className="pb-2 text-left font-medium text-muted-foreground">Tipe</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">Views</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">Likes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tvLoading
                      ? Array(8).fill(0).map((_, i) => <tr key={i}><td colSpan={5} className="py-2"><Skeleton className="h-8 w-full" /></td></tr>)
                      : videos.map((v: any, i: number) => (
                        <tr key={v.id} className="hover:bg-muted/20">
                          <td className="py-2.5 text-muted-foreground text-xs font-mono w-8">{i + 1}</td>
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              {v.thumbnail ? <img src={v.thumbnail} className="h-7 w-11 object-cover rounded shrink-0" alt="" /> :
                                <div className="h-7 w-11 bg-muted rounded flex items-center justify-center shrink-0"><Video className="h-3 w-3 text-muted-foreground" /></div>}
                              <span className="font-medium truncate max-w-48">{v.title}</span>
                            </div>
                          </td>
                          <td className="py-2.5">
                            <Badge variant={v.type === "premium" ? "default" : "secondary"} className="text-xs">{v.type}</Badge>
                          </td>
                          <td className="py-2.5 text-right tabular-nums">{(v.views ?? 0).toLocaleString("id-ID")}</td>
                          <td className="py-2.5 text-right tabular-nums text-pink-500">{(v.likes ?? 0).toLocaleString("id-ID")}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
