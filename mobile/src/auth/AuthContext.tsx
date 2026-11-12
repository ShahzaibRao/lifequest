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
  isAccessTokenUsable,
  loadStoredTokens,
  refreshAccessToken,
  saveTokens,
} from "../api/client";
import { getCached, setCached } from "../cache/cache";

export type MeUser = {
  user_id: string;
  email: string;
  display_name: string;
};

// Profile cached in SQLite so the app can open (and show who you are)
// with no network at all. Overwritten on every successful /auth/me.
const ME_CACHE_KEY = "auth:me";

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
        if (!hasTokens) return; // never logged in -> login screen
        // 1) Restore the cached profile immediately — the app opens
        //    with no server call, online or offline (WhatsApp-style).
        const cached = await getCached<MeUser>(ME_CACHE_KEY);
        if (cached?.data) setUser(cached.data);
        // 2) Validate / refresh in the background. Only a definitive
        //    server rejection (refresh token invalid) logs the user out.
        //    Anything else — offline, slow network, 5xx — keeps the
        //    session and the cached profile.
        try {
          if (isAccessTokenUsable()) {
            // Access token still valid — refresh the profile in background.
            const me = await apiJson<MeUser>("/auth/me");
            setUser(me);
            await setCached(ME_CACHE_KEY, me);
          } else {
            // Access token expired — try the refresh token.
            const result = await refreshAccessToken();
            if (result === "ok") {
              const me = await apiJson<MeUser>("/auth/me");
              setUser(me);
              await setCached(ME_CACHE_KEY, me);
            } else if (result === "invalid") {
              // Server rejected the refresh token: the session is really over.
              setUser(null);
            }
            // "offline": keep the cached user, stay logged in.
          }
        } catch {
          // Background validation failed. If the refresh was definitively
          // rejected the tokens are already cleared — log out.
          const stillHasTokens = await loadStoredTokens();
          if (!stillHasTokens) setUser(null);
          // Otherwise (offline / transient) stay logged in.
        }
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
    await setCached(ME_CACHE_KEY, me);
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
    await setCached(ME_CACHE_KEY, null);
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
