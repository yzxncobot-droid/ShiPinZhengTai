import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useListSubscriptions, usePurchaseSubscription } from "@workspace/api-client-react";
import { Crown, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function Subscriptions() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const { data: subscriptions, isLoading } = useListSubscriptions();
  const purchaseMutation = usePurchaseSubscription();

  const handlePurchase = (id: number, price: number) => {
    if (!user) {
      setLocation('/login');
      return;
    }
    
    if ((user.walletBalance || 0) < price) {
      toast({
        title: "Insufficient Balance",
        description: "Please top up your wallet to purchase this plan.",
        variant: "destructive",
      });
      setLocation('/topup');
      return;
    }
    
    purchaseMutation.mutate({ id }, {
      onSuccess: () => {
        toast({
          title: "Subscription Activated!",
          description: "You now have access to premium content.",
        });
        // We'd ideally invalidate user query here or it will update on next fetch
      },
      onError: (err: any) => {
        toast({
          title: "Purchase Failed",
          description: err.message || "An error occurred.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-4 md:px-6 py-16 md:py-24">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 mb-2">
            <Crown className="h-6 w-6 text-amber-500" />
          </div>
          <h1 className="text-4xl md:text-5xl font-heading font-bold tracking-tight">
            Upgrade to Premium
          </h1>
          <p className="text-lg text-muted-foreground">
            Unlock exclusive content, remove ads, and support your favorite creators. Choose the plan that fits your needs.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[450px] rounded-2xl bg-card border border-border/50 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {subscriptions?.map((plan, index) => {
              const isPopular = index === 1; // Highlight middle plan ideally
              
              return (
                <div 
                  key={plan.id}
                  className={`relative flex flex-col rounded-3xl p-8 border ${
                    isPopular 
                      ? 'bg-card border-primary shadow-2xl shadow-primary/10' 
                      : 'bg-card/50 border-border/50'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider py-1 px-3 rounded-full">
                        Most Popular
                      </span>
                    </div>
                  )}
                  
                  <div className="mb-6">
                    <h3 className="text-2xl font-heading font-bold">{plan.name}</h3>
                    <p className="text-muted-foreground mt-2 min-h-[40px] text-sm">
                      {plan.description}
                    </p>
                  </div>
                  
                  <div className="mb-8">
                    <span className="text-4xl font-bold tracking-tight">Rp {plan.price.toLocaleString()}</span>
                    <span className="text-muted-foreground ml-2">/ {plan.durationDays} days</span>
                  </div>
                  
                  <ul className="flex-1 space-y-4 mb-8">
                    <li className="flex items-center gap-3">
                      <Check className="h-5 w-5 text-primary" />
                      <span>Access to all Premium videos</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <Check className="h-5 w-5 text-primary" />
                      <span>Ad-free viewing experience</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <Check className="h-5 w-5 text-primary" />
                      <span>High quality 1080p streaming</span>
                    </li>
                    {plan.durationDays >= 30 && (
                      <li className="flex items-center gap-3">
                        <Check className="h-5 w-5 text-primary" />
                        <span>Download for offline viewing</span>
                      </li>
                    )}
                  </ul>
                  
                  <Button 
                    className={`w-full h-12 rounded-xl text-base font-semibold ${isPopular ? '' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                    variant={isPopular ? 'default' : 'secondary'}
                    onClick={() => handlePurchase(plan.id, plan.price)}
                    disabled={purchaseMutation.isPending}
                  >
                    {purchaseMutation.isPending && purchaseMutation.variables?.id === plan.id ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      'Purchase Plan'
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
