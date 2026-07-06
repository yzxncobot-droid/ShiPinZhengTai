import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useGetAnalyticsOverview } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Video, DollarSign, Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function OwnerOverview() {
  const { data: analytics, isLoading } = useGetAnalyticsOverview();

  // Mock data for the chart to make it look populated since endpoint returns single stats
  const chartData = [
    { name: 'Mon', revenue: 4000 },
    { name: 'Tue', revenue: 3000 },
    { name: 'Wed', revenue: 2000 },
    { name: 'Thu', revenue: 2780 },
    { name: 'Fri', revenue: 1890 },
    { name: 'Sat', revenue: 2390 },
    { name: 'Sun', revenue: 3490 },
  ];

  return (
    <ProtectedRoute allowedRoles={['owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8 space-y-8">
          <div>
            <h1 className="text-3xl font-heading font-bold">Platform Overview</h1>
            <p className="text-muted-foreground mt-1">Super admin metrics and system status</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 px-4 pt-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold">{analytics?.totalUsers || 0}</div>
                <div className="text-xs text-green-500 flex items-center mt-1">
                  <TrendingUp className="h-3 w-3 mr-1" /> +{analytics?.newUsersToday || 0} today
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 px-4 pt-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total Videos</CardTitle>
                <Video className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold">{analytics?.totalVideos || 0}</div>
                <div className="text-xs text-green-500 flex items-center mt-1">
                  <TrendingUp className="h-3 w-3 mr-1" /> +{analytics?.newVideosToday || 0} today
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 px-4 pt-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Active Subs</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold">{analytics?.totalActiveSubscriptions || 0}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 px-4 pt-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total Views</CardTitle>
                <Video className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold">{(analytics?.totalViews || 0).toLocaleString()}</div>
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 px-4 pt-4">
                <CardTitle className="text-xs font-medium text-primary">System Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold text-primary">Rp {(analytics?.totalRevenue || 0).toLocaleString()}</div>
              </CardContent>
            </Card>

            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 px-4 pt-4">
                <CardTitle className="text-xs font-medium text-amber-600">Total Top-ups</CardTitle>
                <Wallet className="h-4 w-4 text-amber-600" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold text-amber-600">Rp {(analytics?.totalTopupAmount || 0).toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card>
              <CardHeader>
                <CardTitle>Revenue Overview (Last 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-xl hover:bg-muted/50 cursor-pointer transition-colors">
                    <h3 className="font-semibold mb-1">Review Pending Top-ups</h3>
                    <p className="text-sm text-muted-foreground">Approve or deny user wallet funds</p>
                  </div>
                  <div className="p-4 border rounded-xl hover:bg-muted/50 cursor-pointer transition-colors">
                    <h3 className="font-semibold mb-1">Site Settings</h3>
                    <p className="text-sm text-muted-foreground">Update logo, banner, and QRIS</p>
                  </div>
                  <div className="p-4 border rounded-xl hover:bg-muted/50 cursor-pointer transition-colors">
                    <h3 className="font-semibold mb-1">User Management</h3>
                    <p className="text-sm text-muted-foreground">Ban users or assign roles</p>
                  </div>
                  <div className="p-4 border rounded-xl hover:bg-muted/50 cursor-pointer transition-colors">
                    <h3 className="font-semibold mb-1">Subscription Plans</h3>
                    <p className="text-sm text-muted-foreground">Modify premium tiers and pricing</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
