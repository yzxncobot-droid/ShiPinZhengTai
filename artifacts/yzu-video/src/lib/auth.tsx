import React, { createContext, useContext, useEffect, useState } from 'react';
import { useGetMe } from '@workspace/api-client-react';
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
  const { data: me, isLoading: isMeLoading } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    }
  });

  useEffect(() => {
    if (me) {
      setUser(me);
    }
  }, [me]);

  // If token is invalid and we get an error, we should logout
  // (In a real app, you might check for a 401 specifically)

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
