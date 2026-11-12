import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "../api/client";
import { getCached, lastSyncedLabel, setCached } from "../cache/cache";
import { useLanguage } from "../i18n/LanguageContext";
import Avatar, { AvatarPreset } from "../components/Avatar";

type SearchResult = {
  user_id: string;
  display_name: string;
  email: string | null;
  status: string;
  avatar_key: string | null;
  city: string | null;
};

type ReqItem = {
  request_id: string;
  other_user_id: string;
  other_display_name: string;
  direction: string;
  created_at: string;
  avatar_key: string | null;
  city: string | null;
};

type Pending = {
  sent: ReqItem[];
  received: ReqItem[];
};

type FriendEntry = {
  user_id: string;
  display_name: string;
  weekly_xp: number;
  avatar_key: string | null;
  city: string | null;
  territories_held: number;
};

const GREEN = "#22c55e";

export default function FriendsScreen({ navigation }: any) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [requests, setRequests] = useState<Pending | null>(null);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [error, setError] = useState("");
  const [cacheLabel, setCacheLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"received" | "sent" | "friends">("received");
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<AvatarPreset[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const [req, fr] = await Promise.all([
        apiJson<Pending>("/friends/requests"),
        apiJson<FriendEntry[]>("/friends"),
      ]);
      setRequests(req);
      setFriends(fr);
      await setCached("friends:requests", req);
      await setCached("friends:list", fr);
      setCacheLabel("");
    } catch {
      // Offline: show the cached lists (if any) with a "Cached" label.
      const cachedReq = await getCached<Pending>("friends:requests");
      const cachedFr = await getCached<FriendEntry[]>("friends:list");
      if (cachedReq || cachedFr) {
        if (cachedReq) setRequests(cachedReq.data);
        if (cachedFr) setFriends(cachedFr.data);
        setCacheLabel(lastSyncedLabel((cachedReq ?? cachedFr)!.updatedAt));
        setError("");
      } else {
        setError(t("friends.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    (async () => {
      try {
        setPresets(await apiJson<AvatarPreset[]>("/users/avatar-presets"));
      } catch {
        setPresets([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => setMsg(""), 3000);
    return () => clearTimeout(timer);
  }, [msg]);

  const search = useCallback(async () => {
    setError("");
    setMsg("");
    try {
      setResults(await apiJson<SearchResult[]>(`/friends/search?q=${encodeURIComponent(query.trim())}`));
    } catch (e: any) {
      setError(e.message ?? t("friends.searchFailed"));
    }
  }, [query]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, done: string) => {
      setError("");
      setMsg("");
      try {
        await fn();
        setMsg(done);
        await loadAll();
        if (query.trim().length >= 2) await search();
      } catch (e: any) {
        setError(e.message ?? t("friends.actionFailed"));
      }
    },
    [loadAll, query, search],
  );

  const sendRequest = (userId: string) =>
    act(
      () => apiJson("/friends/requests", { method: "POST", body: JSON.stringify({ addressee_id: userId }) }),
      t("friends.requestSent"),
    );
  const accept = (id: string) => act(() => apiJson(`/friends/requests/${id}/accept`, { method: "POST" }), t("friends.friendsNow"));
  const reject = (id: string) => act(() => apiJson(`/friends/requests/${id}/reject`, { method: "POST" }), t("friends.requestRejected"));
  const cancel = (id: string) => act(() => apiJson(`/friends/requests/${id}/cancel`, { method: "POST" }), t("friends.requestCancelled"));
  const unfriend = (id: string) => act(() => apiJson(`/friends/${id}`, { method: "DELETE" }), t("friends.unfriended"));

  return (
    <ScrollView
      style={styles.box}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cacheLabel ? <Text style={{ color: "#888", textAlign: "center" }}>Cached · {cacheLabel}</Text> : null}
      {msg ? <Text style={styles.sub}>{msg}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.head}>{t("friends.findFriends")}</Text>
        <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={t("friends.searchPlaceholder")} autoCapitalize="none" />
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={search}>
          <Text style={styles.btnPrimaryText}>{t("friends.search")}</Text>
        </Pressable>
        {results.map((r) => (
          <View key={r.user_id} style={styles.row}>
            <Avatar avatarKey={r.avatar_key} presets={presets} displayName={r.display_name} size={36} />
            <Pressable style={styles.nameCol} onPress={() => navigation.navigate("Profile", { userId: r.user_id, status: r.status })}>
              <Text style={styles.name}>{r.display_name}</Text>
              {r.city ? <Text style={styles.city}>{r.city}</Text> : null}
            </Pressable>
            {r.status === "none" ? (
              <Pressable style={[styles.btn, styles.btnPrimary, styles.btnSmall]} onPress={() => sendRequest(r.user_id)}>
                <Text style={styles.btnPrimaryText}>{t("friends.add")}</Text>
              </Pressable>
            ) : r.status === "friends" ? (
              <Text>{t("friends.alreadyFriends")}</Text>
            ) : r.status === "pending_sent" ? (
              <Text>{t("friends.requestSentStatus")}</Text>
            ) : (
              <Text>{t("friends.requestReceivedStatus")}</Text>
            )}
          </View>
        ))}
      </View>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === "received" && styles.tabActive]} onPress={() => setTab("received")}>
          <Text style={[styles.tabText, tab === "received" && styles.tabTextActive]}>{t("friends.tabReceived")} ({(requests?.received ?? []).length})</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === "sent" && styles.tabActive]} onPress={() => setTab("sent")}>
          <Text style={[styles.tabText, tab === "sent" && styles.tabTextActive]}>{t("friends.tabSent")} ({(requests?.sent ?? []).length})</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === "friends" && styles.tabActive]} onPress={() => setTab("friends")}>
          <Text style={[styles.tabText, tab === "friends" && styles.tabTextActive]}>{t("friends.tabFriends")} ({friends.length})</Text>
        </Pressable>
      </View>
      {tab === "received" ? (
      <>
      {(requests?.received ?? []).length === 0 ? <Text style={styles.sub}>{t("friends.none")}</Text> : null}
      {(requests?.received ?? []).map((r) => (
        <View key={r.request_id} style={styles.cardRow}>
          <Avatar avatarKey={r.avatar_key} presets={presets} displayName={r.other_display_name} size={36} />
          <Pressable style={styles.nameCol} onPress={() => navigation.navigate("Profile", { userId: r.other_user_id, status: "pending_received" })}>
            <Text style={styles.name}>{r.other_display_name}</Text>
            {r.city ? <Text style={styles.city}>{r.city}</Text> : null}
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary, styles.btnSmall]} onPress={() => accept(r.request_id)}>
            <Text style={styles.btnPrimaryText}>{t("challenges.accept")}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGrey, styles.btnSmall]} onPress={() => reject(r.request_id)}>
            <Text style={styles.btnGreyText}>{t("challenges.decline")}</Text>
          </Pressable>
        </View>
      ))}
      </>
      ) : null}
      {tab === "sent" ? (
      <>
      {(requests?.sent ?? []).length === 0 ? <Text style={styles.sub}>{t("friends.none")}</Text> : null}
      {(requests?.sent ?? []).map((r) => (
        <View key={r.request_id} style={styles.cardRow}>
          <Avatar avatarKey={r.avatar_key} presets={presets} displayName={r.other_display_name} size={36} />
          <Pressable style={styles.nameCol} onPress={() => navigation.navigate("Profile", { userId: r.other_user_id, status: "pending_sent" })}>
            <Text style={styles.name}>{r.other_display_name}</Text>
            {r.city ? <Text style={styles.city}>{r.city}</Text> : null}
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGrey, styles.btnSmall]} onPress={() => cancel(r.request_id)}>
            <Text style={styles.btnGreyText}>Cancel</Text>
          </Pressable>
        </View>
      ))}

      </>
      ) : null}
      {tab === "friends" ? (
      <>
      {friends.length === 0 ? <Text style={styles.sub}>{t("friends.noFriendsYet")}</Text> : null}
      {friends.map((f) => (
        <View key={f.user_id} style={styles.cardRow}>
          <Avatar avatarKey={f.avatar_key} presets={presets} displayName={f.display_name} size={40} />
          <Pressable style={styles.nameCol} onPress={() => navigation.navigate("Profile", { userId: f.user_id, status: "friends" })}>
            <Text style={styles.name}>{f.display_name}</Text>
            <Text style={styles.city}>{[f.city, `${f.weekly_xp} XP`, t("profile.territories", { count: f.territories_held })].filter(Boolean).join(" • ")}</Text>
          </Pressable>
          <View style={styles.btnRow}>
            <Pressable style={[styles.btn, styles.btnPrimary, styles.btnSmall]} onPress={() => navigation.navigate("Challenges", { opponentId: f.user_id, opponentName: f.display_name })}>
              <Text style={styles.btnPrimaryText}>{t("friends.challenge")}</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnGrey, styles.btnSmall]} onPress={() => unfriend(f.user_id)}>
              <Text style={styles.btnGreyText}>{t("friends.unfriend")}</Text>
            </Pressable>
          </View>
        </View>
      ))}
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
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 8 },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14, marginBottom: 12 },
  name: { fontSize: 16, fontWeight: "600" },
  nameCol: { flex: 1 },
  city: { fontSize: 13, color: "#555" },
  input: { borderWidth: 1, borderColor: "#999", backgroundColor: "#fff", padding: 10, borderRadius: 8, marginBottom: 8 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, marginTop: 0 },
  btnPrimary: { backgroundColor: GREEN },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  btnOutline: { borderWidth: 1, borderColor: GREEN },
  btnOutlineText: { color: GREEN, fontSize: 16, fontWeight: "bold" },
  btnGrey: { backgroundColor: "#e5e7eb" },
  btnGreyText: { color: "#333", fontSize: 16, fontWeight: "bold" },
  error: { color: "red", textAlign: "center" },
  tabs: { flexDirection: "row", backgroundColor: "#e5e7eb", borderRadius: 10, padding: 4, marginBottom: 12, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: GREEN },
  tabText: { fontSize: 13, fontWeight: "600", color: "#333", textAlign: "center" },
  tabTextActive: { color: "#fff" },
});
