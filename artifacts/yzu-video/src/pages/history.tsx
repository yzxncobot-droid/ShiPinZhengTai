import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useGetWatchHistory, useListTransactions, useListMyTopups } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, CreditCard, Wallet, CalendarClock, Clock, Eye, ExternalLink } from "lucide-react";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function HistoryPage() {
  const { data: watchHistory, isLoading: loadingHistory } = useGetWatchHistory({ limit: 12 });
  const { data: transactions, isLoading: loadingTx } = useListTransactions({ limit: 20 });
  const { data: topups, isLoading: loadingTopups } = useListMyTopups({ limit: 20 });
  const [selectedProof, setSelectedProof] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
      case "confirmed":
        return (
          <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10 border-emerald-200">
            Disetujui
          </Badge>
        );
      case "rejected":
      case "denied":
        return (
          <Badge variant="outline" className="text-rose-600 bg-rose-500/10 border-rose-200">
            Ditolak
          </Badge>
        );
      case "pending":
      case "awaiting_manual_review":
      case "awaiting_confirmation":
      default:
        return (
          <Badge variant="outline" className="text-amber-600 bg-amber-500/10 border-amber-200">
            Menunggu Verifikasi
          </Badge>
        );
    }
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="container mx-auto px-4 md:px-6 py-12 max-w-6xl">
          <div className="mb-10">
            <h1 className="text-3xl font-heading font-bold flex items-center gap-3">
              <History className="h-8 w-8 text-primary" /> Riwayat Aktivitas
            </h1>
            <p className="text-muted-foreground mt-2">Kelola riwayat tontonan dan transaksi akun Anda</p>
          </div>

          <Tabs defaultValue="topups" className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-8 overflow-x-auto overflow-y-hidden">
              <TabsTrigger 
                value="topups"
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 py-3 font-medium text-base"
              >
                <Wallet className="mr-2 h-4 w-4" /> Top Up Saldo
              </TabsTrigger>
              <TabsTrigger 
                value="transactions" 
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 py-3 font-medium text-base"
              >
                <CreditCard className="mr-2 h-4 w-4" /> Transaksi
              </TabsTrigger>
              <TabsTrigger 
                value="watch"
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 py-3 font-medium text-base"
              >
                <Clock className="mr-2 h-4 w-4" /> Riwayat Nonton
              </TabsTrigger>
            </TabsList>

            <TabsContent value="topups" className="mt-0">
              <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground border-b border-border/50">
                      <tr>
                        <th className="px-6 py-4 font-semibold">Tanggal Diajukan</th>
                        <th className="px-6 py-4 font-semibold">Nominal Top Up</th>
                        <th className="px-6 py-4 font-semibold">Status Pembayaran</th>
                        <th className="px-6 py-4 font-semibold text-center">Bukti Transfer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {loadingTopups ? (
                        <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Memuat data...</td></tr>
                      ) : topups?.data.length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">Belum ada riwayat top up.</td></tr>
                      ) : (
                        topups?.data.map((topup: any) => (
                          <tr key={topup.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-muted-foreground font-medium">
                              {format(new Date(topup.createdAt), "dd MMM yyyy, HH:mm")}
                            </td>
                            <td className="px-6 py-4 font-extrabold text-foreground">
                              Rp {topup.amount?.toLocaleString("id-ID")}
                            </td>
                            <td className="px-6 py-4">
                              {getStatusBadge(topup.status)}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {topup.paymentProof ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedProof(topup.paymentProof)}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                                >
                                  <Eye className="h-3.5 w-3.5" /> Lihat Bukti
                                </button>
                              ) : (
                                <span className="text-muted-foreground text-xs italic">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="transactions" className="mt-0">
              <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground border-b border-border/50">
                      <tr>
                        <th className="px-6 py-4 font-semibold">Tanggal</th>
                        <th className="px-6 py-4 font-semibold">Keterangan</th>
                        <th className="px-6 py-4 font-semibold">Jenis</th>
                        <th className="px-6 py-4 font-semibold text-right">Nominal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {loadingTx ? (
                        <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Memuat data...</td></tr>
                      ) : transactions?.data.length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">Belum ada transaksi.</td></tr>
                      ) : (
                        transactions?.data.map((tx: any) => (
                          <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">
                              {format(new Date(tx.createdAt), "dd MMM yyyy, HH:mm")}
                            </td>
                            <td className="px-6 py-4 font-medium">{tx.description}</td>
                            <td className="px-6 py-4 capitalize">
                              <Badge variant="outline" className={
                                tx.type === "topup" ? "text-emerald-600 bg-emerald-500/10 border-none" :
                                tx.type === "purchase" ? "text-amber-600 bg-amber-500/10 border-none" :
                                "text-blue-600 bg-blue-500/10 border-none"
                              }>
                                {tx.type === "topup" ? "Top Up" : tx.type === "purchase" ? "Pembelian" : tx.type}
                              </Badge>
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-right font-extrabold ${tx.amount > 0 ? "text-emerald-600" : "text-foreground"}`}>
                              {tx.amount > 0 ? "+" : ""}Rp {Math.abs(tx.amount).toLocaleString("id-ID")}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="watch" className="mt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {loadingHistory ? (
                  Array(8).fill(0).map((_, i) => <VideoCardSkeleton key={i} />)
                ) : watchHistory?.data.length === 0 ? (
                  <div className="col-span-full py-20 text-center text-muted-foreground">
                    <CalendarClock className="h-16 w-16 mx-auto mb-4 opacity-20" />
                    <p>Riwayat tontonan masih kosong.</p>
                  </div>
                ) : (
                  watchHistory?.data.map((video: any) => (
                    <VideoCard key={video.id} video={video} />
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* ── User Proof Preview Modal ── */}
        <Dialog open={!!selectedProof} onOpenChange={() => setSelectedProof(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Foto Bukti Pembayaran</DialogTitle>
            </DialogHeader>
            {selectedProof && (
              <div className="space-y-4">
                <div className="rounded-xl overflow-hidden border bg-muted/20 flex items-center justify-center p-2">
                  <img
                    src={selectedProof}
                    alt="Bukti pembayaran"
                    className="max-h-[60vh] object-contain rounded-lg"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => window.open(selectedProof, "_blank")}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Buka Ukuran Asli
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </AppLayout>
    </ProtectedRoute>
  );
}
