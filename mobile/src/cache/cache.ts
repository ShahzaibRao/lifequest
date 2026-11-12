import { getDb } from "../db/database";

export type Cached<T> = { data: T; updatedAt: string } | null;

async function ensureTable(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY NOT NULL,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

/** Save an API response to the local cache (overwrites). */
export async function setCached(key: string, data: unknown): Promise<void> {
  try {
    await ensureTable();
    const db = await getDb();
    await db.runAsync(
      "INSERT OR REPLACE INTO api_cache (key, json, updated_at) VALUES (?, ?, ?)",
      [key, JSON.stringify(data), new Date().toISOString()]
    );
  } catch {
    // Cache is best-effort — never break the app.
  }
}

/** Read a cached API response. Returns null when there is no entry. */
export async function getCached<T>(key: string): Promise<Cached<T>> {
  try {
    await ensureTable();
    const db = await getDb();
    const row = await db.getFirstAsync<{ json: string; updated_at: string }>(
      "SELECT json, updated_at FROM api_cache WHERE key = ?",
      [key]
    );
    if (!row) return null;
    return { data: JSON.parse(row.json) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/** Human-readable "Last synced" label (e.g. "2h ago", "3d ago"). */
export function lastSyncedLabel(updatedAt: string): string {
  const ms = Date.now() - new Date(updatedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
