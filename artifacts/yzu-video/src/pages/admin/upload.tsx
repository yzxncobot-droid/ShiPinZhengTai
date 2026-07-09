import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useListCategories, useCreateVideo } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, UploadCloud, Video as VideoIcon, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const uploadSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().optional(),
  categoryId: z.coerce.number().optional(),
  type: z.enum(["free", "premium"]),
  price: z.coerce.number().optional(),
  downloadable: z.boolean().default(false),
  videoUrl: z.string().min(1, "Video is required"),
  thumbnail: z.string().optional(),
});

export default function AdminUploadVideo() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: categories } = useListCategories();
  const createVideo = useCreateVideo();

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof uploadSchema>>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      title: "",
      description: "",
      type: "free",
      price: 0,
      downloadable: false,
      videoUrl: "",
      thumbnail: "",
    },
  });

  const videoType = form.watch("type");

  const handleFileUpload = async (file: File, type: 'video' | 'image') => {
    const isVideo = type === 'video';
    const setUploading = isVideo ? setIsUploadingVideo : setIsUploadingThumb;
    const endpoint = isVideo ? '/api/upload/video' : '/api/upload/thumbnail';
    const fieldName = isVideo ? 'videoUrl' : 'thumbnail';
    const formKey = isVideo ? 'video' : 'thumbnail';

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append(formKey, file);

    try {
      // Create XMLHttpRequest to track progress
      const xhr = new XMLHttpRequest();
      
      const promise = new Promise<{url: string}>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(percent);
          }
        });

        xhr.addEventListener('load', () => {
          let parsed: any = null;
          try { parsed = JSON.parse(xhr.responseText); } catch { /* non-JSON response */ }
          if (xhr.status >= 200 && xhr.status < 300 && parsed?.success !== false) {
            resolve(parsed);
          } else {
            reject(new Error(parsed?.message || 'Upload gagal'));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.open('POST', endpoint);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });

      const data = await promise;
      form.setValue(fieldName as any, data.url, { shouldValidate: true });
      toast({ title: `${type === 'video' ? 'Video' : 'Thumbnail'} uploaded successfully.` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const onSubmit = (values: z.infer<typeof uploadSchema>) => {
    // If free, force price to 0
    if (values.type === 'free') values.price = 0;
    
    createVideo.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Video published successfully" });
        setLocation('/admin/videos');
      },
      onError: (err: any) => {
        toast({ title: "Failed to publish", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <ProtectedRoute allowedRoles={['admin', 'owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8 max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-heading font-bold">Upload New Video</h1>
            <p className="text-muted-foreground mt-1">Publish content to your channel</p>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                
                {/* File Uploads */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Video Upload */}
                  <FormField
                    control={form.control}
                    name="videoUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Video File *</FormLabel>
                        <FormControl>
                          <div className="mt-2">
                            <input
                              type="file"
                              accept="video/mp4,video/x-m4v,video/*"
                              className="hidden"
                              ref={videoInputRef}
                              onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'video')}
                            />
                            {field.value ? (
                              <div className="border border-border rounded-xl p-4 bg-muted/20 flex flex-col items-center text-center">
                                <VideoIcon className="h-8 w-8 text-primary mb-2" />
                                <p className="text-sm font-medium truncate w-full px-4 mb-2">Video uploaded ready for publish</p>
                                <Button type="button" variant="outline" size="sm" onClick={() => videoInputRef.current?.click()}>
                                  Replace Video
                                </Button>
                              </div>
                            ) : (
                              <div 
                                onClick={() => !isUploadingVideo && videoInputRef.current?.click()}
                                className={`border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-muted/10 h-40 ${isUploadingVideo ? 'pointer-events-none' : ''}`}
                              >
                                {isUploadingVideo ? (
                                  <div className="w-full max-w-[200px] text-center">
                                    <p className="text-sm font-medium mb-2">Uploading... {uploadProgress}%</p>
                                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                      <div className="bg-primary h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <UploadCloud className="h-8 w-8 text-muted-foreground mb-3" />
                                    <p className="text-sm font-medium">Select Video File</p>
                                    <p className="text-xs text-muted-foreground mt-1">MP4, WebM format</p>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Thumbnail Upload */}
                  <FormField
                    control={form.control}
                    name="thumbnail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Thumbnail Image</FormLabel>
                        <FormControl>
                          <div className="mt-2">
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              ref={thumbInputRef}
                              onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'image')}
                            />
                            {field.value ? (
                              <div className="relative rounded-xl overflow-hidden border border-border group w-full h-40">
                                <img src={field.value} alt="Thumbnail" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Button type="button" variant="secondary" size="sm" onClick={() => thumbInputRef.current?.click()}>
                                    Replace Image
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div 
                                onClick={() => !isUploadingThumb && thumbInputRef.current?.click()}
                                className={`border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-muted/10 h-40 ${isUploadingThumb ? 'pointer-events-none' : ''}`}
                              >
                                {isUploadingThumb ? (
                                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                ) : (
                                  <>
                                    <ImageIcon className="h-8 w-8 text-muted-foreground mb-3" />
                                    <p className="text-sm font-medium">Select Thumbnail</p>
                                    <p className="text-xs text-muted-foreground mt-1">16:9 recommended</p>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem className="col-span-full">
                        <FormLabel>Video Title *</FormLabel>
                        <FormControl>
                          <Input placeholder="Catchy title for your video" className="bg-background" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="col-span-full">
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Tell viewers about your video..." 
                            className="resize-none h-32 bg-background" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                          <FormControl>
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder="Select a category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categories?.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Content Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="bg-background">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="free">Free (Public)</SelectItem>
                            <SelectItem value="premium">Premium (Subscribers & Purchasers only)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {videoType === 'premium' && (
                    <FormField
                      control={form.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price for One-time Purchase (Rp)</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="Leave 0 if only for subscribers" className="bg-background" {...field} />
                          </FormControl>
                          <FormDescription>Users can buy this specific video without a subscription.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="downloadable"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-xl border p-4 bg-background">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Allow Downloads</FormLabel>
                          <FormDescription>
                            Can users download this video for offline viewing?
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-end pt-4 border-t border-border/50">
                  <Button type="button" variant="ghost" className="mr-4" onClick={() => setLocation('/admin/videos')}>
                    Cancel
                  </Button>
                  <Button type="submit" size="lg" disabled={createVideo.isPending || isUploadingVideo || isUploadingThumb}>
                    {createVideo.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Publish Video
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </AdminLayout>
    </ProtectedRoute>
  );
}
