import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "../api/client";
import { getCached, lastSyncedLabel, setCached } from "../cache/cache";
import Avatar, { AvatarPreset } from "../components/Avatar";
import { useLanguage } from "../i18n/LanguageContext";

type Entry = {
  rank: number;
  user_id: string;
  display_name: string;
  xp: number;
  is_me: boolean;
  avatar_key: string | null;
  city: string | null;
};

type Board = {
  period: string;
  period_start: string;
  entries: Entry[];
  me_rank: number | null;
  me_xp: number;
  total_xp: number;
  level: number;
  month_xp: number;
  best_week_xp: number;
  last_week_xp: number;
};

type Period = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "all";
type Scope = "global" | "friends";

const PERIODS: { key: Period; labelKey: string }[] = [
  { key: "daily", labelKey: "leaderboard.periodToday" },
  { key: "weekly", labelKey: "leaderboard.periodWeek" },
  { key: "monthly", labelKey: "leaderboard.periodMonth" },
  { key: "quarterly", labelKey: "leaderboard.periodQuarter" },
  { key: "yearly", labelKey: "leaderboard.periodYear" },
  { key: "all", labelKey: "leaderboard.periodAll" },
];

const GREEN = "#22c55e";

export default function LeaderboardScreen({ navigation }: any) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [cacheLabel, setCacheLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<Scope>("global");
  const [period, setPeriod] = useState<Period>("weekly");
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [receivedIds, setReceivedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const base = scope === "friends" ? "/friends/leaderboard" : "/leaderboard";
      const b = await apiJson<Board>(`${base}?period=${period}`);
      setBoard(b);
      await setCached(`lb:${scope}:${period}`, b);
      setCacheLabel("");
    } catch {
      // Offline: show the cached board for this scope+period (if any).
      const cached = await getCached<Board>(`lb:${scope}:${period}`);
      if (cached) {
        setBoard(cached.data);
        setCacheLabel(lastSyncedLabel(cached.updatedAt));
        setError("");
      } else {
        setError(t("leaderboard.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, [scope, period]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiJson<AvatarPreset[]>("/users/avatar-presets").then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const friends = await apiJson<{ user_id: string }[]>("/friends");
        setFriendIds(new Set(friends.map((f) => f.user_id)));
      } catch {
        /* friend status optional - profile still opens */
      }
      try {
        const reqs = await apiJson<{ sent: { other_user_id: string }[]; received: { other_user_id: string }[] }>("/friends/requests");
        setSentIds(new Set(reqs.sent.map((r) => r.other_user_id)));
        setReceivedIds(new Set(reqs.received.map((r) => r.other_user_id)));
      } catch {
        /* friend status optional - profile still opens */
      }
    })();
  }, []);

  const statusFor = (item: Entry): string => {
    if (item.is_me) return "";
    if (scope === "friends") return "friends";
    if (friendIds.has(item.user_id)) return "friends";
    if (sentIds.has(item.user_id)) return "pending_sent";
    if (receivedIds.has(item.user_id)) return "pending_received";
    return "none";
  };

  const openProfile = (item: Entry) => {
    if (item.is_me) {
      navigation.navigate("Profile");
    } else {
      navigation.navigate("Profile", { userId: item.user_id, status: statusFor(item) });
    }
  };

  const rankColor = (rank: number) =>
    rank === 1 ? "#d97706" : rank === 2 ? "#94a3b8" : rank === 3 ? "#b45309" : "#888888";

  const entries = board?.entries ?? [];
  const allZero = entries.length > 0 && entries.every((e) => e.xp === 0);
  const showFreshStart = (period === "weekly" || period === "daily") && (entries.length === 0 || allZero);
  const xpToNext = 100 - (board ? board.total_xp % 100 : 0);
  const levelProgress = board ? (board.total_xp % 100) / 100 : 0;

  return (
    <View style={[styles.box, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.tabRow}>
        <Pressable onPress={() => setScope("global")}>
          <Text style={scope === "global" ? styles.tabActive : styles.tabInactive}>{t("leaderboard.global")}</Text>
        </Pressable>
        <Pressable onPress={() => setScope("friends")}>
          <Text style={scope === "friends" ? styles.tabActive : styles.tabInactive}>{t("leaderboard.friends")}</Text>
        </Pressable>
      </View>
      <View style={styles.periodWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
          {PERIODS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPeriod(p.key)}
            style={[styles.pill, period === p.key && styles.pillActive]}
          >
            <Text style={[styles.pillText, period === p.key && styles.pillTextActive]}>{t(p.labelKey as any)}</Text>
          </Pressable>
          ))}
        </ScrollView>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cacheLabel ? <Text style={{ color: "#888", textAlign: "center" }}>Cached · {cacheLabel}</Text> : null}
      {board ? (
        <View style={styles.meCard}>
          <Text style={styles.meTitle}>{t("leaderboard.yourRank")}</Text>
          <View style={styles.meRow}>
            <Text style={styles.meRank}>
              {board.me_rank !== null ? `#${board.me_rank}` : "—"}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.meXp}>
                {board.me_xp} XP · {t("leaderboard.totalXp")}: {board.total_xp} XP
              </Text>
              <Text style={styles.meSub}>
                {t("leaderboard.level")} {board.level} · {xpToNext} {t("leaderboard.xpToNext")}
              </Text>
            </View>
          </View>
          <View style={styles.levelBar}>
            <View style={[styles.levelFill, { width: `${Math.round(levelProgress * 100)}%` }]} />
          </View>
          <Text style={styles.meSub}>
            {t("leaderboard.thisMonth")}: {board.month_xp} XP · {t("leaderboard.bestWeek")}: {board.best_week_xp} XP ·{" "}
            {t("leaderboard.lastWeek")}: {board.last_week_xp} XP
          </Text>
        </View>
      ) : null}
      {showFreshStart ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t("leaderboard.freshStart")}</Text>
          <View style={styles.bannerRow}>
            <Pressable style={styles.bannerBtn} onPress={() => setPeriod("monthly")}>
              <Text style={styles.bannerBtnText}>{t("leaderboard.seeMonth")}</Text>
            </Pressable>
            <Pressable style={styles.bannerBtn} onPress={() => setPeriod("all")}>
              <Text style={styles.bannerBtnText}>{t("leaderboard.seeAllTime")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {scope === "friends" && !loading && !error && entries.length === 0 ? (
        <Text style={styles.sub}>{t("leaderboard.noFriends")}</Text>
      ) : null}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.user_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => openProfile(item)}>
            <View style={[styles.row, item.is_me ? styles.meRowBg : null]}>
              <View style={[styles.rankBadge, { backgroundColor: rankColor(item.rank) }]}>
                <Text style={styles.rankText}>{item.rank}</Text>
              </View>
              <Avatar avatarKey={item.avatar_key} presets={presets} displayName={item.display_name} size={40} />
              <View style={styles.nameCol}>
                <Text style={styles.name}>
                  {item.display_name}
                  {item.is_me ? t("leaderboard.you") : ""}
                </Text>
                {item.city ? <Text style={styles.city}>{item.city}</Text> : null}
              </View>
              <Text style={styles.xp}>{item.xp} XP</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24, paddingBottom: 8, gap: 12 },
  sub: { textAlign: "center", color: "#555" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  meRowBg: { backgroundColor: "#e8f5e9" },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rankText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  nameCol: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600" },
  city: { fontSize: 13, color: "#777" },
  xp: { fontSize: 16, fontWeight: "bold" },
  error: { color: "red", textAlign: "center" },
  tabRow: { flexDirection: "row", justifyContent: "center", gap: 12 },
  tabActive: { fontSize: 18, fontWeight: "bold", color: "#007AFF" },
  tabInactive: { fontSize: 18, color: "#888" },
  periodWrap: { height: 44, flexShrink: 0 },
  periodRow: { gap: 8, paddingHorizontal: 2, alignItems: "center" },
  pill: { borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, flexShrink: 0, justifyContent: "center", minHeight: 40 },
  pillActive: { backgroundColor: GREEN, borderColor: GREEN },
  pillText: { fontSize: 14, fontWeight: "bold", color: "#555" },
  pillTextActive: { color: "#fff" },
  meCard: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14, gap: 8 },
  meTitle: { fontSize: 15, fontWeight: "bold" },
  meRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  meRank: { fontSize: 28, fontWeight: "bold", color: GREEN },
  meXp: { fontSize: 15, fontWeight: "bold" },
  meSub: { fontSize: 13, color: "#555", marginTop: 2 },
  levelBar: { height: 10, backgroundColor: "#e5e7eb", borderRadius: 5, overflow: "hidden" },
  levelFill: { height: "100%", backgroundColor: GREEN, borderRadius: 5 },
  banner: { backgroundColor: "#fef3c7", borderWidth: 1, borderColor: "#f59e0b", borderRadius: 12, padding: 12, gap: 8 },
  bannerText: { fontSize: 14, color: "#92400e" },
  bannerRow: { flexDirection: "row", gap: 8 },
  bannerBtn: { flex: 1, backgroundColor: "#f59e0b", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  bannerBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
});
