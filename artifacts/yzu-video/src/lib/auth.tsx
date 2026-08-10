import React, { createContext, useContext, useEffect, useState } from 'react';
import { getGetMeQueryKey, useGetMe } from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';

interface AuthContextType {
  user: User | null | undefined;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const TOKEN_KEY = 'yzu_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);

  // When token exists, fetch the user profile
  const {
    data: me,
    error: meError,
    isLoading: isMeLoading,
    isError: isMeError,
  } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      // Authentication failures are terminal, but temporary API/database
      // failures should not log a user out immediately after signing in.
      retry: (failureCount: number, error: unknown) => {
        const status = (error as { status?: number } | undefined)?.status;
        return status !== 401 && status !== 403 && failureCount < 2;
      },
    }
  });

  useEffect(() => {
    if (me) {
      setUser(me);
    }
  }, [me]);

  // Only clear the token when the API explicitly rejects authentication.
  // Network errors, API restarts, and temporary database failures must not
  // turn into an unexpected logout immediately after signing in.
  useEffect(() => {
    const status = (meError as { status?: number } | undefined)?.status;
    const isAuthenticationFailure = status === 401 || status === 403;

    if (isMeError && token && isAuthenticationFailure) {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    }
  }, [isMeError, meError, token]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user: token ? user : null,
        token,
        isLoading: !!token && isMeLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
