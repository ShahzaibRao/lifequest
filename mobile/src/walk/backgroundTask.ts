import * as TaskManager from "expo-task-manager";
import type * as Location from "expo-location";
import {
  getActiveSession,
  getMaxSeq,
  insertPoint,
} from "./walkStore";
import { apiJson } from "../api/client";

export const WALK_TASK = "lifequest-walk-tracking";

// This runs outside the visible app (headless JS) while the Android
// foreground service keeps the process alive. It only writes points
// for the currently active local session — nothing else.
TaskManager.defineTask(WALK_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations: Location.LocationObject[] }).locations;
  if (!locations || locations.length === 0) return;
  const session = await getActiveSession();
  if (!session) return;
  let seq = await getMaxSeq(session.session_uuid);
  for (const pos of locations) {
    seq += 1;
    try {
      await insertPoint(session.session_uuid, {
        seq,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
        recorded_at: new Date(pos.timestamp).toISOString(),
      });
    } catch {
      // A duplicate seq must not kill the whole batch.
      seq = await getMaxSeq(session.session_uuid);
    }
  }
  // Live dot (background): the newest location in this batch. Awaited
  // so it actually goes out before the headless task ends, but a
  // failure is swallowed so it can never break point tracking.
  const last = locations[locations.length - 1];
  try {
    await apiJson("/live/position", {
      method: "POST",
      body: JSON.stringify({
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
      }),
    });
  } catch {
    // Live dots are best-effort; ignore the failure.
  }
});
