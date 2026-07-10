import { Route, Switch, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { initApiClient } from "@/lib/protected-route";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";

// Public pages
import Home from "@/pages/home";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Subscriptions from "@/pages/subscriptions";
import TopupPage from "@/pages/topup";
import HistoryPage from "@/pages/history";
import LeaderboardPage from "@/pages/leaderboard";
import ProfilePage from "@/pages/profile";
import NotificationsPage from "@/pages/notifications";
import SearchPage from "@/pages/search";
import VideoDetailPage from "@/pages/videos/detail";
import DebugUploadPage from "@/pages/debug-upload";

// Admin Pages (unified admin + owner panel)
import AdminDashboard from "@/pages/admin/dashboard";
import AdminVideos from "@/pages/admin/videos";
import AdminUploadVideo from "@/pages/admin/upload";
import AdminCategories from "@/pages/admin/categories";
import AdminUsers from "@/pages/admin/users";
import AdminPayments from "@/pages/admin/payments";
import AdminSubscriptions from "@/pages/admin/subscriptions";
import AdminRevenue from "@/pages/admin/revenue";
import AdminAnalytics from "@/pages/admin/analytics-page";
import AdminWithdrawals from "@/pages/admin/withdrawals";
import AdminWallet from "@/pages/admin/wallet";
import AdminSettings from "@/pages/admin/settings";
import AdminAuditLogs from "@/pages/admin/audit-logs";
import AdminSystem from "@/pages/admin/system";
import AdminNotifications from "@/pages/admin/notifications-mgmt";
import AdminReports from "@/pages/admin/reports";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

initApiClient();

function AppRouter() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/subscriptions" component={Subscriptions} />
      <Route path="/topup" component={TopupPage} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/leaderboard" component={LeaderboardPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/videos/:id" component={VideoDetailPage} />
      <Route path="/debug-upload" component={DebugUploadPage} />

      {/* Unified Admin / Owner Panel */}
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/videos" component={AdminVideos} />
      <Route path="/admin/upload" component={AdminUploadVideo} />
      <Route path="/admin/categories" component={AdminCategories} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/payments" component={AdminPayments} />
      <Route path="/admin/subscriptions" component={AdminSubscriptions} />
      <Route path="/admin/revenue" component={AdminRevenue} />
      <Route path="/admin/analytics" component={AdminAnalytics} />
      <Route path="/admin/withdrawals" component={AdminWithdrawals} />
      <Route path="/admin/wallet" component={AdminWallet} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route path="/admin/audit-logs" component={AdminAuditLogs} />
      <Route path="/admin/system" component={AdminSystem} />
      <Route path="/admin/notifications-mgmt" component={AdminNotifications} />
      <Route path="/admin/reports" component={AdminReports} />

      {/* Legacy /owner/* → redirect to /admin/* equivalents */}
      <Route path="/owner" component={AdminDashboard} />
      <Route path="/owner/videos" component={AdminVideos} />
      <Route path="/owner/categories" component={AdminCategories} />
      <Route path="/owner/users" component={AdminUsers} />
      <Route path="/owner/payments" component={AdminPayments} />
      <Route path="/owner/subscriptions" component={AdminSubscriptions} />
      <Route path="/owner/settings" component={AdminSettings} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ErrorBoundary>
              <AppRouter />
            </ErrorBoundary>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
