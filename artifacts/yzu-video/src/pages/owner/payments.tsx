import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useListAllTopups, useConfirmTopup, useDenyTopup, getListAllTopupsQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Search, Eye } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function OwnerPayments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  const { data: topups, isLoading } = useListAllTopups({ 
    status: statusFilter === "all" ? undefined : statusFilter as any,
    limit: 50 
  });
  
  const confirmTopup = useConfirmTopup();
  const denyTopup = useDenyTopup();

  const handleAction = (id: number, action: 'confirm' | 'deny') => {
    const mutation = action === 'confirm' ? confirmTopup : denyTopup;
    mutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: `Top-up ${action}ed successfully` });
        queryClient.invalidateQueries({ queryKey: getListAllTopupsQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: "Action failed", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <ProtectedRoute allowedRoles={['owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-heading font-bold">Payments & Top-ups</h1>
              <p className="text-muted-foreground mt-1">Review and manage user wallet funding</p>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px] bg-background">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending Only</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Proof</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Loading top-ups...</TableCell>
                    </TableRow>
                  ) : topups?.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        No top-ups found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    topups?.data.map((topup) => (
                      <TableRow key={topup.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(topup.createdAt), 'MMM dd, yyyy HH:mm')}
                        </TableCell>
                        <TableCell className="font-medium">
                          {topup.user?.username} <span className="text-muted-foreground text-xs ml-1">({topup.user?.email})</span>
                        </TableCell>
                        <TableCell className="font-bold">
                          Rp {topup.amount.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {topup.paymentProof ? (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 gap-2">
                                  <Eye className="h-3 w-3" /> View Receipt
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl bg-black/90 border-border p-0 overflow-hidden">
                                <div className="p-4 bg-background border-b flex justify-between items-center">
                                  <DialogTitle>Payment Receipt</DialogTitle>
                                </div>
                                <div className="p-4 flex justify-center bg-black/50">
                                  <img src={topup.paymentProof} alt="Receipt" className="max-h-[70vh] object-contain rounded" />
                                </div>
                              </DialogContent>
                            </Dialog>
                          ) : (
                            <span className="text-muted-foreground text-sm italic">No image</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            topup.status === 'confirmed' ? 'text-green-500 bg-green-500/10 border-none' : 
                            topup.status === 'denied' ? 'text-red-500 bg-red-500/10 border-none' : 
                            'text-amber-500 bg-amber-500/10 border-none'
                          }>
                            {topup.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {topup.status === 'pending' && (
                            <div className="flex justify-end gap-2">
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-8 bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20 hover:text-green-700"
                                onClick={() => handleAction(topup.id, 'confirm')}
                                disabled={confirmTopup.isPending || denyTopup.isPending}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-8 bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/20 hover:text-red-700"
                                onClick={() => handleAction(topup.id, 'deny')}
                                disabled={confirmTopup.isPending || denyTopup.isPending}
                              >
                                <XCircle className="h-4 w-4 mr-1" /> Deny
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
