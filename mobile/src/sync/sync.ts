import { apiFetch } from "../api/client";
import {
  getLocalPoints,
  getPendingSessions,
  markSynced,
  updateSyncProgress,
  type LocalSession,
} from "../walk/walkStore";

export type SyncSessionResult = {
  session_uuid: string;
  server_status: string;
  xp_total: number | null;
  total_valid_m: number | null;
  points_uploaded: number;
};

export type SyncReport = {
  synced: SyncSessionResult[];
  failed: { session_uuid: string; error: string }[];
  offline: boolean;
};

const CHUNK_SIZE = 100;

async function readJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function httpError(res: Response, data: any, what: string): Error {
  const err: any = new Error(data?.detail ?? `${what} failed: ${res.status}`);
  err.status = res.status;
  return err;
}

function isNetworkError(e: any): boolean {
  const msg = String(e?.message ?? "");
  return msg.includes("Network request failed") || msg.includes("Socket") || e instanceof TypeError;
}

async function uploadSession(
  session: LocalSession,
  report: SyncReport,
): Promise<void> {
  const uuid = session.session_uuid;

  // 1. Start is idempotent on the server (200 on re-send), so this is safe
  // to repeat after an interrupted sync.
  let res = await apiFetch("/sessions/start", {
    method: "POST",
    body: JSON.stringify({
      session_uuid: uuid,
      activity_mode: "walk",
      started_at: session.started_at,
    }),
  });
  await (async () => {
    const data = await readJsonSafe(res);
    if (!res.ok) throw httpError(res, data, "session start");
  })();

  // 2. Ask the server where it already is, so we resume instead of re-sending.
  let serverStatus: string | null = null;
  let serverResult: any = null;
  let lastUploaded = 0;
  res = await apiFetch(`/sessions/${uuid}`);
  if (res.ok) {
    const data = await res.json();
    serverStatus = data.status;
    serverResult = data.evaluation_result ?? null;
    lastUploaded = data.last_uploaded_seq ?? 0;
    if (serverStatus === "evaluated" || serverStatus === "flagged" || serverStatus === "rejected") {
      await markSynced(uuid, serverStatus, JSON.stringify(serverResult), lastUploaded);
      report.synced.push({
        session_uuid: uuid,
        server_status: serverStatus,
        xp_total: serverResult?.xp?.total ?? null,
        total_valid_m: serverResult?.total_valid_distance_m ?? null,
        points_uploaded: data.points_count ?? 0,
      });
      return;
    }
  } else if (res.status !== 404) {
    const data = await readJsonSafe(res);
    throw httpError(res, data, "session fetch");
  }

  // 3. Upload only the points the server does not have yet, in chunks.
  const allPoints = await getLocalPoints(uuid);
  const remaining = allPoints
    .filter((p) => p.seq > lastUploaded)
    .sort((a, b) => a.seq - b.seq);
  if (remaining.length === 0) {
    // Server has everything but the session is not in a final state
    // (evaluation still running via the jobs worker) — still synced.
    await markSynced(uuid, serverStatus ?? "pending_evaluation", JSON.stringify(serverResult), lastUploaded);
    report.synced.push({
      session_uuid: uuid,
      server_status: serverStatus ?? "pending_evaluation",
      xp_total: null,
      total_valid_m: null,
      points_uploaded: lastUploaded,
    });
    return;
  }

  let idx = 0;
  let finalData: any = null;
  while (idx < remaining.length) {
    const chunk = remaining.slice(idx, idx + CHUNK_SIZE);
    const isFinal = idx + CHUNK_SIZE >= remaining.length;
    const payload = {
      seq_start: chunk[0].seq,
      seq_end: chunk[chunk.length - 1].seq,
      points: chunk.map((p) => ({
        seq: p.seq,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy_m: p.accuracy_m,
        recorded_at: p.recorded_at,
      })),
      is_final: isFinal,
      total_steps: session.total_steps ?? null,
    };
    res = await apiFetch(`/sessions/${uuid}/chunks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.status === 409) {
      const data = await readJsonSafe(res);
      const m = String(data?.detail ?? "").match(/(\d+)/);
      if (!m) throw new Error(data?.detail ?? "Chunk rejected (409)");
      const expected = parseInt(m[1], 10);
      const newIdx = remaining.findIndex((p) => p.seq === expected);
      if (newIdx === -1) throw new Error(`Server expects unknown seq ${expected}`);
      idx = newIdx;
      continue;
    }
    const data = await readJsonSafe(res);
    if (!res.ok) throw httpError(res, data, "chunk upload");
    lastUploaded = data.last_uploaded_seq ?? chunk[chunk.length - 1].seq;
    await updateSyncProgress(uuid, lastUploaded);
    if (isFinal) finalData = data;
    idx += chunk.length;
  }

  const finalStatus = finalData?.status ?? "pending_evaluation";
  const finalResult = finalData?.evaluation_result ?? null;
  await markSynced(uuid, finalStatus, JSON.stringify(finalResult), lastUploaded);
  report.synced.push({
    session_uuid: uuid,
    server_status: finalStatus,
    xp_total: finalResult?.xp?.total ?? null,
    total_valid_m: finalResult?.total_valid_distance_m ?? null,
    points_uploaded: lastUploaded,
  });
}

export async function syncPendingSessions(): Promise<SyncReport> {
  const report: SyncReport = { synced: [], failed: [], offline: false };
  const pending = await getPendingSessions();
  for (const session of pending) {
    try {
      await uploadSession(session, report);
    } catch (e: any) {
      if (isNetworkError(e)) {
        report.offline = true;
        break;
      }
      report.failed.push({
        session_uuid: session.session_uuid,
        error: e?.message ?? "Unknown error",
      });
    }
  }
  return report;
}
