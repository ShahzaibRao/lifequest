import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../api/client";
import { getCached, lastSyncedLabel, setCached } from "../cache/cache";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { getPendingCount } from "../walk/walkStore";
import Avatar, { AvatarPreset } from "../components/Avatar";

type PublicProfile = {
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

const GREEN = "#22c55e";

export default function ProfileScreen({ route, navigation }: any) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const paramUserId: string | undefined = route?.params?.userId;
  const paramStatus: string | undefined = route?.params?.status;
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const [own, setOwn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cacheLabel, setCacheLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [friendStatus, setFriendStatus] = useState<string | null>(paramStatus ?? null);
  const [formName, setFormName] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formBio, setFormBio] = useState("");
  const [formAvatar, setFormAvatar] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let id = paramUserId;
      let isOwn = false;
      if (!id) {
        const me = await apiJson<{ id?: string; user_id?: string }>("/auth/me");
        id = me.user_id ?? me.id;
        isOwn = true;
      }
      const p = await apiJson<PublicProfile>(`/users/${id}/profile`);
      setProfile(p);
      await setCached(paramUserId ? `profile:${paramUserId}` : "profile:me", p);
      setCacheLabel("");
      setOwn(isOwn);
      setFriendStatus(isOwn ? null : paramStatus ?? null);
    } catch {
      // Offline: show the cached profile (if any) with a "Cached" label.
      const key = paramUserId ? `profile:${paramUserId}` : "profile:me";
      const cached = await getCached<PublicProfile>(key);
      if (cached) {
        setProfile(cached.data);
        setCacheLabel(lastSyncedLabel(cached.updatedAt));
        setError("");
      } else {
        setError(t("profile.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, [paramUserId, paramStatus]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        setPresets(await apiJson<AvatarPreset[]>("/users/avatar-presets"));
      } catch {
        setPresets([]);
      }
    })();
  }, []);

  const startEdit = () => {
    if (!profile) return;
    setFormName(profile.display_name);
    setFormCity(profile.city ?? "");
    setFormBio(profile.bio ?? "");
    setFormAvatar(profile.avatar_key);
    setEditing(true);
  };

  const save = async () => {
    if (!profile) return;
    if (formName.trim().length === 0) {
      setError(t("profile.nameRequired"));
      return;
    }
    setSaving(true);
    setError("");
    setMsg("");
    try {
      await apiJson("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: formName.trim(),
          city: formCity.trim() || null,
          bio: formBio.trim() || null,
          avatar_key: formAvatar,
        }),
      });
      setEditing(false);
      setMsg(t("profile.saved"));
      await load();
    } catch (e: any) {
      setError(e.message ?? t("profile.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const addFriend = async () => {
    if (!profile) return;
    setError("");
    setMsg("");
    try {
      await apiJson("/friends/requests", {
        method: "POST",
        body: JSON.stringify({ addressee_id: profile.user_id }),
      });
      setFriendStatus("pending_sent");
      setMsg(t("friends.requestSent"));
    } catch (e: any) {
      setError(e.message ?? t("friends.actionFailed"));
    }
  };

  const onLogout = async () => {
    const pending = await getPendingCount();
    if (pending > 0) {
      Alert.alert(
        t("home.unsyncedTitle"),
        t("home.unsyncedMessage", { count: pending }),
        [
          { text: t("home.cancel"), style: "cancel" },
          { text: t("home.logoutAnyway"), onPress: () => logout() },
        ],
      );
    } else {
      logout();
    }
  };

  return (
    <ScrollView
      style={styles.box}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {loading ? <Text style={styles.sub}>{t("profile.loading")}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cacheLabel ? <Text style={{ color: "#888", textAlign: "center" }}>Cached · {cacheLabel}</Text> : null}
      {msg ? <Text style={styles.sub}>{msg}</Text> : null}
      {profile ? (
        <View style={styles.card}>
          <View style={styles.avatarWrap}>
            <Avatar avatarKey={profile.avatar_key} presets={presets} displayName={profile.display_name} size={96} />
          </View>
          <Text style={styles.title}>{profile.display_name}</Text>
          <Text style={styles.sub}>{profile.city ?? t("profile.noCity")}</Text>
          <Text style={styles.sub}>{profile.bio ?? t("profile.noBio")}</Text>
          <View style={styles.divider} />
          <Text style={styles.statBig}>
            {t("achievements.level", { level: profile.level })} — {t("achievements.totalXp", { xp: profile.total_xp })}
          </Text>
          <Text style={styles.stat}>{t("profile.territories", { count: profile.territories_count })}</Text>
          <Text style={styles.stat}>{t("profile.weeklyXp", { xp: profile.weekly_xp })}</Text>
          <Text style={styles.stat}>{t("profile.weeklyRank", { rank: profile.weekly_rank })}</Text>
          <Text style={styles.stat}>{t("profile.achievements", { count: profile.achievements_count })}</Text>
        </View>
      ) : null}

      {own && profile && !editing ? (
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={startEdit}>
          <Text style={styles.btnPrimaryText}>{t("profile.edit")}</Text>
        </Pressable>
      ) : null}

      {editing ? (
        <View style={styles.card}>
          <Text style={styles.head}>{t("profile.displayName")}</Text>
          <TextInput style={styles.input} value={formName} onChangeText={setFormName} autoCapitalize="words" maxLength={50} />
          <Text style={styles.head}>{t("profile.city")}</Text>
          <TextInput style={styles.input} value={formCity} onChangeText={setFormCity} autoCapitalize="words" maxLength={50} />
          <Text style={styles.head}>{t("profile.bio")}</Text>
          <TextInput style={styles.input} value={formBio} onChangeText={setFormBio} multiline maxLength={280} />
          <Text style={styles.head}>{t("profile.pickAvatar")}</Text>
          <View style={styles.picker}>
            {presets.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => setFormAvatar(p.key)}
                style={[styles.pick, formAvatar === p.key ? styles.picked : null]}
              >
                <Avatar avatarKey={p.key} presets={presets} displayName="" size={48} />
              </Pressable>
            ))}
          </View>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={save} disabled={saving}>
            <Text style={styles.btnPrimaryText}>{saving ? t("profile.loading") : t("profile.save")}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGrey]} onPress={() => setEditing(false)}>
            <Text style={styles.btnGreyText}>{t("home.cancel")}</Text>
          </Pressable>
        </View>
      ) : null}

      {!own && profile && friendStatus === "none" ? (
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={addFriend}>
          <Text style={styles.btnPrimaryText}>{t("friends.add")}</Text>
        </Pressable>
      ) : null}
      {!own && profile && friendStatus === "friends" ? <Text style={styles.sub}>{t("friends.alreadyFriends")}</Text> : null}
      {!own && profile && friendStatus === "pending_sent" ? <Text style={styles.sub}>{t("friends.requestSentStatus")}</Text> : null}
      {!own && profile && friendStatus === "pending_received" ? <Text style={styles.sub}>{t("friends.requestReceivedStatus")}</Text> : null}

      {own && profile ? (
        <View style={styles.card}>
          <Text style={styles.settingsHead}>{t("nav.settings")}</Text>
          <Pressable style={styles.settingRow} onPress={() => navigation.navigate("Settings")}>
            <View style={styles.settingLeft}>
              <Ionicons name="globe-outline" size={20} color="#333" />
              <Text style={styles.settingLabel}>{t("settings.language")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#888" />
          </Pressable>
          <Pressable style={styles.settingRow} onPress={() => navigation.navigate("Notifications")}>
            <View style={styles.settingLeft}>
              <Ionicons name="notifications-outline" size={20} color="#333" />
              <Text style={styles.settingLabel}>Notifications</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#888" />
          </Pressable>
          <Pressable style={styles.settingRow} onPress={() => navigation.navigate("Settings")}>
            <View style={styles.settingLeft}>
              <Ionicons name="download-outline" size={20} color="#333" />
              <Text style={styles.settingLabel}>Offline map</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#888" />
          </Pressable>
          <View style={[styles.settingRow, styles.settingRowLast]}>
            <View style={styles.settingLeft}>
              <Ionicons name="information-circle-outline" size={20} color="#333" />
              <View>
                <Text style={styles.settingLabel}>About</Text>
                <Text style={styles.settingSub}>Walk More. Capture More. Live Better.</Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {own && profile ? (
        <Pressable style={[styles.btn, styles.btnLogout]} onPress={onLogout}>
          <Text style={styles.btnLogoutText}>{t("home.logout")}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 16, marginBottom: 12 },
  avatarWrap: { alignItems: "center", marginBottom: 8 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", marginBottom: 4 },
  sub: { textAlign: "center", color: "#555", marginVertical: 4 },
  divider: { height: 1, backgroundColor: "#e5e7eb", marginVertical: 12 },
  statBig: { textAlign: "center", color: "#1a1a1a", fontSize: 17, fontWeight: "bold", marginVertical: 4 },
  stat: { textAlign: "center", color: "#333", fontSize: 15, marginVertical: 2 },
  head: { fontSize: 16, fontWeight: "bold", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#fff", padding: 10, borderRadius: 8, marginBottom: 8 },
  error: { color: "red", textAlign: "center" },
  picker: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pick: { padding: 4, borderWidth: 2, borderColor: "transparent", borderRadius: 30 },
  picked: { borderColor: GREEN },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnPrimary: { backgroundColor: GREEN },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  btnOutline: { borderWidth: 1, borderColor: GREEN },
  btnOutlineText: { color: GREEN, fontSize: 16, fontWeight: "bold" },
  btnGrey: { backgroundColor: "#e5e7eb" },
  btnGreyText: { color: "#333", fontSize: 16, fontWeight: "bold" },
  btnLogout: { backgroundColor: "#dc2626", marginBottom: 16 },
  btnLogoutText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  settingsHead: { fontSize: 17, fontWeight: "bold", marginBottom: 4 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  settingRowLast: { borderBottomWidth: 0 },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingLabel: { fontSize: 16, color: "#1a1a1a" },
  settingSub: { fontSize: 13, color: "#777", marginTop: 2 },
});
