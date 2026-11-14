import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "../api/client";
import { getCached, lastSyncedLabel, setCached } from "../cache/cache";
import { useLanguage } from "../i18n/LanguageContext";

type AchievementItem = {
  key: string;
  unlocked: boolean;
  unlocked_at: string | null;
};

type AchievementsData = {
  level: number;
  total_xp: number;
  xp_progress: number;
  xp_to_next: number;
  achievements: AchievementItem[];
  progress?: {
    territories_held: number;
    friend_wins: number;
    total_valid_m: number;
  };
};

const ACH_META: Record<string, { title: string; desc: string }> = {
  first_walk: { title: "achievements.t_first_walk", desc: "achievements.d_first_walk" },
  first_capture: { title: "achievements.t_first_capture", desc: "achievements.d_first_capture" },
  first_challenge_win: { title: "achievements.t_first_challenge_win", desc: "achievements.d_first_challenge_win" },
  first_friend_win: { title: "achievements.t_first_friend_win", desc: "achievements.d_first_friend_win" },
  collector_5: { title: "achievements.t_collector_5", desc: "achievements.d_collector_5" },
  walker_10km: { title: "achievements.t_walker_10km", desc: "achievements.d_walker_10km" },
  walker_50km: { title: "achievements.t_walker_50km", desc: "achievements.d_walker_50km" },
  rival_5: { title: "achievements.t_rival_5", desc: "achievements.d_rival_5" },
};

const GREEN = "#22c55e";

function progressFor(
  key: string,
  p: AchievementsData["progress"] | undefined,
): { text: string; pct: number } | null {
  if (!p) return null;
  if (key === "collector_5") return { text: `${p.territories_held} / 5`, pct: Math.min(p.territories_held / 5, 1) * 100 };
  if (key === "rival_5") return { text: `${p.friend_wins} / 5`, pct: Math.min(p.friend_wins / 5, 1) * 100 };
  if (key === "walker_10km")
    return { text: `${(p.total_valid_m / 1000).toFixed(1)} / 10 km`, pct: Math.min(p.total_valid_m / 10000, 1) * 100 };
  if (key === "walker_50km")
    return { text: `${(p.total_valid_m / 1000).toFixed(1)} / 50 km`, pct: Math.min(p.total_valid_m / 50000, 1) * 100 };
  return null;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function AchievementsScreen() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const tr = t as (key: any, params?: any) => string;
  const [data, setData] = useState<AchievementsData | null>(null);
  const [error, setError] = useState("");
  const [cacheLabel, setCacheLabel] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await apiJson<AchievementsData>("/achievements");
      setData(d);
      await setCached("achievements", d);
      setCacheLabel("");
    } catch {
      // Offline: show the cached achievements (if any) with a "Cached" label.
      const cached = await getCached<AchievementsData>("achievements");
      if (cached) {
        setData(cached.data);
        setCacheLabel(lastSyncedLabel(cached.updatedAt));
        setError("");
      } else {
        setError(t("achievements.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
        <Text>{t("achievements.loading")}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {error ? <Text>{error}</Text> : null}
      {cacheLabel ? <Text style={{ color: "#888", textAlign: "center" }}>Cached · {cacheLabel}</Text> : null}
      {data ? (
        <View>
          <View style={styles.levelCard}>
            <Text style={styles.level}>{tr("achievements.level", { level: data.level })}</Text>
            <Text style={styles.sub}>{tr("achievements.totalXp", { xp: data.total_xp })}</Text>
            <Text style={styles.sub}>
              {tr("achievements.progress", { progress: data.xp_progress, next: data.level + 1 })}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${data.xp_progress}%` }]} />
            </View>
          </View>
          {data.achievements.map((a) => {
            const meta = ACH_META[a.key];
            const prog = !a.unlocked ? progressFor(a.key, data.progress) : null;
            return (
              <View key={a.key} style={styles.row}>
                <View style={[styles.badge, a.unlocked ? styles.badgeOn : styles.badgeOff]}>
                  <Text style={styles.badgeText}>{a.unlocked ? "\u2713" : "\uD83D\uDD12"}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>
                    {meta ? tr(meta.title) : a.key}{" "}
                    {a.unlocked ? tr("achievements.unlocked") : tr("achievements.locked")}
                  </Text>
                  {meta ? <Text style={styles.rowDesc}>{tr(meta.desc)}</Text> : null}
                  {a.unlocked && a.unlocked_at ? (
                    <Text style={styles.rowMeta}>
                      {tr("achievements.unlocked")} {"\u2022"} {shortDate(a.unlocked_at)}
                    </Text>
                  ) : null}
                  {prog ? (
                    <View>
                      <Text style={styles.rowMeta}>{prog.text}</Text>
                      <View style={styles.miniTrack}>
                        <View style={[styles.miniFill, { width: `${prog.pct}%` }]} />
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  levelCard: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 8 },
  level: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  sub: { fontSize: 16, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  badgeOn: { backgroundColor: GREEN },
  badgeOff: { backgroundColor: "#e5e7eb" },
  badgeText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  rowBody: { flex: 1 },
  progressTrack: { height: 10, backgroundColor: "#e5e7eb", borderRadius: 5, marginVertical: 4, overflow: "hidden" },
  progressFill: { height: 10, backgroundColor: GREEN, borderRadius: 5 },
  miniTrack: { height: 6, backgroundColor: "#e5e7eb", borderRadius: 3, marginTop: 4, overflow: "hidden" },
  miniFill: { height: 6, backgroundColor: GREEN, borderRadius: 3 },
  rowTitle: { fontSize: 17, fontWeight: "bold" },
  rowDesc: { fontSize: 15, color: "#555", marginTop: 2 },
  rowMeta: { fontSize: 13, color: "#555", marginTop: 4 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnOutline: { borderWidth: 1, borderColor: GREEN },
  btnOutlineText: { color: GREEN, fontSize: 16, fontWeight: "bold" },
});
