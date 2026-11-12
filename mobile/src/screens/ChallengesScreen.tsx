import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "../api/client";
import { getCached, lastSyncedLabel, setCached } from "../cache/cache";
import { useLanguage } from "../i18n/LanguageContext";
import Avatar, { AvatarPreset } from "../components/Avatar";

type FriendEntry = {
  user_id: string;
  display_name: string;
  weekly_xp: number;
  avatar_key: string | null;
  city: string | null;
};

type Challenge = {
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

const TARGETS = [1000, 3000, 5000];
const DURATIONS = [1, 3, 7];
const GREEN = "#22c55e";

function statusText(ch: Challenge, myId: string | null, t: (key: any, params?: any) => string): string {
  if (ch.status === "pending") {
    if (myId && ch.challenger_id === myId) return t("challenges.waitingReply");
    return t("challenges.receivedPrompt");
  }
  if (ch.status === "active") return t("challenges.active");
  if (ch.status === "declined") return t("challenges.declined");
  if (ch.status === "expired") return t("challenges.expired");
  if (ch.status === "completed") {
    if (!ch.winner_id) return t("challenges.draw");
    const name = ch.winner_id === ch.challenger_id ? ch.challenger_display_name : ch.opponent_display_name;
    return t("challenges.won", { name });
  }
  return ch.status;
}

function timeLeft(iso: string | null, now: number): { d: number; h: number } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  return { d: Math.floor(h / 24), h: h % 24 };
}

export default function ChallengesScreen({ route }: any) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(route?.params?.opponentId ?? null);
  const [selectedName, setSelectedName] = useState<string>(route?.params?.opponentName ?? "");
  const [target, setTarget] = useState(1000);
  const [duration, setDuration] = useState(3);
  const [error, setError] = useState("");
  const [cacheLabel, setCacheLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setPresets(await apiJson<AvatarPreset[]>("/users/avatar-presets"));
      } catch {
        setPresets([]);
      }
    })();
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [fr, ch] = await Promise.all([
        apiJson<FriendEntry[]>("/friends"),
        apiJson<Challenge[]>("/challenges"),
      ]);
      setFriends(fr);
      setChallenges(ch);
      await setCached("friends:list", fr);
      await setCached("challenges:list", ch);
      setCacheLabel("");
    } catch {
      // Offline: show the cached lists (if any) with a "Cached" label.
      const cachedFr = await getCached<FriendEntry[]>("friends:list");
      const cachedCh = await getCached<Challenge[]>("challenges:list");
      if (cachedFr || cachedCh) {
        if (cachedFr) setFriends(cachedFr.data);
        if (cachedCh) setChallenges(cachedCh.data);
        setCacheLabel(lastSyncedLabel((cachedFr ?? cachedCh)!.updatedAt));
        setError("");
      } else {
        setError(t("challenges.loadFailed"));
      }
    }
    try {
      const me = await apiJson<any>("/auth/me");
      setMyId(me.id ?? me.user_id ?? null);
    } catch {
      // myId optional hai: sirf accept/decline buttons chhup jayenge.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const send = useCallback(async () => {
    if (!selectedId) {
      setError(t("challenges.pickFriendFirst"));
      return;
    }
    setError("");
    setMsg("");
    try {
      await apiJson("/challenges", {
        method: "POST",
        body: JSON.stringify({ opponent_id: selectedId, target_m: target, duration_days: duration }),
      });
      setMsg(t("challenges.sent"));
      await loadAll();
    } catch (e: any) {
      setError(e.message ?? t("challenges.sendFailed"));
    }
  }, [selectedId, target, duration, loadAll]);

  const answer = useCallback(
    async (id: string, kind: "accept" | "decline") => {
      setError("");
      setMsg("");
      try {
        await apiJson(`/challenges/${id}/${kind}`, { method: "POST" });
        setMsg(kind === "accept" ? t("challenges.started") : t("challenges.declinedMsg"));
        await loadAll();
      } catch (e: any) {
        setError(e.message ?? t("challenges.actionFailed"));
      }
    },
    [loadAll],
  );

  const challengeAgain = useCallback(
    (ch: Challenge) => {
      const otherId = myId && ch.challenger_id === myId ? ch.opponent_id : ch.challenger_id;
      const otherName = myId && ch.challenger_id === myId ? ch.opponent_display_name : ch.challenger_display_name;
      setSelectedId(otherId);
      setSelectedName(otherName);
      setTarget(ch.target_m);
      setDuration(ch.duration_days);
      setMsg("");
      setError("");
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    },
    [myId],
  );

  const active = challenges.filter((ch) => ch.status === "pending" || ch.status === "active");
  const done = challenges.filter((ch) => ch.status !== "pending" && ch.status !== "active");

  const renderCard = (ch: Challenge) => {
    const meChallenger = myId ? ch.challenger_id === myId : false;
    const myDist = meChallenger ? ch.challenger_distance_m : ch.opponent_distance_m;
    const otherDist = meChallenger ? ch.opponent_distance_m : ch.challenger_distance_m;
    const otherName = meChallenger ? ch.opponent_display_name : ch.challenger_display_name;
    const durText =
      ch.duration_days === 1
        ? t("challenges.day", { d: ch.duration_days })
        : t("challenges.days", { d: ch.duration_days });
    const left =
      ch.status === "active" ? timeLeft(ch.deadline_at, now) : ch.status === "pending" ? timeLeft(ch.expires_at, now) : null;
    const myPct = Math.min(myDist / ch.target_m, 1) * 100;
    const otherPct = Math.min(otherDist / ch.target_m, 1) * 100;
    const isDone = ch.status !== "pending" && ch.status !== "active";
    return (
      <View key={ch.challenge_id} style={styles.card}>
        <Text style={styles.name}>
          {t("challenges.cardTitle", { name: otherName, km: ch.target_m / 1000, duration: durText })}
        </Text>
        <Text style={styles.sub}>{t("challenges.distances", { my: Math.round(myDist), other: Math.round(otherDist) })}</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${myPct}%`, backgroundColor: GREEN }]} />
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${otherPct}%`, backgroundColor: "#94a3b8" }]} />
        </View>
        <Text style={styles.sub}>{statusText(ch, myId, t)}</Text>
        {left ? <Text style={styles.sub}>{"\u23F3 "}{t("challenges.timeLeft", { d: left.d, h: left.h })}</Text> : null}
        {ch.status === "pending" && myId && ch.opponent_id === myId ? (
          <View style={styles.btnRow}>
            <Pressable style={[styles.btn, styles.btnPrimary, styles.btnHalf]} onPress={() => answer(ch.challenge_id, "accept")}>
              <Text style={styles.btnPrimaryText}>{t("challenges.accept")}</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnGrey, styles.btnHalf]} onPress={() => answer(ch.challenge_id, "decline")}>
              <Text style={styles.btnGreyText}>{t("challenges.decline")}</Text>
            </Pressable>
          </View>
        ) : null}
        {isDone ? (
          <Pressable style={[styles.btn, styles.btnOutline]} onPress={() => challengeAgain(ch)}>
            <Text style={styles.btnOutlineText}>{t("challenges.challengeAgain")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.box}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cacheLabel ? <Text style={{ color: "#888", textAlign: "center" }}>Cached · {cacheLabel}</Text> : null}
      {msg ? <Text style={styles.sub}>{msg}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.head}>{t("challenges.newChallenge")}</Text>
        {selectedName ? <Text style={styles.sub}>{t("challenges.friend", { name: selectedName })}</Text> : null}
        {friends.map((f) => (
          <Pressable
            key={f.user_id}
            style={[styles.row, selectedId === f.user_id ? styles.rowSelected : null]}
            onPress={() => {
              setSelectedId(f.user_id);
              setSelectedName(f.display_name);
            }}
          >
            <Avatar avatarKey={f.avatar_key} presets={presets} displayName={f.display_name} size={36} />
            <Text style={styles.name}>{f.display_name}</Text>
            <Text style={selectedId === f.user_id ? styles.selectedTag : styles.selectTag}>
              {selectedId === f.user_id ? t("challenges.selected") : t("challenges.select")}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.sub2}>{t("challenges.target")}</Text>
        <View style={styles.tabRow}>
          {TARGETS.map((tg) => (
            <Pressable key={tg} onPress={() => setTarget(tg)}>
              <Text style={target === tg ? styles.chipActive : styles.chipInactive}>{`${tg / 1000} km`}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sub2}>{t("challenges.duration")}</Text>
        <View style={styles.tabRow}>
          {DURATIONS.map((d) => (
            <Pressable key={d} onPress={() => setDuration(d)}>
              <Text style={duration === d ? styles.chipActive : styles.chipInactive}>{d === 1 ? t("challenges.day", { d }) : t("challenges.days", { d })}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={send}>
          <Text style={styles.btnPrimaryText}>{t("challenges.send")}</Text>
        </Pressable>
      </View>

      <Text style={styles.head}>{t("challenges.active")}</Text>
      {active.length === 0 ? <Text style={styles.sub}>{t("challenges.noChallenges")}</Text> : null}
      {active.map(renderCard)}

      {done.length > 0 ? (
        <>
          <Text style={styles.head}>{t("challenges.completed")}</Text>
          {done.map(renderCard)}
        </>
      ) : null}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", marginBottom: 12 },
  head: { fontSize: 18, fontWeight: "bold", marginTop: 16, marginBottom: 8 },
  sub: { textAlign: "center", color: "#555", marginVertical: 4 },
  sub2: { fontSize: 15, fontWeight: "600", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 8, gap: 8, borderRadius: 8 },
  rowSelected: { backgroundColor: "#e8f5e9" },
  name: { fontSize: 16, flex: 1 },
  selectTag: { fontSize: 14, color: "#888", fontWeight: "600" },
  selectedTag: { fontSize: 14, color: GREEN, fontWeight: "bold" },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14, marginBottom: 12 },
  tabRow: { flexDirection: "row", justifyContent: "center", gap: 12, marginVertical: 6 },
  chipActive: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#fff",
    backgroundColor: GREEN,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  chipInactive: {
    fontSize: 16,
    color: "#555",
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  barTrack: { height: 8, backgroundColor: "#e5e7eb", borderRadius: 4, overflow: "hidden", marginVertical: 4 },
  barFill: { height: 8, borderRadius: 4 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnHalf: { flex: 1, marginTop: 0 },
  btnPrimary: { backgroundColor: GREEN },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  btnOutline: { borderWidth: 1, borderColor: GREEN },
  btnOutlineText: { color: GREEN, fontSize: 16, fontWeight: "bold" },
  btnGrey: { backgroundColor: "#e5e7eb" },
  btnGreyText: { color: "#333", fontSize: 16, fontWeight: "bold" },
  error: { color: "red", textAlign: "center" },
});
