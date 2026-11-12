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

async function refreshAccess(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    await clearTokens();
    return false;
  }
  const data = await res.json();
  await saveTokens(data.access_token, data.refresh_token);
  return true;
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
  let res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
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
