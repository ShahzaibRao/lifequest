import { getDb } from "../db/database";

export type LocalSession = {
  session_uuid: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  total_steps: number | null;
};

export type LocalPoint = {
  seq: number;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recorded_at: string;
};

export async function createLocalSession(sessionUuid: string, startedAt: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO local_sessions (session_uuid, status, started_at, ended_at, total_steps, created_at) VALUES (?, 'active', ?, NULL, NULL, ?)",
    [sessionUuid, startedAt, new Date().toISOString()],
  );
}

export async function getUnfinishedSession(): Promise<LocalSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<LocalSession>(
    "SELECT session_uuid, status, started_at, ended_at, total_steps FROM local_sessions WHERE status IN ('active', 'paused') ORDER BY created_at DESC LIMIT 1",
  );
  return row ?? null;
}

export async function getPointsCount(sessionUuid: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM local_points WHERE session_uuid = ?",
    [sessionUuid],
  );
  return row?.n ?? 0;
}

export async function getMaxSeq(sessionUuid: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ m: number | null }>(
    "SELECT MAX(seq) AS m FROM local_points WHERE session_uuid = ?",
    [sessionUuid],
  );
  return row?.m ?? 0;
}

export async function deleteStaleSessions(maxAgeHours = 24): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const stale = await db.getAllAsync<{ session_uuid: string }>(
    "SELECT session_uuid FROM local_sessions WHERE status IN ('active', 'paused') AND started_at < ?",
    [cutoff],
  );
  for (const row of stale) {
    await deleteLocalSession(row.session_uuid);
  }
  return stale.length;
}

export async function insertPoint(sessionUuid: string, point: LocalPoint): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO local_points (session_uuid, seq, latitude, longitude, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
    [sessionUuid, point.seq, point.latitude, point.longitude, point.accuracy_m, point.recorded_at],
  );
}

export async function setSessionStatus(
  sessionUuid: string,
  status: string,
  endedAt: string | null = null,
  totalSteps: number | null = null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE local_sessions SET status = ?, ended_at = COALESCE(?, ended_at), total_steps = COALESCE(?, total_steps) WHERE session_uuid = ?",
    [status, endedAt, totalSteps, sessionUuid],
  );
}

export async function deleteLocalSession(sessionUuid: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM local_points WHERE session_uuid = ?", [sessionUuid]);
  await db.runAsync("DELETE FROM local_sessions WHERE session_uuid = ?", [sessionUuid]);
}

export async function getPendingSessions(): Promise<LocalSession[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSession>(
    "SELECT session_uuid, status, started_at, ended_at, total_steps FROM local_sessions WHERE status = 'pending_sync' ORDER BY created_at ASC",
  );
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM local_sessions WHERE status = 'pending_sync'",
  );
  return row?.n ?? 0;
}

export async function getLocalPoints(sessionUuid: string): Promise<LocalPoint[]> {
  const db = await getDb();
  return db.getAllAsync<LocalPoint>(
    "SELECT seq, latitude, longitude, accuracy_m, recorded_at FROM local_points WHERE session_uuid = ? ORDER BY seq ASC",
    [sessionUuid],
  );
}

export async function updateSyncProgress(sessionUuid: string, lastSeq: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE local_sessions SET last_uploaded_seq = ? WHERE session_uuid = ?",
    [lastSeq, sessionUuid],
  );
}

export async function markSynced(
  sessionUuid: string,
  serverStatus: string,
  serverResultJson: string,
  lastSeq: number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE local_sessions SET status = 'synced', server_status = ?, server_result = ?, last_uploaded_seq = ? WHERE session_uuid = ?",
    [serverStatus, serverResultJson, lastSeq, sessionUuid],
  );
}

export async function getActiveSession(): Promise<LocalSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<LocalSession>(
    "SELECT session_uuid, status, started_at, ended_at, total_steps FROM local_sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1",
  );
  return row ?? null;
}
