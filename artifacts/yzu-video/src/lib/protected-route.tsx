import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { TOKEN_KEY } from './auth';
import { useAuth } from './auth';
import { setAuthTokenGetter } from '@workspace/api-client-react/custom-fetch';
import { Loader2, ShieldAlert } from 'lucide-react';

export function initApiClient() {
  setAuthTokenGetter(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
}

export function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const [location, setLocation] = useLocation();
  const token = localStorage.getItem(TOKEN_KEY);
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!token) {
      setLocation('/login');
    }
  }, [token, location, setLocation]);

  if (!token) return null;

  // Wait for the profile to resolve before deciding on role access, so we
  // never flash a blank screen while `/api/auth/me` is still in flight.
  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // After loading resolves, deny access whenever roles are restricted and we
  // don't have a user with an allowed role — including the case where the
  // token is present but `/api/auth/me` failed to return a profile.
  if (allowedRoles && !(user && allowedRoles.includes(user.role))) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <p className="font-medium">Anda tidak memiliki akses ke halaman ini.</p>
      </div>
    );
  }

  return <>{children}</>;
}
