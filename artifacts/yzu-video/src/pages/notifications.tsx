import { ProtectedRoute } from "@/lib/protected-route";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, getListNotificationsQueryKey } from "@workspace/api-client-react";
import { Bell, CheckCircle2, Info, AlertTriangle, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function NotificationsPage() {
  const { data: notifications, isLoading } = useListNotifications();
  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleMarkAll = () => {
    markAll.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
        toast({ title: "All caught up!" });
      }
    });
  };

  const handleMarkOne = (id: number) => {
    markOne.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      }
    });
  };

  const getIcon = (type: string | undefined) => {
    switch(type) {
      case 'success': return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case 'promo': return <Gift className="h-5 w-5 text-primary" />;
      default: return <Info className="h-5 w-5 text-blue-500" />;
    }
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="container mx-auto px-4 md:px-6 py-12 max-w-3xl">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-heading font-bold flex items-center gap-3">
              <Bell className="h-8 w-8 text-primary" /> Notifications
            </h1>
            <Button variant="outline" size="sm" onClick={handleMarkAll} disabled={markAll.isPending || !notifications?.length}>
              Mark all as read
            </Button>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-12 text-center text-muted-foreground animate-pulse">Loading notifications...</div>
            ) : !notifications?.length ? (
              <div className="p-16 flex flex-col items-center justify-center text-center">
                <Bell className="h-16 w-16 text-muted-foreground/20 mb-4" />
                <h3 className="text-xl font-heading font-semibold text-foreground mb-2">You're all caught up!</h3>
                <p className="text-muted-foreground">There are no new notifications right now.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {notifications.map((notif) => (
                  <div 
                    key={notif.id} 
                    className={`p-4 md:p-6 flex gap-4 transition-colors ${!notif.isRead ? 'bg-muted/30' : 'opacity-70'}`}
                    onClick={() => !notif.isRead && handleMarkOne(notif.id)}
                  >
                    <div className="mt-1 shrink-0">
                      {getIcon(notif.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-4 mb-1">
                        <h4 className={`font-semibold ${!notif.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {notif.title}
                        </h4>
                        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                          {formatDistanceToNow(new Date(notif.createdAt))} ago
                        </span>
                      </div>
                      <p className={`text-sm ${!notif.isRead ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                        {notif.message}
                      </p>
                    </div>
                    {!notif.isRead && (
                      <div className="shrink-0 flex items-center">
                        <div className="h-2 w-2 bg-primary rounded-full" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
