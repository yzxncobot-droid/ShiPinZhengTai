import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useListUsers, useUpdateUserRole, useUpdateUserWallet, useBanUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Search, ShieldAlert, Wallet, Shield, Ban, ShieldCheck, MoreHorizontal } from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function OwnerUsers() {
  const [search, setSearch] = useState("");
  const { data: users, isLoading } = useListUsers({ search, limit: 50 });
  
  const updateRole = useUpdateUserRole();
  const updateWallet = useUpdateUserWallet();
  const banUser = useBanUser();
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Wallet Modal State
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [walletAmount, setWalletAmount] = useState<string>("");
  const [walletReason, setWalletReason] = useState("");

  const handleRoleChange = (id: number, newRole: 'user' | 'admin' | 'owner') => {
    if (confirm(`Change user role to ${newRole.toUpperCase()}?`)) {
      updateRole.mutate({ id, data: { role: newRole } }, {
        onSuccess: () => {
          toast({ title: "Role updated" });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        }
      });
    }
  };

  const handleBanToggle = (id: number, isCurrentlyBanned: boolean) => {
    banUser.mutate({ id, data: { banned: !isCurrentlyBanned } }, {
      onSuccess: () => {
        toast({ title: `User ${!isCurrentlyBanned ? 'banned' : 'unbanned'} successfully` });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      }
    });
  };

  const openWalletModal = (id: number) => {
    setSelectedUserId(id);
    setWalletAmount("");
    setWalletReason("");
    setWalletModalOpen(true);
  };

  const submitWalletAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !walletAmount) return;

    updateWallet.mutate({ id: selectedUserId, data: { amount: Number(walletAmount), reason: walletReason || "Admin adjustment" } }, {
      onSuccess: () => {
        toast({ title: "Wallet adjusted successfully" });
        setWalletModalOpen(false);
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      }
    });
  };

  return (
    <ProtectedRoute allowedRoles={['owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-heading font-bold">User Management</h1>
              <p className="text-muted-foreground mt-1">Manage accounts, roles, and balances</p>
            </div>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border/50">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search by username or email..." 
                  className="pl-9 bg-background"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Loading users...</TableCell>
                    </TableRow>
                  ) : users?.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No users found.</TableCell>
                    </TableRow>
                  ) : (
                    users?.data.map((u) => (
                      <TableRow key={u.id} className={u.isBanned ? "opacity-60 bg-destructive/5" : ""}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">{u.username}</span>
                            <span className="text-xs text-muted-foreground">{u.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            u.role === 'owner' ? 'border-primary text-primary' :
                            u.role === 'admin' ? 'border-blue-500 text-blue-500' : ''
                          }>
                            {u.role.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          Rp {(u.walletBalance || 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {u.isBanned ? (
                            <Badge variant="destructive" className="border-none"><Ban className="h-3 w-3 mr-1" /> Banned</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-none">Active</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(u.createdAt), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem className="cursor-pointer" onClick={() => openWalletModal(u.id)}>
                                <Wallet className="mr-2 h-4 w-4" /> Adjust Balance
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>Change Role</DropdownMenuLabel>
                              <DropdownMenuItem className="cursor-pointer" onClick={() => handleRoleChange(u.id, 'user')} disabled={u.role === 'user'}>
                                <Shield className="mr-2 h-4 w-4" /> Make User
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer" onClick={() => handleRoleChange(u.id, 'admin')} disabled={u.role === 'admin'}>
                                <ShieldCheck className="mr-2 h-4 w-4 text-blue-500" /> Make Admin
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer" onClick={() => handleRoleChange(u.id, 'owner')} disabled={u.role === 'owner'}>
                                <ShieldAlert className="mr-2 h-4 w-4 text-primary" /> Make Owner
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="cursor-pointer focus:bg-destructive/10 text-destructive"
                                onClick={() => handleBanToggle(u.id, u.isBanned)}
                              >
                                <Ban className="mr-2 h-4 w-4" /> {u.isBanned ? 'Unban User' : 'Ban User'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Wallet Adjustment Dialog */}
          <Dialog open={walletModalOpen} onOpenChange={setWalletModalOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Adjust Wallet Balance</DialogTitle>
              </DialogHeader>
              <form onSubmit={submitWalletAdjust} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Adjustment Amount (+ or -)</Label>
                  <Input 
                    type="number" 
                    value={walletAmount} 
                    onChange={e => setWalletAmount(e.target.value)} 
                    placeholder="e.g. 50000 or -10000" 
                    autoFocus 
                  />
                  <p className="text-xs text-muted-foreground">Use negative numbers to deduct balance.</p>
                </div>
                <div className="space-y-2">
                  <Label>Reason / Note</Label>
                  <Input 
                    value={walletReason} 
                    onChange={e => setWalletReason(e.target.value)} 
                    placeholder="e.g. Refund for failed video load" 
                  />
                </div>
                <DialogFooter className="pt-4">
                  <Button type="button" variant="ghost" onClick={() => setWalletModalOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={!walletAmount || updateWallet.isPending}>
                    {updateWallet.isPending ? "Applying..." : "Apply Adjustment"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
