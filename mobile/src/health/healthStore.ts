import * as Crypto from "expo-crypto";
import { getDb } from "../db/database";
import { apiJson } from "../api/client";
import { getCached, setCached } from "../cache/cache";

/**
 * Offline-first Health store (Batch A, 2026-11-09).
 *
 * Phone pehle, server baad mein: every health log is saved to local
 * SQLite immediately (works offline), then synced to the server when
 * online. Sync is idempotent via client_uuid, so a log is never
 * duplicated. Targets live in api_cache locally and sync via PUT.
 * Exercise saves queue in a small outbox (POST /exercise on sync).
 */

export type HealthKind = "meal" | "water" | "sleep" | "exercise";

export type LocalHealthLog = {
  client_uuid: string;
  kind: string;
  logged_date: string;
  payload: Record<string, any>;
  sync_status: "pending" | "synced";
  created_at: string;
};

export type LocalSummary = {
  logged_date: string;
  logs_count: number;
  meals_count: number;
  total_calories: number | null;
  water_ml: number;
  sleep_minutes: number;
  exercise_minutes: number;
};

export type Targets = { dailySteps: number; weeklyKm: number };

const TARGETS_KEY = "health_targets";
const DEFAULT_TARGETS: Targets = { dailySteps: 10000, weeklyKm: 7 };

async function ensureTables(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS health_logs (
      client_uuid TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      logged_date TEXT NOT NULL,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_health_logs_date
      ON health_logs (logged_date, sync_status);
    CREATE TABLE IF NOT EXISTS health_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

/** Save a health log locally. Always works offline. Returns client_uuid. */
export async function saveHealthLogLocal(
  kind: string,
  payload: Record<string, any>,
  logged_date: string,
): Promise<string> {
  const client_uuid = Crypto.randomUUID();
  try {
    await ensureTables();
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO health_logs (client_uuid, kind, logged_date, payload, sync_status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      [client_uuid, kind, logged_date, JSON.stringify(payload), new Date().toISOString()],
    );
  } catch {
    // Local save failed (should not happen) — caller falls back to direct POST.
    throw new Error("local-save-failed");
  }
  return client_uuid;
}

/** Today's summary computed from the LOCAL table (works offline). */
export async function getLocalSummary(logged_date: string): Promise<LocalSummary | null> {
  try {
    await ensureTables();
    const db = await getDb();
    const rows = await db.getAllAsync<{ kind: string; payload: string }>(
      "SELECT kind, payload FROM health_logs WHERE logged_date = ?",
      [logged_date],
    );
    if (rows.length === 0) return null;
    let meals = 0;
    let kcal: number | null = null;
    let water = 0;
    let sleep = 0;
    let exercise = 0;
    for (const r of rows) {
      let p: Record<string, any> = {};
      try {
        p = JSON.parse(r.payload) ?? {};
      } catch {
        p = {};
      }
      if (r.kind === "meal") {
        meals += 1;
        if (typeof p.calories === "number") kcal = (kcal ?? 0) + p.calories;
      } else if (r.kind === "water") {
        if (typeof p.millilitres === "number") water += p.millilitres;
      } else if (r.kind === "sleep") {
        if (typeof p.minutes === "number") sleep += p.minutes;
      } else if (r.kind === "exercise") {
        if (typeof p.minutes === "number") exercise += p.minutes;
      }
    }
    return {
      logged_date,
      logs_count: rows.length,
      meals_count: meals,
      total_calories: kcal,
      water_ml: water,
      sleep_minutes: sleep,
      exercise_minutes: exercise,
    };
  } catch {
    return null;
  }
}

/** Local logs for a date (newest first). */
export async function getLocalLogs(logged_date: string): Promise<LocalHealthLog[]> {
  try {
    await ensureTables();
    const db = await getDb();
    const rows = await db.getAllAsync<{
      client_uuid: string;
      kind: string;
      logged_date: string;
      payload: string;
      sync_status: string;
      created_at: string;
    }>(
      "SELECT client_uuid, kind, logged_date, payload, sync_status, created_at FROM health_logs WHERE logged_date = ? ORDER BY created_at DESC",
      [logged_date],
    );
    return rows.map((r) => ({
      client_uuid: r.client_uuid,
      kind: r.kind,
      logged_date: r.logged_date,
      payload: JSON.parse(r.payload ?? "{}") as Record<string, any>,
      sync_status: (r.sync_status === "synced" ? "synced" : "pending") as "pending" | "synced",
      created_at: r.created_at,
    }));
  } catch {
    return [];
  }
}

/** Upload pending logs to the server (idempotent via client_uuid). */
export async function syncPendingHealthLogs(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  try {
    await ensureTables();
    const db = await getDb();
    const rows = await db.getAllAsync<{
      client_uuid: string;
      kind: string;
      logged_date: string;
      payload: string;
    }>("SELECT client_uuid, kind, logged_date, payload FROM health_logs WHERE sync_status = 'pending' ORDER BY created_at ASC LIMIT 100");
    for (const r of rows) {
      try {
        await apiJson("/health-logs", {
          method: "POST",
          body: JSON.stringify({
            kind: r.kind,
            logged_date: r.logged_date,
            payload: JSON.parse(r.payload ?? "{}"),
            client_uuid: r.client_uuid,
          }),
        });
        await db.runAsync("UPDATE health_logs SET sync_status = 'synced' WHERE client_uuid = ?", [r.client_uuid]);
        synced += 1;
      } catch {
        failed += 1;
      }
    }
  } catch {
    // Sync is best-effort.
  }
  return { synced, failed };
}

/** How many health logs are still waiting to sync. */
export async function getPendingExerciseCount(): Promise<number> {
  try {
    await ensureTables();
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM health_outbox",
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function getPendingHealthCount(): Promise<number> {
  try {
    await ensureTables();
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM health_logs WHERE sync_status = 'pending'",
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Queue an exercise save (POST /exercise) for later sync. */
export async function enqueueExercise(exercise_type: string, duration_minutes: number): Promise<void> {
  try {
    await ensureTables();
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO health_outbox (endpoint, body, created_at) VALUES (?, ?, ?)",
      [
        "/exercise",
        JSON.stringify({ exercise_type, duration_minutes }),
        new Date().toISOString(),
      ],
    );
  } catch {
    // Best-effort; the stopwatch keeps its timer.
  }
}

/** Drain the exercise outbox (POST each queued exercise). */
export async function drainExerciseOutbox(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  try {
    await ensureTables();
    const db = await getDb();
    const rows = await db.getAllAsync<{ id: number; endpoint: string; body: string }>(
      "SELECT id, endpoint, body FROM health_outbox ORDER BY id ASC LIMIT 50",
    );
    for (const r of rows) {
      try {
        await apiJson(r.endpoint, { method: "POST", body: r.body });
        await db.runAsync("DELETE FROM health_outbox WHERE id = ?", [r.id]);
        synced += 1;
      } catch {
        failed += 1;
      }
    }
  } catch {
    // Best-effort.
  }
  return { synced, failed };
}

/** Targets: read local (api_cache) with server defaults. */
export async function getTargetsLocal(): Promise<Targets> {
  const cached = await getCached<Targets>(TARGETS_KEY);
  return cached?.data ?? DEFAULT_TARGETS;
}

/** Targets: save locally (works offline) and try to sync to the server. */
export async function saveTargetsLocal(t: Targets): Promise<{ synced: boolean }> {
  await setCached(TARGETS_KEY, t);
  try {
    await apiJson("/users/me/targets", {
      method: "PUT",
      body: JSON.stringify({ daily_steps_target: t.dailySteps, weekly_distance_km_target: t.weeklyKm }),
    });
    return { synced: true };
  } catch {
    return { synced: false };
  }
}

/** Push locally-saved targets to the server (call on reconnect/focus). */
export async function syncTargets(): Promise<boolean> {
  try {
    const t = await getTargetsLocal();
    await apiJson("/users/me/targets", {
      method: "PUT",
      body: JSON.stringify({ daily_steps_target: t.dailySteps, weekly_distance_km_target: t.weeklyKm }),
    });
    return true;
  } catch {
    return false;
  }
}
