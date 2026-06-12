import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { adminMe, adminLogin, adminLogout, type AdminUser } from '../lib/api.js';

interface AuthState {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the current session once on mount.
  useEffect(() => {
    adminMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await adminLogin(email, password));
  }, []);

  const logout = useCallback(async () => {
    await adminLogout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
