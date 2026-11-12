import * as SecureStore from "expo-secure-store";

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const ACCESS_KEY = "lifequest_access_token";
const REFRESH_KEY = "lifequest_refresh_token";

let accessToken: string | null = null;
let refreshToken: string | null = null;

export async function loadStoredTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  return accessToken !== null && refreshToken !== null;
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Manual base64url decode to a binary string (no atob — React Native safe). */
function base64UrlDecode(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  let out = "";
  let i = 0;
  while (i < b64.length) {
    const c1 = B64_CHARS.indexOf(b64[i++]);
    const c2 = i < b64.length ? B64_CHARS.indexOf(b64[i++]) : 0;
    const c3 = i < b64.length && b64[i] !== "=" ? B64_CHARS.indexOf(b64[i++]) : -1;
    const c4 = i < b64.length && b64[i] !== "=" ? B64_CHARS.indexOf(b64[i++]) : -1;
    if (c1 < 0 || c2 < 0) break;
    out += String.fromCharCode((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) out += String.fromCharCode(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) out += String.fromCharCode(((c3 & 3) << 6) | c4);
  }
  return out;
}

/**
 * Decode the `exp` (seconds since epoch) from a JWT. Null when undecodable.
 * Only the ASCII `"exp":<digits>` is read, so UTF-8 in the payload is irrelevant.
 */
function jwtExpirySeconds(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadStr = base64UrlDecode(parts[1]);
    const m = /"exp"\s*:\s*(\d+)/.exec(payloadStr);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Is the stored access token still usable? True when present and either
 * undecodable (assume usable — the server will reject it if bad) or not
 * expired (30s clock-skew buffer). Purely local — no network call.
 */
export function isAccessTokenUsable(): boolean {
  if (!accessToken) return false;
  const exp = jwtExpirySeconds(accessToken);
  if (exp === null) return true;
  return exp * 1000 > Date.now() + 30_000;
}

export type RefreshResult = "ok" | "invalid" | "offline";

/**
 * Try to refresh the access token.
 * - "ok": new tokens saved.
 * - "invalid": the server definitively rejected the refresh token (401/403).
 *   The caller should log the user out.
 * - "offline": network error / server 5xx / timeout. Tokens are KEPT —
 *   the user stays logged in and the app works offline.
 */
export async function refreshAccessToken(): Promise<RefreshResult> {
  if (!refreshToken) return "invalid";
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return "offline"; // no network — keep tokens, stay logged in
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      await clearTokens();
      return "invalid";
    }
    return "offline"; // 5xx etc. — keep tokens
  }
  const data = await res.json();
  await saveTokens(data.access_token, data.refresh_token);
  return "ok";
}

// Backwards-compatible wrapper used by apiFetch.
async function refreshAccess(): Promise<boolean> {
  return (await refreshAccessToken()) === "ok";
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch (err) {
    // Network failure — surface it. Callers that are offline-tolerant
    // (startup, cached screens) handle it. Never clear tokens here.
    throw err;
  }
  if (res.status === 401 && retry && refreshToken) {
    if (await refreshAccess()) {
      headers.Authorization = `Bearer ${accessToken}`;
      res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    }
  }
  return res;
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: string }).detail;
    throw new Error(detail ?? `Request failed: ${res.status}`);
  }
  return data as T;
}
