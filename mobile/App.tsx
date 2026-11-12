import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { NavigationContainer, useFocusEffect, useNavigation } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider, useAuth } from "./src/auth/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import RegisterScreen from "./src/screens/RegisterScreen";
import HomeScreen from "./src/screens/HomeScreen";
import WalkScreen from "./src/screens/WalkScreen";
import MapScreen from "./src/screens/MapScreen";
import LeaderboardScreen from "./src/screens/LeaderboardScreen";
import InsightsScreen from "./src/screens/InsightsScreen";
import HealthScreen from "./src/screens/HealthScreen";
import FriendsScreen from "./src/screens/FriendsScreen";
import ChallengesScreen from "./src/screens/ChallengesScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import AchievementsScreen from "./src/screens/AchievementsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";
import { LanguageProvider, useLanguage } from "./src/i18n/LanguageContext";
import { useAppUpdate } from "./src/updates/useAppUpdate";
import { fetchNotifSummary } from "./src/notifications/summary";
import { apiJson } from "./src/api/client";
import Avatar, { AvatarPreset } from "./src/components/Avatar";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HeaderBell({ navigation }: any) {
  const [count, setCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      fetchNotifSummary()
        .then((s) => setCount(s.total))
        .catch(() => {});
    }, []),
  );
  return (
    <Pressable onPress={() => navigation.navigate("Notifications")} style={{ paddingHorizontal: 12, position: "relative" }}>
      <Ionicons name="notifications-outline" size={24} color="#333333" />
      {count > 0 ? (
        <View style={styles.bellBadge}>
          <Text style={styles.bellBadgeText}>{count > 9 ? "9+" : String(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function HomeHeaderTitle() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const [profile, setProfile] = useState<{ display_name: string; city: string | null; avatar_key: string | null } | null>(null);
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const load = useCallback(async () => {
    try {
      const me = await apiJson<{ id?: string; user_id?: string }>("/auth/me");
      const id = me.user_id ?? me.id;
      if (!id) return;
      const [p, pr] = await Promise.all([
        apiJson<{ display_name: string; city: string | null; avatar_key: string | null }>(`/users/${id}/profile`),
        apiJson<AvatarPreset[]>("/users/avatar-presets"),
      ]);
      setProfile(p);
      setPresets(pr);
    } catch {
      // header falls back to account name + initials avatar
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  const name = profile?.display_name ?? user?.display_name ?? "";
  const city = profile?.city ?? user?.email ?? "";
  return (
    <Pressable onPress={() => (navigation as any).navigate("Profile")} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Avatar avatarKey={profile?.avatar_key ?? null} presets={presets} displayName={name} size={36} />
      <View>
        <Text style={{ fontSize: 16, fontWeight: "bold", color: "#000000" }}>{name}</Text>
        {city ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Ionicons name="location-outline" size={12} color="#555555" />
            <Text style={{ fontSize: 12, color: "#555555" }}>{city}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function WalkTabButton(props: any) {
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      accessibilityState={props.accessibilityState}
      accessibilityLabel={props.accessibilityLabel}
      testID={props.testID}
      style={[props.style, { flex: 1, justifyContent: "center", alignItems: "center" }]}
    >
      <View style={styles.walkFab}>
        <Ionicons name="walk" size={30} color="#ffffff" />
      </View>
    </Pressable>
  );
}

function MainTabs() {
  const { t } = useLanguage();
  return (
    <Tab.Navigator
      screenOptions={({ navigation }: any) => ({
        tabBarActiveTintColor: "#22c55e",
        tabBarInactiveTintColor: "#888888",
        headerRight: () => <HeaderBell navigation={navigation} />,
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: t("nav.home"),
          headerTitle: () => <HomeHeaderTitle />,
          tabBarIcon: ({ color, size }: any) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          title: t("nav.map"),
          headerShown: false,
          tabBarIcon: ({ color, size }: any) => <Ionicons name="map" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Walk"
        component={WalkScreen}
        options={{
          title: t("nav.walk"),
          headerShown: false,
          tabBarLabel: "",
          tabBarButton: (props: any) => <WalkTabButton {...props} />,
        }}
      />
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{
          title: t("nav.leaderboard"),
          tabBarIcon: ({ color, size }: any) => <Ionicons name="trophy" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Friends"
        component={FriendsScreen}
        options={{
          title: t("nav.friends"),
          tabBarIcon: ({ color, size }: any) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function Root() {
  const { user, loading } = useAuth();
  useAppUpdate(!!user);
  const { t } = useLanguage();
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return (
    <Stack.Navigator
      screenOptions={({ route, navigation }: any) => ({
        headerRight:
          route.name === "Login" || route.name === "Register" || route.name === "Settings"
            ? undefined
            : () => <HeaderBell navigation={navigation} />,
      })}
    >
      {user ? (
        <>
          <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Challenges" component={ChallengesScreen} options={{ title: t("nav.challenges") }} />
          <Stack.Screen name="Insights" component={InsightsScreen} options={{ title: t("nav.insights") }} />
          <Stack.Screen name="Health" component={HealthScreen} options={{ title: t("nav.health") }} />
          <Stack.Screen name="Achievements" component={AchievementsScreen} options={{ title: t("nav.achievements") }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t("nav.profile") }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t("notif.title") }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: t("nav.login") }} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ title: t("nav.register") }} />
        </>
      )}
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t("nav.settings") }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <NavigationContainer>
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  walkFab: {
    top: -18,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#22c55e",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
  },
  bellBadge: {
    position: "absolute",
    top: 2,
    right: 6,
    backgroundColor: "#dc2626",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  bellBadgeText: { color: "#ffffff", fontSize: 11, fontWeight: "bold" },
});
