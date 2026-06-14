import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { adminMe, adminLogin, adminLogout, type AdminUser } from '../lib/api.js';

interface AuthState {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string, second?: { totpCode?: string; recoveryCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  // Re-resolve the session from the server — used after accepting an invite, which
  // logs the new user in via a Set-Cookie the SPA doesn't otherwise observe.
  refresh: () => Promise<void>;
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

  const login = useCallback(
    async (email: string, password: string, second?: { totpCode?: string; recoveryCode?: string }) => {
      setUser(await adminLogin(email, password, second));
    },
    [],
  );

  const logout = useCallback(async () => {
    await adminLogout();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    setUser(await adminMe());
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
