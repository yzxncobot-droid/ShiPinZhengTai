import { useState } from "react";
import { Route, Switch, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { initApiClient } from "@/lib/protected-route";
import NotFound from "@/pages/not-found";

// Pages
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
// Admin Pages
import AdminDashboard from "@/pages/admin/dashboard";
import AdminVideos from "@/pages/admin/videos";
import AdminUploadVideo from "@/pages/admin/upload";
// Owner Pages
import OwnerOverview from "@/pages/owner/dashboard";
import OwnerPayments from "@/pages/owner/payments";
import OwnerSettings from "@/pages/owner/settings";
import OwnerCategories from "@/pages/owner/categories";
import OwnerUsers from "@/pages/owner/users";
import OwnerSubscriptions from "@/pages/owner/subscriptions";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Initialize API client to hook into localStorage token
initApiClient();

function AppRouter() {
  return (
    <Switch>
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
      
      {/* Admin routes */}
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/videos" component={AdminVideos} />
      <Route path="/admin/upload" component={AdminUploadVideo} />
      
      {/* Owner routes */}
      <Route path="/owner" component={OwnerOverview} />
      <Route path="/owner/videos" component={AdminVideos} />
      <Route path="/owner/categories" component={OwnerCategories} />
      <Route path="/owner/users" component={OwnerUsers} />
      <Route path="/owner/subscriptions" component={OwnerSubscriptions} />
      <Route path="/owner/payments" component={OwnerPayments} />
      <Route path="/owner/settings" component={OwnerSettings} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AppRouter />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
