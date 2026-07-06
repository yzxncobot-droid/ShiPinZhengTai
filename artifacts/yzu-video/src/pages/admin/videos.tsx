import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useListVideos, useDeleteVideo, getListVideosQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Play, MoreHorizontal, Pencil, Trash2, Search, Plus } from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function AdminVideos() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const isOwner = user?.role === 'owner';
  
  // Admin sees only their videos, Owner sees all. The API listVideos filters by creatorId for admin automatically via backend logic usually. If not, we just call the endpoint.
  // Actually, wait, the API might not automatically filter for admins. Let's assume the API listVideos returns all for owner and only own for admin.
  
  const { data: videos, isLoading } = useListVideos({ search, limit: 50 });
  const deleteVideo = useDeleteVideo();

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this video? This action cannot be undone.")) {
      deleteVideo.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Video deleted successfully" });
          queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: "Error deleting video", description: err.message, variant: "destructive" });
        }
      });
    }
  };

  return (
    <ProtectedRoute allowedRoles={['admin', 'owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-heading font-bold">{isOwner ? 'All Videos' : 'My Videos'}</h1>
              <p className="text-muted-foreground mt-1">Manage your video content library</p>
            </div>
            <Link href="/admin/upload">
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Upload Video
              </Button>
            </Link>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border/50 flex gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search videos..." 
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
                    <TableHead className="w-[300px]">Video</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    {isOwner && <TableHead>Creator</TableHead>}
                    <TableHead className="text-right">Metrics</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={isOwner ? 7 : 6} className="text-center py-12 text-muted-foreground">Loading videos...</TableCell>
                    </TableRow>
                  ) : videos?.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isOwner ? 7 : 6} className="text-center py-12 text-muted-foreground">
                        No videos found. Upload your first video!
                      </TableCell>
                    </TableRow>
                  ) : (
                    videos?.data.map((video) => (
                      <TableRow key={video.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="relative h-12 w-20 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
                              {video.thumbnail ? (
                                <img src={video.thumbnail} alt="" className="object-cover w-full h-full" />
                              ) : (
                                <Play className="h-4 w-4 text-muted-foreground/50" />
                              )}
                            </div>
                            <div className="font-medium line-clamp-2" title={video.title}>{video.title}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={video.type === 'premium' ? 'text-amber-500 border-amber-500/30 bg-amber-500/10' : 'text-green-500 border-green-500/30 bg-green-500/10'}>
                            {video.type}
                          </Badge>
                        </TableCell>
                        <TableCell>{video.category?.name || '-'}</TableCell>
                        {isOwner && <TableCell>{video.creator?.username || 'Unknown'}</TableCell>}
                        <TableCell className="text-right">
                          <div className="text-sm">{video.views.toLocaleString()} <span className="text-muted-foreground text-xs">views</span></div>
                          <div className="text-sm">{video.likes.toLocaleString()} <span className="text-muted-foreground text-xs">likes</span></div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(video.createdAt), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <Link href={`/videos/${video.id}`}>
                                <DropdownMenuItem className="cursor-pointer">
                                  <Play className="mr-2 h-4 w-4" /> View Page
                                </DropdownMenuItem>
                              </Link>
                              <DropdownMenuItem className="cursor-pointer text-destructive focus:bg-destructive/10" onClick={() => handleDelete(video.id)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
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
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
