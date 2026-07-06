import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { TOKEN_KEY } from './auth';
import { setAuthTokenGetter } from '@workspace/api-client-react/custom-fetch';

export function initApiClient() {
  setAuthTokenGetter(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
}

export function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const [location, setLocation] = useLocation();
  const token = localStorage.getItem(TOKEN_KEY);
  
  // In a real app we'd wait for user data to check roles, 
  // but for immediate redirect without flicker, we can decode JWT or just let the API bounce them.
  // For simplicity, if no token, straight to login.
  useEffect(() => {
    if (!token) {
      setLocation('/login');
    }
  }, [token, location, setLocation]);

  if (!token) return null;

  return <>{children}</>;
}
