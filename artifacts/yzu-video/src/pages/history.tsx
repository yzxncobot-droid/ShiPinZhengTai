import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import {
  useGetWatchHistory, useListTransactions, useListMyTopups,
  getListMyTopupsQueryKey, getGetMeQueryKey,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, CreditCard, Wallet, CalendarClock, Clock, RefreshCw, X, Loader2 } from "lucide-react";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

function topupStatusInfo(status: string) {
  switch (status) {
    case "paid":
    case "confirmed":
      return { label: "Berhasil", cls: "text-green-500 bg-green-500/10 border-none" };
    case "pending":
      return { label: "Menunggu", cls: "text-amber-500 bg-amber-500/10 border-none" };
    case "awaiting_confirmation":
      return { label: "Menunggu Verifikasi", cls: "text-blue-500 bg-blue-500/10 border-none" };
    case "denied":
    case "failed":
      return { label: "Ditolak", cls: "text-red-500 bg-red-500/10 border-none" };
    case "expired":
      return { label: "Kedaluwarsa", cls: "text-slate-500 bg-slate-500/10 border-none" };
    case "cancelled":
      return { label: "Dibatalkan", cls: "text-slate-500 bg-slate-500/10 border-none" };
    default:
      return { label: status, cls: "text-amber-500 bg-amber-500/10 border-none" };
  }
}

export default function HistoryPage() {
  const { data: watchHistory, isLoading: loadingHistory } = useGetWatchHistory({ limit: 12 });
  const { data: transactions, isLoading: loadingTx } = useListTransactions({ limit: 20 });
  const { data: topups, isLoading: loadingTopups } = useListMyTopups({ limit: 20 });

  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const topupList: any[] = (topups as any)?.data ?? [];

  // Sync active top-ups with TemanQRIS: read each pending/awaiting order's
  // real gateway status (which also auto-credits if paid) then refetch.
  const syncWithTemanqris = async () => {
    setSyncing(true);
    try {
      const active = topupList.filter((t) => ["pending", "awaiting_confirmation"].includes(t.status));
      await Promise.all(active.map((t) =>
        fetch(`/api/topup/${t.id}/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }).then((r) => r.json()).catch(() => null),
      ));
      await queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey({ limit: 20 }) });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "Data tersinkron", description: "Status top-up diperbarui dari TemanQRIS." });
    } catch (e: any) {
      toast({ title: "Gagal sinkron", description: e?.message ?? "Coba lagi.", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const cancelTopup = async (id: string) => {
    setCancellingId(id);
    try {
      const r = await fetch(`/api/topup/${id}/cancel`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? result.message ?? "Gagal membatalkan.");
      toast({ title: "Pembayaran dibatalkan", description: "Transaksi dibatalkan dan QRIS dinonaktifkan." });
      await queryClient.invalidateQueries({ queryKey: getListMyTopupsQueryKey({ limit: 20 }) });
    } catch (e: any) {
      toast({ title: "Gagal membatalkan", description: e?.message ?? "Coba lagi.", variant: "destructive" });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="container mx-auto px-4 md:px-6 py-12 max-w-6xl">
          <div className="mb-10">
            <h1 className="text-3xl font-heading font-bold flex items-center gap-3">
              <History className="h-8 w-8 text-primary" /> Activity History
            </h1>
            <p className="text-muted-foreground mt-2">Manage your watch history and transactions</p>
          </div>

          <Tabs defaultValue="watch" className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-8 overflow-x-auto overflow-y-hidden">
              <TabsTrigger 
                value="watch" 
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 py-3 font-medium text-base"
              >
                <Clock className="mr-2 h-4 w-4" /> Watch History
              </TabsTrigger>
              <TabsTrigger 
                value="transactions" 
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 py-3 font-medium text-base"
              >
                <CreditCard className="mr-2 h-4 w-4" /> Transactions
              </TabsTrigger>
              <TabsTrigger 
                value="topups" 
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 py-3 font-medium text-base"
              >
                <Wallet className="mr-2 h-4 w-4" /> Top-ups
              </TabsTrigger>
            </TabsList>

            <TabsContent value="watch" className="mt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {loadingHistory ? (
                  Array(8).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
                ) : watchHistory?.data.length === 0 ? (
                  <div className="col-span-full py-20 text-center text-muted-foreground">
                    <CalendarClock className="h-16 w-16 mx-auto mb-4 opacity-20" />
                    <p>Your watch history is empty.</p>
                  </div>
                ) : (
                  watchHistory?.data.map((video: any) => (
                    <VideoCard key={video.id} video={video} />
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="transactions" className="mt-0">
              <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground border-b border-border/50">
                      <tr>
                        <th className="px-6 py-4 font-medium">Date</th>
                        <th className="px-6 py-4 font-medium">Description</th>
                        <th className="px-6 py-4 font-medium">Type</th>
                        <th className="px-6 py-4 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {loadingTx ? (
                        <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
                      ) : transactions?.data.length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">No transactions found.</td></tr>
                      ) : (
                        transactions?.data.map((tx: any) => (
                          <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">{format(new Date(tx.createdAt), 'MMM dd, yyyy HH:mm')}</td>
                            <td className="px-6 py-4">{tx.description}</td>
                            <td className="px-6 py-4 capitalize">
                              <Badge variant="outline" className={
                                tx.type === 'topup' ? 'text-green-500 bg-green-500/10 border-none' : 
                                tx.type === 'purchase' ? 'text-amber-500 bg-amber-500/10 border-none' : 
                                'text-blue-500 bg-blue-500/10 border-none'
                              }>
                                {tx.type}
                              </Badge>
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-right font-medium ${tx.amount > 0 ? 'text-green-500' : 'text-foreground'}`}>
                              {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="topups" className="mt-0">
              <div className="flex items-center justify-between mb-4 gap-3">
                <p className="text-sm text-muted-foreground hidden sm:block">Status top-up aktif disinkron dari TemanQRIS.</p>
                <Button variant="outline" size="sm" onClick={syncWithTemanqris} disabled={syncing} className="gap-1.5 ml-auto">
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sinkronkan TemanQRIS
                </Button>
              </div>
              <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground border-b border-border/50">
                      <tr>
                        <th className="px-6 py-4 font-medium">Date</th>
                        <th className="px-6 py-4 font-medium">Amount</th>
                        <th className="px-6 py-4 font-medium">Status</th>
                        <th className="px-6 py-4 font-medium text-center">Proof</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {loadingTopups ? (
                        <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
                      ) : topupList.length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">No top-ups found.</td></tr>
                      ) : (
                        topupList.map((topup: any) => {
                          const info = topupStatusInfo(topup.status);
                          const canCancel = topup.status === "pending" || topup.status === "awaiting_confirmation";
                          return (
                            <tr key={topup.id} className="hover:bg-muted/30 transition-colors">
                              <td className="px-6 py-4 whitespace-nowrap">{format(new Date(topup.createdAt), 'MMM dd, yyyy')}</td>
                              <td className="px-6 py-4 font-medium">Rp {topup.amount.toLocaleString()}</td>
                              <td className="px-6 py-4 align-top">
                                <Badge variant="outline" className={info.cls}>{info.label}</Badge>
                                {canCancel && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => cancelTopup(topup.id)}
                                    disabled={cancellingId === topup.id}
                                    className="mt-2 h-7 px-2 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 block"
                                  >
                                    {cancellingId === topup.id
                                      ? <Loader2 className="h-3 w-3 animate-spin mr-1 inline" />
                                      : <X className="h-3 w-3 mr-1 inline" />}
                                    Batalkan Pembayaran
                                  </Button>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {topup.paymentProof ? (
                                  <a href={topup.paymentProof} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">
                                    View Image
                                  </a>
                                ) : '-'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

          </Tabs>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
