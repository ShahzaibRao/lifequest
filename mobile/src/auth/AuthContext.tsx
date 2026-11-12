import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  apiFetch,
  apiJson,
  clearTokens,
  getRefreshToken,
  loadStoredTokens,
  saveTokens,
} from "../api/client";

export type MeUser = {
  user_id: string;
  email: string;
  display_name: string;
};

type AuthContextValue = {
  user: MeUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const hasTokens = await loadStoredTokens();
        if (hasTokens) {
          const me = await apiJson<MeUser>("/auth/me");
          setUser(me);
        }
      } catch {
        await clearTokens();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { detail?: string }).detail ?? "Login failed");
    }
    await saveTokens(data.access_token, data.refresh_token);
    const me = await apiJson<MeUser>("/auth/me");
    setUser(me);
  };

  const register = async (email: string, password: string, displayName: string) => {
    const res = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { detail?: string }).detail ?? "Register failed");
    }
    await login(email, password);
  };

  const logout = async () => {
    const refresh = getRefreshToken();
    try {
      if (refresh) {
        await apiFetch("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refresh_token: refresh }),
        });
      }
    } catch {
      // Best effort: local logout must succeed even if the server is unreachable.
    }
    await clearTokens();
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
