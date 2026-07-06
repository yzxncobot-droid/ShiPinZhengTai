import { useState, useRef } from "react";
import { ProtectedRoute } from "@/lib/protected-route";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Loader2, Upload, QrCode } from "lucide-react";
import { useEffect } from "react";

const settingsSchema = z.object({
  siteName: z.string().min(1, "Site name is required"),
  siteDescription: z.string().optional(),
  logo: z.string().optional(),
  banner: z.string().optional(),
  qrisImage: z.string().optional(),
  whatsappLink: z.string().optional(),
});

export default function OwnerSettings() {
  const { toast } = useToast();
  const { token } = useAuth();
  
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();

  const [isUploading, setIsUploading] = useState<string | null>(null);
  const qrisRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      siteName: "Yzu视频",
      siteDescription: "",
      logo: "",
      banner: "",
      qrisImage: "",
      whatsappLink: "",
    },
  });

  // Populate form when data arrives
  useEffect(() => {
    if (settings) {
      form.reset({
        siteName: settings.siteName || "Yzu视频",
        siteDescription: settings.siteDescription || "",
        logo: settings.logo || "",
        banner: settings.banner || "",
        qrisImage: settings.qrisImage || "",
        whatsappLink: settings.whatsappLink || "",
      });
    }
  }, [settings, form]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: keyof z.infer<typeof settingsSchema>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(fieldName);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await fetch("/api/upload/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      form.setValue(fieldName, data.url, { shouldValidate: true, shouldDirty: true });
      toast({ title: "Image uploaded successfully" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(null);
    }
  };

  const onSubmit = (values: z.infer<typeof settingsSchema>) => {
    updateSettings.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Settings updated successfully" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to update", description: err.message, variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="p-8 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>
      </AdminLayout>
    );
  }

  return (
    <ProtectedRoute allowedRoles={['owner']}>
      <AdminLayout>
        <div className="p-6 md:p-8 max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-heading font-bold">Site Settings</h1>
            <p className="text-muted-foreground mt-1">Configure global platform details and payment methods.</p>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* General Info */}
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold border-b pb-2 mb-4">General Information</h3>
                    </div>
                    
                    <FormField
                      control={form.control}
                      name="siteName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Platform Name</FormLabel>
                          <FormControl>
                            <Input {...field} className="bg-background" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="siteDescription"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description / SEO Meta</FormLabel>
                          <FormControl>
                            <Textarea {...field} className="resize-none h-24 bg-background" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="whatsappLink"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>WhatsApp Support Link</FormLabel>
                          <FormControl>
                            <Input placeholder="https://wa.me/..." {...field} className="bg-background" />
                          </FormControl>
                          <FormDescription>Link for the floating support button</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Media & Payments */}
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold border-b pb-2 mb-4">Branding & Payments</h3>
                    </div>

                    <FormField
                      control={form.control}
                      name="qrisImage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <QrCode className="h-4 w-4" /> Global QRIS Code
                          </FormLabel>
                          <FormControl>
                            <div className="mt-2">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                ref={qrisRef}
                                onChange={(e) => handleImageUpload(e, 'qrisImage')}
                              />
                              {field.value ? (
                                <div className="relative border border-border p-4 rounded-xl bg-white w-48 mx-auto flex items-center justify-center group">
                                  <img src={field.value} alt="QRIS" className="w-full h-auto max-h-48 object-contain mix-blend-multiply" />
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center rounded-xl gap-2">
                                    <Button type="button" variant="secondary" size="sm" onClick={() => qrisRef.current?.click()}>
                                      Change QRIS
                                    </Button>
                                    <Button type="button" variant="destructive" size="sm" onClick={() => form.setValue('qrisImage', '', {shouldDirty: true})}>
                                      Remove
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div 
                                  onClick={() => qrisRef.current?.click()}
                                  className="border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer bg-muted/20 h-48 w-48 mx-auto"
                                >
                                  {isUploading === 'qrisImage' ? (
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                  ) : (
                                    <>
                                      <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                                      <p className="text-sm font-medium text-center">Upload QRIS</p>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </FormControl>
                          <FormDescription className="text-center mt-2">This code will be shown to users when they top up.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="banner"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default Hero Banner</FormLabel>
                          <FormControl>
                            <div className="mt-2">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                ref={bannerRef}
                                onChange={(e) => handleImageUpload(e, 'banner')}
                              />
                              <div className="flex gap-4 items-center">
                                <Input value={field.value || ''} readOnly placeholder="Image URL" className="bg-muted" />
                                <Button type="button" variant="outline" onClick={() => bannerRef.current?.click()} disabled={isUploading === 'banner'}>
                                  {isUploading === 'banner' ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload"}
                                </Button>
                              </div>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-6 border-t">
                  <Button type="submit" size="lg" disabled={updateSettings.isPending || !form.formState.isDirty}>
                    {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Settings
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
