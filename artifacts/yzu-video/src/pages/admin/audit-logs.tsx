import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, fmtDateTime } from "@/lib/admin-api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronLeft, ChevronRight, Search, ShieldCheck, RefreshCw } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  login: "bg-green-500/10 text-green-600",
  logout: "bg-gray-500/10 text-gray-600",
  upload_video: "bg-blue-500/10 text-blue-600",
  delete_video: "bg-red-500/10 text-red-600",
  approve_payment: "bg-green-500/10 text-green-600",
  deny_payment: "bg-red-500/10 text-red-600",
  approve_withdrawal: "bg-green-500/10 text-green-600",
  reject_withdrawal: "bg-red-500/10 text-red-600",
  create_withdrawal: "bg-orange-500/10 text-orange-600",
  change_role: "bg-purple-500/10 text-purple-600",
  ban_user: "bg-red-500/10 text-red-600",
};

export default function AdminAuditLogs() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["audit-logs", search, page],
    queryFn: () => adminFetch(`/audit-logs?action=${search}&page=${page}&limit=30`),
    placeholderData: (prev) => prev,
  });

  const logs = (data as any)?.data ?? [];
  const total = (data as any)?.total ?? 0;
  const totalPages = Math.ceil(total / 30);

  return (
    <ProtectedRoute allowedRoles={["owner"]}>
      <AdminLayout>
        <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Audit Log</h1>
              <p className="text-sm text-muted-foreground">{total} aktivitas tercatat</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Filter aksi..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          </div>

          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 text-left font-medium text-muted-foreground">Waktu</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">User</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Aksi</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">Entitas</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Detail</th>
                    <th className="p-3 text-left font-medium text-muted-foreground hidden xl:table-cell">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading
                    ? Array(10).fill(0).map((_, i) => <tr key={i}><td colSpan={6} className="p-3"><Skeleton className="h-8 w-full" /></td></tr>)
                    : logs.length === 0
                    ? (
                      <tr><td colSpan={6} className="py-16 text-center text-muted-foreground">
                        <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p>Tidak ada log aktivitas</p>
                      </td></tr>
                    )
                    : logs.map((log: any) => {
                      let details = "";
                      try { details = log.details ? JSON.stringify(JSON.parse(log.details), null, 0).slice(0, 60) : ""; } catch { details = log.details ?? ""; }
                      return (
                        <tr key={log.id} className="hover:bg-muted/20">
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(log.createdAt)}</td>
                          <td className="p-3">
                            {log.user ? (
                              <div className="flex items-center gap-2">
                                <Avatar className="h-6 w-6 shrink-0">
                                  <AvatarFallback className="text-xs">{log.user.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium leading-none">{log.user.username}</p>
                                  <Badge variant="outline" className="text-[10px] h-4 px-1 mt-0.5">{log.user.role}</Badge>
                                </div>
                              </div>
                            ) : <span className="text-muted-foreground text-xs">System</span>}
                          </td>
                          <td className="p-3">
                            <Badge className={`border-0 text-xs ${ACTION_COLORS[log.action] ?? "bg-muted text-muted-foreground"}`}>
                              {log.action.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="p-3 hidden md:table-cell text-xs text-muted-foreground">
                            {log.entity && <span>{log.entity}{log.entityId ? ` #${log.entityId}` : ""}</span>}
                          </td>
                          <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground font-mono max-w-48 truncate">{details || "—"}</td>
                          <td className="p-3 hidden xl:table-cell text-xs text-muted-foreground font-mono">{log.ipAddress ?? "—"}</td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Halaman {page} dari {totalPages} ({total} total)</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
