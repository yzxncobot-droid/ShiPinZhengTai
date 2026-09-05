import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useListCategories, useCreateCategory, useUpdateCategory, useDeleteCategory, getListCategoriesQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { FolderTree, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function OwnerCategories() {
  const { data: categories, isLoading } = useListCategories();
  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();
  const deleteCat = useDeleteCategory();
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    createCat.mutate({ data: { name: newCatName, description: newCatDesc } }, {
      onSuccess: () => {
        toast({ title: "Category created" });
        setIsAddOpen(false);
        setNewCatName("");
        setNewCatDesc("");
        queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
      }
    });
  };

  const startEdit = (cat: any) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDesc(cat.description || "");
  };

  const handleUpdate = (id: string) => {
    if (!editName.trim()) return;
    
    updateCat.mutate({ id, data: { name: editName, description: editDesc } }, {
      onSuccess: () => {
        toast({ title: "Category updated" });
        setEditingId(null);
        queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
      }
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure? This will not delete the videos, but they will lose this category.")) {
      deleteCat.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Category deleted" });
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
        }
      });
    }
  };

  return (
    <ProtectedRoute allowedRoles={['owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8 max-w-5xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-heading font-bold">Categories</h1>
              <p className="text-muted-foreground mt-1">Manage video classification tags</p>
            </div>
            
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> Add Category</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Create New Category</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="e.g. Action" autoFocus />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="desc">Description (Optional)</Label>
                    <Input id="desc" value={newCatDesc} onChange={e => setNewCatDesc(e.target.value)} placeholder="Brief description" />
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="ghost" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={!newCatName.trim() || createCat.isPending}>Save</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[200px]">Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[100px] text-center">Videos</TableHead>
                  <TableHead className="text-right w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">Loading...</TableCell>
                  </TableRow>
                ) : categories?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No categories defined.</TableCell>
                  </TableRow>
                ) : (
                  categories?.map((cat: any) => (
                    <TableRow key={cat.id}>
                      {editingId === cat.id ? (
                        <>
                          <TableCell>
                            <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" />
                          </TableCell>
                          <TableCell>
                            <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="h-8" />
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">{cat.videoCount || 0}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-500/10" onClick={() => handleUpdate(cat.id)}>
                                <Save className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setEditingId(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="font-medium"><div className="flex items-center gap-2"><FolderTree className="h-4 w-4 text-muted-foreground" /> {cat.name}</div></TableCell>
                          <TableCell className="text-muted-foreground">{cat.description || '-'}</TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center justify-center bg-muted px-2 py-1 rounded-full text-xs font-medium">
                              {cat.videoCount || 0}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-500/10" onClick={() => startEdit(cat)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(cat.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
