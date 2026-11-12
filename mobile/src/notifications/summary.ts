import { apiJson } from "../api/client";
import { getCached, setCached } from "../cache/cache";

export type ReqItem = {
  request_id: string;
  other_user_id: string;
  other_display_name: string;
  avatar_key: string | null;
  city: string | null;
};

export type Challenge = {
  challenge_id: string;
  challenger_id: string;
  opponent_id: string;
  challenger_display_name: string;
  opponent_display_name: string;
  target_m: number;
  duration_days: number;
  status: string;
  winner_id: string | null;
  challenger_distance_m: number;
  opponent_distance_m: number;
  expires_at: string;
  accepted_at: string | null;
  deadline_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type MeItem = {
  h3_index: string;
  hex_score_m: number;
  expires_at: string;
  locked_until: string;
  seconds_remaining: number;
};

export type NotifSummary = {
  receivedRequests: ReqItem[];
  pendingChallenges: Challenge[];
  activeChallenges: Challenge[];
  expiringHexes: MeItem[];
  myId: string | null;
  total: number;
};

const DISMISSED_KEY = "notif_dismissed";

/** Dismissed notification keys (persisted in local SQLite). */
export async function getDismissedIds(): Promise<Set<string>> {
  const cached = await getCached<string[]>(DISMISSED_KEY);
  return new Set(cached?.data ?? []);
}

/** Mark one notification as read (dismissed). Persists locally. */
export async function dismissNotif(key: string): Promise<void> {
  const ids = await getDismissedIds();
  ids.add(key);
  await setCached(DISMISSED_KEY, [...ids]);
}

// One fetch for the bell badge (Home) and the Notifications screen.
// Every source is an existing endpoint — no new backend needed.
// A failed source falls back to empty so one outage hides nothing else.
export async function fetchNotifSummary(): Promise<NotifSummary> {
  const [req, ch, me, my, dismissed] = await Promise.all([
    apiJson<{ received: ReqItem[]; sent: ReqItem[] }>("/friends/requests").catch(() => ({
      received: [],
      sent: [],
    })),
    apiJson<Challenge[]>("/challenges").catch(() => []),
    apiJson<MeItem[]>("/territories/me").catch(() => []),
    apiJson<any>("/auth/me").catch(() => null),
    getDismissedIds(),
  ]);
  const myId: string | null = my?.id ?? my?.user_id ?? null;
  const receivedRequests = (req.received ?? []).filter((r) => !dismissed.has(`req:${r.request_id}`));
  const pendingChallenges = ch.filter(
    (c) => c.status === "pending" && (!myId || c.opponent_id === myId) && !dismissed.has(`ch:${c.challenge_id}`),
  );
  const activeChallenges = ch
    .filter((c) => c.status === "active")
    .filter((c) => !dismissed.has(`ch:${c.challenge_id}`));
  const expiringHexes = me
    .filter((m) => m.seconds_remaining < 2 * 86400)
    .filter((m) => !dismissed.has(`hex:${m.h3_index}:${m.expires_at}`));
  const total =
    receivedRequests.length +
    pendingChallenges.length +
    activeChallenges.length +
    expiringHexes.length;
  return {
    receivedRequests,
    pendingChallenges,
    activeChallenges,
    expiringHexes,
    myId,
    total,
  };
}
