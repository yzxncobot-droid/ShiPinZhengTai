import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/lib/protected-route";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useListSubscriptions, usePurchaseSubscription } from "@workspace/api-client-react";
import { Crown, Check, Loader2, Sparkles, Star } from "lucide-react";
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
        title: "Saldo Tidak Cukup",
        description: "Silakan isi saldo wallet kamu untuk membeli paket ini.",
        variant: "destructive",
      });
      setLocation('/topup');
      return;
    }
    
    purchaseMutation.mutate({ id }, {
      onSuccess: () => {
        toast({
          title: "🎉 Berhasil!",
          description: "Akses premium kamu sudah aktif.",
        });
      },
      onError: (err: any) => {
        toast({
          title: "Gagal",
          description: err.message || "Terjadi kesalahan.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="text-center max-w-2xl mx-auto mb-12 relative">
          <Star className="absolute -top-4 left-4 h-8 w-8 text-yellow-400 fill-yellow-400 transform -rotate-12 opacity-80" />
          <Sparkles className="absolute top-4 right-4 h-6 w-6 text-purple-400 opacity-80" />
          
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 shadow-lg shadow-orange-500/20 mb-4 transform rotate-3">
            <Crown className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight text-slate-800 mb-3">
            Upgrade ke Premium! 🚀
          </h1>
          <p className="text-sm md:text-base font-medium text-slate-500">
            Tonton semua video eksklusif, tanpa iklan, dan dukung kreator favorit kamu. Pilih paket yang paling pas untukmu.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 max-w-5xl mx-auto">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-80 rounded-3xl bg-white border border-slate-100 animate-pulse shadow-sm" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-6xl mx-auto">
            {subscriptions?.map((plan, index) => {
              const isPopular = index === 1; // Assuming second plan is popular
              
              return (
                <div 
                  key={plan.id}
                  className={`relative flex flex-col rounded-3xl p-6 transition-all duration-300 ${
                    isPopular 
                      ? 'bg-gradient-to-b from-purple-600 to-indigo-700 text-white shadow-xl shadow-purple-500/20 transform scale-105 z-10 border-none' 
                      : 'bg-white border border-slate-100 shadow-sm hover:shadow-md'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 w-max">
                      <div className="bg-gradient-to-r from-orange-400 to-yellow-400 text-white text-[10px] font-extrabold uppercase tracking-widest py-1 px-4 rounded-full shadow-md">
                        Paling Laris 🔥
                      </div>
                    </div>
                  )}
                  
                  <div className="mb-4">
                    <h3 className={`text-xl font-heading font-extrabold ${isPopular ? 'text-white' : 'text-slate-800'}`}>{plan.name}</h3>
                    <p className={`text-xs mt-1 font-medium min-h-[32px] ${isPopular ? 'text-indigo-100' : 'text-slate-500'}`}>
                      {plan.description}
                    </p>
                  </div>
                  
                  <div className="mb-6 pb-6 border-b border-opacity-20 border-current">
                    <span className="text-3xl font-extrabold tracking-tight">Rp {plan.price.toLocaleString()}</span>
                    <span className={`text-[10px] font-bold ml-1 uppercase tracking-wide ${isPopular ? 'text-indigo-200' : 'text-slate-400'}`}>/ {plan.durationDays} hr</span>
                  </div>
                  
                  <ul className="flex-1 space-y-3 mb-6">
                    <li className="flex items-start gap-2.5">
                      <div className={`mt-0.5 rounded-full p-0.5 ${isPopular ? 'bg-indigo-500' : 'bg-green-100'}`}>
                        <Check className={`h-3 w-3 ${isPopular ? 'text-white' : 'text-green-600'}`} strokeWidth={3} />
                      </div>
                      <span className={`text-xs font-bold leading-tight ${isPopular ? 'text-indigo-50' : 'text-slate-600'}`}>Akses ke semua video Premium</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className={`mt-0.5 rounded-full p-0.5 ${isPopular ? 'bg-indigo-500' : 'bg-green-100'}`}>
                        <Check className={`h-3 w-3 ${isPopular ? 'text-white' : 'text-green-600'}`} strokeWidth={3} />
                      </div>
                      <span className={`text-xs font-bold leading-tight ${isPopular ? 'text-indigo-50' : 'text-slate-600'}`}>Nonton tanpa iklan</span>
                    </li>
                    {plan.durationDays >= 30 && (
                      <li className="flex items-start gap-2.5">
                        <div className={`mt-0.5 rounded-full p-0.5 ${isPopular ? 'bg-indigo-500' : 'bg-green-100'}`}>
                          <Check className={`h-3 w-3 ${isPopular ? 'text-white' : 'text-green-600'}`} strokeWidth={3} />
                        </div>
                        <span className={`text-xs font-bold leading-tight ${isPopular ? 'text-indigo-50' : 'text-slate-600'}`}>Kualitas 1080p HD</span>
                      </li>
                    )}
                  </ul>
                  
                  <Button 
                    className={`w-full h-12 rounded-xl text-sm font-extrabold border-none shadow-sm ${
                      isPopular 
                        ? 'bg-white text-purple-700 hover:bg-slate-50' 
                        : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                    }`}
                    onClick={() => handlePurchase(plan.id, plan.price)}
                    disabled={purchaseMutation.isPending}
                  >
                    {purchaseMutation.isPending && purchaseMutation.variables?.id === plan.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      'Pilih Paket'
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
