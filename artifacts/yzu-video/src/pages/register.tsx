import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlaySquare, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const registerSchema = z.object({
  username: z.string().min(3, { message: "Username must be at least 3 characters" }),
  email: z.string().email({ message: "Please enter a valid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export default function Register() {
  const [, setLocation] = useLocation();
  const { login: setAuth } = useAuth();
  const { toast } = useToast();
  
  const registerMutation = useRegister();
  
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = (values: z.infer<typeof registerSchema>) => {
    const { confirmPassword, ...registerData } = values;
    
    registerMutation.mutate(
      { data: registerData },
      {
        onSuccess: (data) => {
          setAuth(data.token, data.user);
          toast({
            title: "Account created!",
            description: "Welcome to Yzu视频.",
          });
          setLocation('/');
        },
        onError: (error: any) => {
          toast({
            title: "Registration failed",
            description: error.message || "An error occurred. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Decorative backgrounds */}
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-md bg-card/50 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl p-8 relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary mb-4 shadow-lg shadow-primary/30">
            <PlaySquare className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="font-heading font-bold text-3xl tracking-tight text-center">
            Create an Account
          </h1>
          <p className="text-muted-foreground mt-2 text-center">
            Join the premium video streaming platform
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input placeholder="johndoe" className="h-11 bg-background/50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="name@example.com" type="email" className="h-11 bg-background/50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input placeholder="••••••••" type="password" className="h-11 bg-background/50" {...field} />
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
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <Input placeholder="••••••••" type="password" className="h-11 bg-background/50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <Button 
              type="submit" 
              className="w-full h-12 text-md mt-6" 
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <>
                  Create Account
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </Form>
        
        <div className="mt-8 text-center text-sm">
          <span className="text-muted-foreground">Already have an account? </span>
          <button 
            onClick={() => setLocation('/login')}
            className="text-primary font-medium hover:underline focus:outline-none"
          >
            Sign in here
          </button>
        </div>
      </div>
    </div>
  );
}
