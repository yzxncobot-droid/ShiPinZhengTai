import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { useCreateTopup, useGetSettings } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Wallet, QrCode, UploadCloud, Loader2, Info } from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

const PRESET_AMOUNTS = [5000, 10000, 15000, 20000, 25000, 50000, 100000];

const topupSchema = z.object({
  amount: z.coerce.number().min(5000, { message: "Minimum top-up is Rp 5,000" }),
  paymentProof: z.string().min(1, { message: "Payment proof is required" }),
});

export default function TopupPage() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: settings } = useGetSettings();
  const createTopup = useCreateTopup();
  
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof topupSchema>>({
    resolver: zodResolver(topupSchema),
    defaultValues: {
      amount: 10000,
      paymentProof: "",
    },
  });

  const amount = form.watch("amount");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 5MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await fetch("/api/upload/payment-proof", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      form.setValue("paymentProof", data.url, { shouldValidate: true });
      toast({ title: "Upload successful", description: "Payment proof uploaded." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmit = (values: z.infer<typeof topupSchema>) => {
    createTopup.mutate({ data: values }, {
      onSuccess: () => {
        toast({
          title: "Top-up Submitted",
          description: "Your top-up request is pending confirmation by an admin.",
        });
        setLocation('/history'); // Go to history to see pending topups
      },
      onError: (err: any) => {
        toast({
          title: "Submission Failed",
          description: err.message,
          variant: "destructive"
        });
      }
    });
  };

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="container mx-auto px-4 md:px-6 py-12 max-w-4xl">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            
            <div className="w-full md:w-1/2 space-y-6">
              <div>
                <h1 className="text-3xl font-heading font-bold mb-2">Wallet Top-up</h1>
                <p className="text-muted-foreground">Add funds to your wallet using QRIS to purchase premium content and subscriptions.</p>
              </div>

              <div className="bg-card border border-border/50 rounded-2xl p-6 flex items-center gap-4 shadow-sm">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Current Balance</p>
                  <p className="text-2xl font-bold tracking-tight">Rp {user?.walletBalance?.toLocaleString() || 0}</p>
                </div>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Select Amount</FormLabel>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                          {PRESET_AMOUNTS.map(preset => (
                            <Button
                              key={preset}
                              type="button"
                              variant={field.value === preset ? "default" : "outline"}
                              className={`rounded-xl ${field.value === preset ? 'shadow-md shadow-primary/20' : 'bg-card hover:bg-muted'}`}
                              onClick={() => form.setValue("amount", preset, { shouldValidate: true })}
                            >
                              {preset / 1000}K
                            </Button>
                          ))}
                        </div>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">Rp</span>
                            <Input 
                              type="number" 
                              className="pl-12 h-12 text-lg font-medium bg-card" 
                              placeholder="Other amount" 
                              {...field} 
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="bg-muted/30 p-6 rounded-2xl border border-border border-dashed">
                    <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
                      <QrCode className="h-5 w-5 text-primary" /> Scan to Pay
                    </h3>
                    
                    {settings?.qrisImage ? (
                      <div className="bg-white p-4 rounded-xl inline-block shadow-sm">
                        <img src={settings.qrisImage} alt="QRIS" className="w-48 h-48 object-contain mix-blend-multiply" />
                      </div>
                    ) : (
                      <div className="w-48 h-48 bg-card border rounded-xl flex items-center justify-center flex-col text-muted-foreground">
                        <QrCode className="h-10 w-10 mb-2 opacity-50" />
                        <span className="text-xs">QRIS not configured</span>
                      </div>
                    )}
                    
                    <Alert className="mt-6 bg-card">
                      <Info className="h-4 w-4" />
                      <AlertTitle>Instructions</AlertTitle>
                      <AlertDescription className="text-muted-foreground">
                        1. Scan the QR code with your banking app or e-wallet.<br/>
                        2. Transfer exactly <strong>Rp {amount ? amount.toLocaleString() : 0}</strong>.<br/>
                        3. Take a screenshot of the success receipt.<br/>
                        4. Upload the receipt below.
                      </AlertDescription>
                    </Alert>
                  </div>

                  <FormField
                    control={form.control}
                    name="paymentProof"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Proof</FormLabel>
                        <FormControl>
                          <div className="mt-2">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              ref={fileInputRef}
                              onChange={handleFileChange}
                            />
                            {field.value ? (
                              <div className="relative rounded-xl overflow-hidden border border-border group w-fit">
                                <img src={field.value} alt="Proof" className="h-32 object-cover" />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                                    Change
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer bg-card/50"
                              >
                                {isUploading ? (
                                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                ) : (
                                  <>
                                    <UploadCloud className="h-10 w-10 text-muted-foreground mb-3" />
                                    <p className="text-sm font-medium">Click to upload receipt</p>
                                    <p className="text-xs text-muted-foreground mt-1">JPG, PNG up to 5MB</p>
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

                  <Button 
                    type="submit" 
                    className="w-full h-12 text-md rounded-xl"
                    disabled={createTopup.isPending || isUploading}
                  >
                    {createTopup.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Submit Top-up Request
                  </Button>

                </form>
              </Form>

            </div>

            <div className="w-full md:w-1/2 md:pl-8">
               <div className="bg-card/50 border border-border/50 rounded-2xl p-6 sticky top-24">
                 <h3 className="font-heading font-semibold text-lg mb-4">Recent Top-ups</h3>
                 <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                    <Wallet className="h-12 w-12 opacity-20 mb-3" />
                    <p>Go to your <Link href="/history" className="text-primary hover:underline">History</Link> to view all past transactions and their status.</p>
                 </div>
               </div>
            </div>

          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
