import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fmtDateTime } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Bell, Plus, CheckCheck, Trash2, RefreshCw } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  system: "Sistem", topup: "Top-up", subscription: "Langganan", video: "Video", general: "Umum",
};
const TYPE_COLORS: Record<string, string> = {
  system: "bg-gray-500/10 text-gray-600",
  topup: "bg-green-500/10 text-green-600",
  subscription: "bg-purple-500/10 text-purple-600",
  video: "bg-blue-500/10 text-blue-600",
  general: "bg-orange-500/10 text-orange-600",
};

export default function AdminNotifications() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", message: "", type: "system" });

  const { data: notifs, isLoading, refetch } = useQuery({
    queryKey: ["admin-notifs"],
    queryFn: () => adminFetch("/notifications"),
  });

  const markAllMut = useMutation({
    mutationFn: () => adminFetch("/notifications/read-all", { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-notifs"] }); toast({ title: "Semua notifikasi ditandai terbaca" }); },
  });

  const markOneMut = useMutation({
    mutationFn: (id: number) => adminFetch(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-notifs"] }),
  });

  const list = Array.isArray(notifs) ? notifs : [];
  const unread = list.filter((n: any) => !n.isRead).length;

  return (
    <ProtectedRoute allowedRoles={["admin", "owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Notifikasi</h1>
              <p className="text-sm text-muted-foreground">{unread} belum dibaca dari {list.length} total</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => markAllMut.mutate()} disabled={unread === 0}>
                <CheckCheck className="h-4 w-4" />Tandai Semua
              </Button>
              <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
          ) : list.length === 0 ? (
            <div className="py-24 text-center text-muted-foreground">
              <Bell className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p>Tidak ada notifikasi</p>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((n: any) => (
                <div
                  key={n.id}
                  className={`p-4 rounded-xl border transition-all cursor-pointer hover:shadow-sm ${!n.isRead ? "bg-card border-primary/20" : "bg-card/50"}`}
                  onClick={() => !n.isRead && markOneMut.mutate(n.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${!n.isRead ? "bg-primary" : "bg-transparent"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-medium text-sm">{n.title}</p>
                        <Badge className={`border-0 text-xs ${TYPE_COLORS[n.type] ?? TYPE_COLORS.general}`}>
                          {TYPE_LABELS[n.type] ?? n.type}
                        </Badge>
                        {!n.isRead && <Badge className="bg-primary/10 text-primary border-0 text-xs">Baru</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{n.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">{fmtDateTime(n.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
