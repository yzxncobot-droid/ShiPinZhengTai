import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { TOKEN_KEY, useAuth } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/register", "/maintenance"];

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { isLoading } = useAuth();
  const token = localStorage.getItem(TOKEN_KEY);

  const isPublic = PUBLIC_PATHS.some((p) => location === p || location.startsWith(p + "/"));

  useEffect(() => {
    if (!isPublic && !token) {
      setLocation("/login");
    }
  }, [isPublic, token, location, setLocation]);

  if (isPublic) return <>{children}</>;
  if (!token) return null;
  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}
