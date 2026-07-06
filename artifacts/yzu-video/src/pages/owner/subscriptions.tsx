import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useListSubscriptions, useCreateSubscription, useUpdateSubscription, useDeleteSubscription, getListSubscriptionsQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Crown, CheckCircle2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function OwnerSubscriptions() {
  const { data: plans, isLoading } = useListSubscriptions();
  const createSub = useCreateSubscription();
  const updateSub = useUpdateSubscription();
  const deleteSub = useDeleteSubscription();
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  // Form State
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState<string>("0");
  const [duration, setDuration] = useState<string>("30");
  const [isActive, setIsActive] = useState(true);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDesc("");
    setPrice("0");
    setDuration("30");
    setIsActive(true);
  };

  const openAdd = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (plan: any) => {
    setEditingId(plan.id);
    setName(plan.name);
    setDesc(plan.description || "");
    setPrice(plan.price.toString());
    setDuration(plan.durationDays.toString());
    setIsActive(plan.isActive);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload = {
      name,
      description: desc,
      price: Number(price),
      durationDays: Number(duration),
      isActive
    };

    if (editingId) {
      updateSub.mutate({ id: editingId, data: payload }, {
        onSuccess: () => {
          toast({ title: "Plan updated successfully" });
          setIsModalOpen(false);
          queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
        }
      });
    } else {
      createSub.mutate({ data: payload }, {
        onSuccess: () => {
          toast({ title: "Plan created successfully" });
          setIsModalOpen(false);
          queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
        }
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure? Users with this active plan won't be affected until expiration, but it will be hidden from new purchases.")) {
      deleteSub.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Plan deleted" });
          queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
        }
      });
    }
  };

  return (
    <ProtectedRoute allowedRoles={['owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8 max-w-6xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-heading font-bold">Subscription Plans</h1>
              <p className="text-muted-foreground mt-1">Configure premium membership tiers</p>
            </div>
            
            <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> New Plan</Button>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Plan Details</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8">Loading plans...</TableCell>
                    </TableRow>
                  ) : plans?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No subscription plans found. Create one!</TableCell>
                    </TableRow>
                  ) : (
                    plans?.map((plan) => (
                      <TableRow key={plan.id} className={!plan.isActive ? "opacity-60" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                              <Crown className="h-5 w-5 text-amber-500" />
                            </div>
                            <div>
                              <p className="font-heading font-semibold text-lg">{plan.name}</p>
                              <p className="text-sm text-muted-foreground line-clamp-1 max-w-md">{plan.description}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-bold text-base">
                          Rp {plan.price.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {plan.durationDays} days
                        </TableCell>
                        <TableCell>
                          {plan.isActive ? (
                            <span className="inline-flex items-center text-green-500 text-sm font-medium"><CheckCircle2 className="mr-1 h-4 w-4" /> Active</span>
                          ) : (
                            <span className="inline-flex items-center text-muted-foreground text-sm font-medium"><XCircle className="mr-1 h-4 w-4" /> Inactive</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-500/10" onClick={() => openEdit(plan)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(plan.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit Plan" : "Create Subscription Plan"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-6 pt-4">
                <div className="space-y-2">
                  <Label>Plan Name</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Premium Monthly" autoFocus />
                </div>
                
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Features included..." className="h-20 resize-none" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Price (Rp)</Label>
                    <Input type="number" value={price} onChange={e => setPrice(e.target.value)} min="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Duration (Days)</Label>
                    <Input type="number" value={duration} onChange={e => setDuration(e.target.value)} min="1" />
                  </div>
                </div>

                <div className="flex items-center justify-between border rounded-xl p-4">
                  <div className="space-y-0.5">
                    <Label className="text-base">Active Status</Label>
                    <p className="text-sm text-muted-foreground">Visible to users for purchase</p>
                  </div>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={!name.trim() || createSub.isPending || updateSub.isPending}>
                    {editingId ? "Update Plan" : "Create Plan"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
