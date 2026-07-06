import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useGetAdminStats, useGetVideoAnalytics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Video, Eye, ThumbsUp, DollarSign } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";

export default function AdminDashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useGetAdminStats();
  const { data: videos, isLoading: videosLoading } = useGetVideoAnalytics();

  return (
    <ProtectedRoute>
      <AdminLayout>
        <div className="p-6 md:p-8 space-y-8">
          <div>
            <h1 className="text-3xl font-heading font-bold">Welcome back, {user?.username}</h1>
            <p className="text-muted-foreground mt-1">Here's an overview of your creator channel.</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Videos</CardTitle>
                <Video className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats?.totalVideos || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Views</CardTitle>
                <Eye className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats?.totalViews.toLocaleString() || 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Likes</CardTitle>
                <ThumbsUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats?.totalLikes.toLocaleString() || 0}</div>
              </CardContent>
            </Card>
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-primary">Est. Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary">Rp {stats?.totalRevenue.toLocaleString() || 0}</div>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Video Performance (Views)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[350px] w-full mt-4">
                {videosLoading ? (
                  <div className="w-full h-full bg-muted/20 animate-pulse rounded-lg flex items-center justify-center">Loading chart...</div>
                ) : !videos || videos.length === 0 ? (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">No data to display</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={videos} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="title" 
                        tickFormatter={(value) => value.length > 15 ? `${value.substring(0, 15)}...` : value}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => value >= 1000 ? `${(value/1000).toFixed(1)}k` : value}
                      />
                      <RechartsTooltip 
                        cursor={{ fill: 'hsl(var(--muted))' }}
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      />
                      <Bar dataKey="views" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={50} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
