import { getDb } from "../db/database";
import { METERS_PER_STEP } from "./phoneSteps";

/** PKT offset (UTC+5). started_at is stored as UTC ISO text. */
const PKT_MS = 5 * 60 * 60 * 1000;

function pktDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + PKT_MS).toISOString().slice(0, 10);
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type LocalDay = { date: string; steps: number | null; valid_m: number; sessions: number };

type SessionRow = { session_uuid: string; started_at: string; total_steps: number | null };
type PointRow = { session_uuid: string; latitude: number; longitude: number; recorded_at: string };

async function loadSessions(): Promise<SessionRow[]> {
  try {
    const db = await getDb();
    return await db.getAllAsync(
      "SELECT session_uuid, started_at, total_steps FROM local_sessions"
    );
  } catch {
    return [];
  }
}

async function loadPoints(): Promise<PointRow[]> {
  try {
    const db = await getDb();
    return await db.getAllAsync(
      "SELECT session_uuid, latitude, longitude, recorded_at FROM local_points ORDER BY session_uuid, seq"
    );
  } catch {
    return [];
  }
}

/** Distance (m) per session from its GPS points (haversine, consecutive points). */
function distanceBySession(points: PointRow[]): Map<string, number> {
  const bySession = new Map<string, PointRow[]>();
  for (const p of points) {
    const arr = bySession.get(p.session_uuid) ?? [];
    arr.push(p);
    bySession.set(p.session_uuid, arr);
  }
  const out = new Map<string, number>();
  for (const [uuid, pts] of bySession) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += haversineM(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
    }
    out.set(uuid, total);
  }
  return out;
}

/** One day's summary from local SQLite (PKT date, YYYY-MM-DD). */
export async function getLocalDay(date: string): Promise<LocalDay> {
  const sessions = await loadSessions();
  const daySessions = sessions.filter((s) => pktDate(s.started_at) === date);
  if (daySessions.length === 0) return { date, steps: null, valid_m: 0, sessions: 0 };
  const points = await loadPoints();
  const dist = distanceBySession(points);
  let steps = 0;
  let hasSteps = false;
  let valid_m = 0;
  for (const s of daySessions) {
    if (s.total_steps !== null) {
      steps += s.total_steps;
      hasSteps = true;
    }
    valid_m += dist.get(s.session_uuid) ?? 0;
  }
  // If no GPS distance (no points), estimate from steps.
  if (valid_m === 0 && hasSteps) valid_m = steps * METERS_PER_STEP;
  return { date, steps: hasSteps ? steps : null, valid_m: Math.round(valid_m * 10) / 10, sessions: daySessions.length };
}

/** Daily summaries for the current week (Mon-Sun, PKT). */
export async function getLocalWeek(): Promise<LocalDay[]> {
  const now = new Date(Date.now() + PKT_MS);
  const dow = (now.getUTCDay() + 6) % 7; // Monday-first
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - dow);
  const out: LocalDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    out.push(await getLocalDay(date));
  }
  return out;
}

/** Daily summaries for a month (only days with sessions). */
export async function getLocalMonth(year: number, month: number): Promise<LocalDay[]> {
  const sessions = await loadSessions();
  const points = await loadPoints();
  const dist = distanceBySession(points);
  const byDay = new Map<string, { steps: number; hasSteps: boolean; valid_m: number; sessions: number }>();
  for (const s of sessions) {
    const date = pktDate(s.started_at);
    if (!date) continue;
    const [y, m] = date.split("-").map(Number);
    if (y !== year || m !== month) continue;
    const rec = byDay.get(date) ?? { steps: 0, hasSteps: false, valid_m: 0, sessions: 0 };
    if (s.total_steps !== null) {
      rec.steps += s.total_steps;
      rec.hasSteps = true;
    }
    rec.valid_m += dist.get(s.session_uuid) ?? 0;
    rec.sessions += 1;
    byDay.set(date, rec);
  }
  const out: LocalDay[] = [];
  for (const [date, rec] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    let valid_m = rec.valid_m;
    if (valid_m === 0 && rec.hasSteps) valid_m = rec.steps * METERS_PER_STEP;
    out.push({ date, steps: rec.hasSteps ? rec.steps : null, valid_m: Math.round(valid_m * 10) / 10, sessions: rec.sessions });
  }
  return out;
}
