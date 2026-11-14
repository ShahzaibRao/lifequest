import React, { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { getPendingCount } from "../walk/walkStore";
import { drainExerciseOutbox, getPendingExerciseCount, getPendingHealthCount, syncPendingHealthLogs } from "../health/healthStore";
import { syncPendingSessions } from "../sync/sync";
import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import * as Location from "expo-location";
import { downloadHomePack, getHomePack } from "../map/offlineMap";

// Network/connectivity error? Raw Java/network errors kabhi UI par nahi dikhane.
function isOfflineError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("connectexception") ||
    m.includes("failed to connect") ||
    m.includes("network request failed") ||
    m.includes("network error") ||
    m.includes("econnrefused") ||
    m.includes("timeout")
  );
}

type Profile = {
  user_id: string;
  display_name: string;
  city: string | null;
  bio: string | null;
  avatar_key: string | null;
  level: number;
  total_xp: number;
  territories_count: number;
  weekly_xp: number;
  weekly_rank: number;
  achievements_count: number;
};

export default function HomeScreen({ navigation }: any) {
  const { t } = useLanguage();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncLines, setSyncLines] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const syncingRef = useRef(false);
  const [offlinePrompt, setOfflinePrompt] = useState<"hidden" | "show" | "downloading">("hidden");
  const [offlineProgress, setOfflineProgress] = useState(0);
  const [offlineError, setOfflineError] = useState<string | null>(null);

  // Walk + health + exercise ka combined pending count.
  const refreshPending = useCallback(async () => {
    const [walk, health, ex] = await Promise.all([
      getPendingCount(),
      getPendingHealthCount(),
      getPendingExerciseCount(),
    ]);
    const total = walk + health + ex;
    setPending(total);
    return total;
  }, []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const report = await syncPendingSessions();
      // Health + exercise bhi sync karo (offline-first).
      const healthReport = await syncPendingHealthLogs();
      const exReport = await drainExerciseOutbox();
      const lines: string[] = [];
      for (const s of report.synced) {
        lines.push(
          t("home.synced", {
            id: s.session_uuid.slice(0, 8),
            status: String(s.server_status),
          }) +
            (s.xp_total !== null ? `, XP ${s.xp_total}` : "") +
            (s.total_valid_m !== null ? `, ${s.total_valid_m} m` : "") +
            `, ${t("home.points", { points: s.points_uploaded })}`,
        );
      }
      let offlineFailed = false;
      for (const f of report.failed) {
        const errMsg = String(f.error);
        if (isOfflineError(errMsg)) {
          // Connectivity issue: ek friendly offline line kaafi hai.
          offlineFailed = true;
        } else {
          lines.push(t("home.failed", { id: f.session_uuid.slice(0, 8), error: errMsg }));
        }
      }
      if (report.offline || offlineFailed) lines.push(t("home.offline"));
      if (healthReport.synced > 0 || exReport.synced > 0) {
        lines.push(t("home.healthSynced", { count: healthReport.synced + exReport.synced }));
      }
      if (lines.length > 0) setSyncLines(lines);
      setPending(await refreshPending());
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshPending]);

  const checkOfflinePrompt = useCallback(async () => {
    try {
      const pack = await getHomePack();
      if (!pack) setOfflinePrompt("show");
    } catch {
      // prompt stays hidden on failure; Home still works
    }
  }, []);

  const onDownloadOffline = useCallback(async () => {
    setOfflineError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setOfflineError(t("offline.needPermission"));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setOfflinePrompt("downloading");
      setOfflineProgress(0);
      await downloadHomePack(
        pos.coords.longitude,
        pos.coords.latitude,
        (pct, st) => {
          setOfflineProgress(pct);
          if (st === "complete") setOfflinePrompt("hidden");
        },
        (msg) => {
          setOfflineError(msg);
          setOfflinePrompt("show");
        },
      );
    } catch (e) {
      setOfflineError(e instanceof Error ? e.message : t("offline.downloadFailed"));
      setOfflinePrompt("show");
    }
  }, [t]);

  const onSkipOffline = useCallback(() => {
    setOfflinePrompt("hidden");
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const count = await refreshPending();
        if (count > 0) await runSync();
        try {
          const me = await apiJson<{ id?: string; user_id?: string }>("/auth/me");
          const id = me.user_id ?? me.id;
          setProfile(await apiJson<Profile>(`/users/${id}/profile`));
        } catch {
          // dashboard cards stay hidden on failure; Home still works
        }
        await checkOfflinePrompt();
      })();
    }, [runSync, checkOfflinePrompt]),
  );



  const syncDisabled = syncing || pending === 0;
  const lastSyncLine = syncLines.length > 0 ? syncLines[syncLines.length - 1] : null;

  return (
    <ScrollView style={styles.box} contentContainerStyle={styles.content}>
      {profile ? (
        <View style={styles.levelCard}>
          <Text style={styles.levelTitle}>
            {t("achievements.level", { level: profile.level })} — {t("achievements.totalXp", { xp: profile.total_xp })}
          </Text>
          <Text style={styles.sub}>
            {t("achievements.progress", { progress: profile.total_xp % 100, next: profile.level + 1 })}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${profile.total_xp % 100}%` }]} />
          </View>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statText}>{t("profile.territories", { count: profile.territories_count })}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statText}>{t("profile.weeklyXp", { xp: profile.weekly_xp })}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statText}>{t("profile.weeklyRank", { rank: profile.weekly_rank })}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statText}>{t("profile.achievements", { count: profile.achievements_count })}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {offlinePrompt !== "hidden" && (
        <View style={styles.offlineCard}>
          <Text style={styles.offlineTitle}>{t("offline.title")}</Text>
          <Text style={styles.sub}>{t("offline.downloadPrompt")}</Text>
          {offlinePrompt === "downloading" ? (
            <Text style={styles.sub}>
              {t("offline.downloading", { pct: Math.floor(offlineProgress) })}
            </Text>
          ) : (
            <View style={styles.offlineBtns}>
              <Pressable style={[styles.offlineBtn, styles.offlineBtnGreen]} onPress={onDownloadOffline}>
                <Text style={styles.offlineBtnGreenText}>{t("offline.download")}</Text>
              </Pressable>
              <Pressable style={[styles.offlineBtn, styles.offlineBtnGhost]} onPress={onSkipOffline}>
                <Text style={styles.offlineBtnGhostText}>{t("offline.skip")}</Text>
              </Pressable>
            </View>
          )}
          {offlineError ? <Text style={styles.offlineError}>{offlineError}</Text> : null}
        </View>
      )}

      <Pressable style={styles.cta} onPress={() => navigation.navigate("Walk")}>
        <Text style={styles.ctaText}>{t("home.startWalk")}</Text>
      </Pressable>

      <View style={styles.tiles}>
        <Pressable style={styles.tile} onPress={() => navigation.navigate("Insights")}>
          <Ionicons name="stats-chart" size={28} color="#22c55e" />
          <Text style={styles.tileLabel}>{t("nav.insights")}</Text>
        </Pressable>
        <Pressable style={styles.tile} onPress={() => navigation.navigate("Health")}>
          <Ionicons name="heart" size={28} color="#22c55e" />
          <Text style={styles.tileLabel}>{t("nav.health")}</Text>
        </Pressable>
        <Pressable style={styles.tile} onPress={() => navigation.navigate("Achievements")}>
          <Ionicons name="trophy" size={28} color="#22c55e" />
          <Text style={styles.tileLabel}>{t("achievements.title")}</Text>
        </Pressable>
        <Pressable style={styles.tile} onPress={() => navigation.navigate("Friends")}>
          <Ionicons name="people" size={28} color="#22c55e" />
          <Text style={styles.tileLabel}>{t("nav.friends")}</Text>
        </Pressable>
      </View>

      <Text style={styles.note}>
        {pending > 0
          ? t("home.pendingSome", { count: pending })
          : t("home.pendingNone")}
      </Text>
      <Pressable
        style={[styles.syncBtn, syncDisabled ? styles.syncBtnDisabled : null]}
        onPress={runSync}
        disabled={syncDisabled}
      >
        <Text style={[styles.syncBtnText, syncDisabled ? styles.syncBtnTextDisabled : null]}>
          {syncing ? t("home.syncing") : t("home.syncNow")}
        </Text>
      </Pressable>
      {lastSyncLine ? <Text style={styles.line}>{lastSyncLine}</Text> : null}
      <Text style={styles.note}>{t("home.autoSync")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1 },
  content: { padding: 24, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerText: { flex: 1 },
  bell: { position: "relative", padding: 4 },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "#ef4444",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#ffffff", fontSize: 11, fontWeight: "bold" },
  title: { fontSize: 20, fontWeight: "bold" },
  sub: { textAlign: "center", color: "#555" },
  levelCard: { backgroundColor: "#f0fdf4", borderRadius: 12, padding: 16, gap: 6 },
  offlineCard: { backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#93c5fd", borderRadius: 12, padding: 16, gap: 8 },
  offlineTitle: { fontSize: 17, fontWeight: "bold", textAlign: "center" },
  offlineBtns: { flexDirection: "column", gap: 10, marginTop: 4 },
  offlineBtn: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  offlineBtnGreen: { backgroundColor: "#22c55e" },
  offlineBtnGreenText: { color: "#ffffff", fontSize: 15, fontWeight: "bold" },
  offlineBtnGhost: { borderWidth: 1, borderColor: "#22c55e", backgroundColor: "#ffffff" },
  offlineBtnGhostText: { color: "#22c55e", fontSize: 15, fontWeight: "bold" },
  offlineError: { textAlign: "center", color: "#ef4444", fontSize: 13 },
  levelTitle: { fontSize: 18, fontWeight: "bold", textAlign: "center" },
  progressTrack: { height: 10, backgroundColor: "#ddd", borderRadius: 5, marginVertical: 4 },
  progressFill: { height: 10, backgroundColor: "#22c55e", borderRadius: 5 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  stat: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dddddd",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  statText: { fontSize: 14, textAlign: "center", color: "#333" },
  cta: { backgroundColor: "#22c55e", borderRadius: 12, padding: 16, alignItems: "center", marginVertical: 4 },
  ctaText: { color: "#ffffff", fontSize: 18, fontWeight: "bold" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dddddd",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
  },
  tileLabel: { fontSize: 16, fontWeight: "600" },
  note: { textAlign: "center", color: "#555", marginVertical: 4 },
  line: { textAlign: "center", color: "#333", fontSize: 13 },
  syncBtn: {
    borderWidth: 1,
    borderColor: "#22c55e",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  syncBtnDisabled: { borderColor: "#cccccc", backgroundColor: "#eeeeee" },
  syncBtnText: { color: "#22c55e", fontSize: 15, fontWeight: "bold" },
  syncBtnTextDisabled: { color: "#999999" },
});
