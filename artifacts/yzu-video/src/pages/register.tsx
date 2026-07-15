import { useState } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlaySquare, Loader2, ArrowRight, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const registerSchema = z
  .object({
    username: z
      .string()
      .min(3, "Username minimal 3 karakter")
      .max(30, "Username maksimal 30 karakter")
      .regex(/^[a-zA-Z0-9_]+$/, "Hanya huruf, angka, dan underscore"),
    password: z.string().min(6, "Password minimal 6 karakter"),
    confirmPassword: z.string(),
    referralCode: z.string().optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Password tidak cocok",
    path: ["confirmPassword"],
  });

type RegisterForm = z.infer<typeof registerSchema>;

export default function Register() {
  const [, setLocation] = useLocation();
  const { login: setAuth } = useAuth();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  // Pre-fill referral code from URL ?ref=XXXX
  const urlParams = new URLSearchParams(window.location.search);
  const urlRef = urlParams.get("ref") ?? "";

  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      referralCode: urlRef,
    },
  });

  const onSubmit = async (values: RegisterForm) => {
    setIsPending(true);
    try {
      const { confirmPassword, ...payload } = values;
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          referralCode: payload.referralCode?.trim().toUpperCase() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Registrasi gagal",
          description: data.error ?? "Coba lagi beberapa saat.",
          variant: "destructive",
        });
        return;
      }

      setAuth(data.token, data.user);
      toast({ title: "Akun berhasil dibuat! 🎉", description: `Selamat datang, ${data.user.username}!` });
      setLocation("/");
    } catch {
      toast({ title: "Koneksi gagal", description: "Coba lagi beberapa saat.", variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md bg-card/50 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl p-8 relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary mb-4 shadow-lg shadow-primary/30">
            <PlaySquare className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="font-heading font-bold text-3xl tracking-tight text-center">
            Buat Akun Baru
          </h1>
          <p className="text-muted-foreground mt-2 text-center">
            Bergabung dengan platform streaming premium
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="username_kamu"
                      autoComplete="username"
                      className="h-11 bg-background/50"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Hanya huruf, angka, dan underscore. Tidak bisa diubah setelah daftar.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="••••••••"
                      type="password"
                      autoComplete="new-password"
                      className="h-11 bg-background/50"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Konfirmasi Password *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="••••••••"
                      type="password"
                      autoComplete="new-password"
                      className="h-11 bg-background/50"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="referralCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <Gift className="h-3.5 w-3.5 text-primary" />
                    Kode Referral <span className="text-muted-foreground font-normal">(opsional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Contoh: ABCD1234"
                      className="h-11 bg-background/50 uppercase"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full h-12 text-md mt-6" disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <>
                  Buat Akun <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </Form>

        <div className="mt-8 text-center text-sm">
          <span className="text-muted-foreground">Sudah punya akun? </span>
          <button
            onClick={() => setLocation("/login")}
            className="text-primary font-medium hover:underline focus:outline-none"
          >
            Masuk di sini
          </button>
        </div>
      </div>
    </div>
  );
}
