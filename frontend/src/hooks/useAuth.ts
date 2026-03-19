import { createContext, createElement, useState, useCallback, useEffect, useContext, ReactNode } from 'react';
import { authApi, User } from '../services/api.service';

/**
 * useAuth hook — abstraction layer ready for future Azure AD (MSAL.js) replacement.
 *
 * To migrate to Azure AD:
 *   1. Replace login() with MSAL PublicClientApplication.loginPopup()
 *   2. Replace token storage with MSAL token cache
 *   3. Replace logout() with MSAL.logoutPopup()
 *   4. Keep the same interface (isAuthenticated, user, login, logout)
 */
interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (usuario: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const isAuthenticated = !!user;

  const login = useCallback(async (usuario: string, password: string) => {
    const res = await authApi.login(usuario, password);
    const { user: userData } = res.data;
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    authApi
      .me()
      .then((res) => {
        setUser(res.data);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
