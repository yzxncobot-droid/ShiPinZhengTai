import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useGetWatchHistory, useListTransactions, useListMyTopups } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, CreditCard, Wallet, CalendarClock, Clock } from "lucide-react";
import { VideoCard, VideoCardSkeleton } from "@/components/video/VideoCard";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export default function HistoryPage() {
  const { data: watchHistory, isLoading: loadingHistory } = useGetWatchHistory({ limit: 12 });
  const { data: transactions, isLoading: loadingTx } = useListTransactions({ limit: 20 });
  const { data: topups, isLoading: loadingTopups } = useListMyTopups({ limit: 20 });

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
                      ) : topups?.data.length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">No top-ups found.</td></tr>
                      ) : (
                        topups?.data.map((topup: any) => (
                          <tr key={topup.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">{format(new Date(topup.createdAt), 'MMM dd, yyyy')}</td>
                            <td className="px-6 py-4 font-medium">Rp {topup.amount.toLocaleString()}</td>
                            <td className="px-6 py-4">
                              <Badge variant="outline" className={
                                topup.status === 'confirmed' ? 'text-green-500 bg-green-500/10 border-none' : 
                                topup.status === 'denied' ? 'text-red-500 bg-red-500/10 border-none' : 
                                'text-amber-500 bg-amber-500/10 border-none'
                              }>
                                {topup.status}
                              </Badge>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {topup.paymentProof ? (
                                <a href={topup.paymentProof} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">
                                  View Image
                                </a>
                              ) : '-'}
                            </td>
                          </tr>
                        ))
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
