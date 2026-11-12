import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "../api/client";
import Avatar, { AvatarPreset } from "../components/Avatar";
import { useLanguage } from "../i18n/LanguageContext";
import { dismissNotif, fetchNotifSummary, type NotifSummary } from "../notifications/summary";

const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const ORANGE = "#ea580c";

export default function NotificationsScreen({ navigation }: any) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<NotifSummary | null>(null);
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSummary(await fetchNotifSummary());
    } catch (e: any) {
      setError(e.message ?? t("notif.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiJson<AvatarPreset[]>("/users/avatar-presets").then(setPresets).catch(() => {});
  }, []);

  const answerRequest = async (id: string, kind: "accept" | "reject") => {
    setError("");
    try {
      await apiJson(`/friends/requests/${id}/${kind}`, { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e.message ?? t("notif.loadFailed"));
    }
  };

  const answerChallenge = async (id: string, kind: "accept" | "decline") => {
    setError("");
    try {
      await apiJson(`/challenges/${id}/${kind}`, { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e.message ?? t("notif.loadFailed"));
    }
  };

  const openRequest = async (r: { request_id: string; other_user_id: string }) => {
    await dismissNotif(`req:${r.request_id}`);
    navigation.navigate("Profile", { userId: r.other_user_id, status: "pending_received" });
    await load();
  };

  const openChallenge = async (challenge_id: string) => {
    await dismissNotif(`ch:${challenge_id}`);
    navigation.navigate("Challenges");
    await load();
  };

  const openHex = async (m: { h3_index: string; expires_at: string }) => {
    await dismissNotif(`hex:${m.h3_index}:${m.expires_at}`);
    navigation.navigate("Tabs", { screen: "Map" });
    await load();
  };

  const myId = summary?.myId ?? null;
  const isEmpty = summary !== null && summary.total === 0;
  const hasChallenges =
    summary !== null && (summary.pendingChallenges.length > 0 || summary.activeChallenges.length > 0);

  return (
    <ScrollView
      style={styles.box}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isEmpty ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyCircle}>
            <Text style={styles.emptyCheck}>✓</Text>
          </View>
          <Text style={styles.emptyText}>{t("notif.allCaughtUp")}</Text>
        </View>
      ) : null}

      {summary && summary.receivedRequests.length > 0 ? (
        <>
          <Text style={styles.head}>{t("notif.requests")}</Text>
          {summary.receivedRequests.map((r) => (
            <View key={r.request_id} style={styles.card}>
              <View style={[styles.dot, { backgroundColor: GREEN }]} />
              <Avatar avatarKey={r.avatar_key} presets={presets} displayName={r.other_display_name} size={36} />
              <Pressable style={styles.nameCol} onPress={() => openRequest(r)}>
                <Text style={styles.name}>{t("notif.requestFrom", { name: r.other_display_name })}</Text>
                {r.city ? <Text style={styles.city}>{r.city}</Text> : null}
              </Pressable>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.miniBtn, styles.acceptBtn]}
                  onPress={() => answerRequest(r.request_id, "accept")}
                >
                  <Text style={styles.miniBtnText}>{t("challenges.accept")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.miniBtn, styles.declineBtn]}
                  onPress={() => answerRequest(r.request_id, "reject")}
                >
                  <Text style={styles.miniBtnText}>{t("challenges.decline")}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}

      {hasChallenges && summary ? (
        <>
          <Text style={styles.head}>{t("notif.challenges")}</Text>
          {summary.pendingChallenges.map((ch) => {
            const otherName =
              myId && ch.challenger_id === myId ? ch.opponent_display_name : ch.challenger_display_name;
            return (
              <View key={ch.challenge_id} style={styles.card}>
                <View style={[styles.dot, { backgroundColor: AMBER }]} />
                <Pressable style={styles.nameCol} onPress={() => openChallenge(ch.challenge_id)}>
                  <Text style={styles.name}>
                    {t("notif.challengeFrom", { name: otherName, km: ch.target_m / 1000 })}
                  </Text>
                </Pressable>
                {myId && ch.opponent_id === myId ? (
                  <View style={styles.actions}>
                    <Pressable
                      style={[styles.miniBtn, styles.acceptBtn]}
                      onPress={() => answerChallenge(ch.challenge_id, "accept")}
                    >
                      <Text style={styles.miniBtnText}>{t("challenges.accept")}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.miniBtn, styles.declineBtn]}
                      onPress={() => answerChallenge(ch.challenge_id, "decline")}
                    >
                      <Text style={styles.miniBtnText}>{t("challenges.decline")}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
          {summary.activeChallenges.map((ch) => {
            const meChallenger = myId ? ch.challenger_id === myId : false;
            const myDist = meChallenger ? ch.challenger_distance_m : ch.opponent_distance_m;
            const otherDist = meChallenger ? ch.opponent_distance_m : ch.challenger_distance_m;
            const otherName = meChallenger ? ch.opponent_display_name : ch.challenger_display_name;
            return (
              <Pressable key={ch.challenge_id} style={styles.card} onPress={() => openChallenge(ch.challenge_id)}>
                <View style={[styles.dot, { backgroundColor: AMBER }]} />
                <View style={styles.nameCol}>
                  <Text style={styles.name}>
                    {t("notif.activeVs", {
                      name: otherName,
                      my: Math.round(myDist),
                      other: Math.round(otherDist),
                      km: ch.target_m / 1000,
                    })}
                  </Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            );
          })}
        </>
      ) : null}

      {summary && summary.expiringHexes.length > 0 ? (
        <>
          <Text style={styles.head}>{t("notif.territories")}</Text>
          {summary.expiringHexes.map((m) => (
            <Pressable key={m.h3_index} style={styles.card} onPress={() => openHex(m)}>
              <View style={[styles.dot, { backgroundColor: ORANGE }]} />
              <View style={styles.nameCol}>
                <Text style={styles.name}>
                  {t("notif.expiring", { days: Math.max(0, Math.ceil(m.seconds_remaining / 86400)) })}
                </Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {!isEmpty ? <Text style={styles.hint}>{t("notif.pullToRefresh")}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: "#f6f6f6" },
  content: { padding: 16, gap: 10 },
  head: { fontSize: 16, fontWeight: "bold", color: GREEN, marginTop: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
  },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  nameCol: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", color: "#111" },
  city: { fontSize: 13, color: "#777", marginTop: 2 },
  chev: { fontSize: 22, color: "#9ca3af", fontWeight: "bold" },
  actions: { flexDirection: "row", gap: 6, flexShrink: 0 },
  miniBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  acceptBtn: { backgroundColor: GREEN },
  declineBtn: { backgroundColor: "#e5e7eb" },
  miniBtnText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  emptyWrap: { alignItems: "center", marginTop: 60, gap: 12 },
  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCheck: { color: "#fff", fontSize: 36, fontWeight: "bold" },
  emptyText: { fontSize: 16, color: "#555", textAlign: "center" },
  hint: { textAlign: "center", color: "#9ca3af", fontSize: 13, marginTop: 8 },
  error: { color: "red", textAlign: "center" },
});
