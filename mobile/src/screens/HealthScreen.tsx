import React, { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { apiJson } from "../api/client";
import {
  getLocalSummary,
  getTargetsLocal,
  saveHealthLogLocal,
  saveTargetsLocal,
  syncPendingHealthLogs,
  syncTargets,
} from "../health/healthStore";
import { useLanguage } from "../i18n/LanguageContext";
import ExerciseStopwatch from "../components/ExerciseStopwatch";
import { DEFAULT_DAILY_STEPS_TARGET } from "../steps/phoneSteps";

type Summary = {
  logged_date: string;
  logs_count: number;
  meals_count: number;
  total_calories: number | null;
  water_ml: number;
  sleep_minutes: number;
  exercise_minutes: number;
};

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

const MEAL_KEYS = {
  breakfast: "health.meal_breakfast",
  lunch: "health.meal_lunch",
  dinner: "health.meal_dinner",
  snack: "health.meal_snack",
} as const;

const GREEN = "#22c55e";
const WATER_GOAL_ML = 2000;
const WEEKLY_DISTANCE_TARGET_KM = 7;
const SLEEP_CHIPS = [4, 5, 6, 7, 8, 9, 10];

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultMeal(): string {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 22) return "dinner";
  return "snack";
}

/** Rough display-only estimate for a food name (not stored, not medical). */
function estimateKcal(name: string): number | null {
  const n = name.toLowerCase();
  const table: [string, number][] = [
    ["daal chawal", 350],
    ["biryani", 500],
    ["burger", 500],
    ["pizza", 400],
    ["paratha", 250],
    ["chawal", 250],
    ["gosht", 350],
    ["chicken", 300],
    ["sandwich", 300],
    ["halwa", 300],
    ["daal", 200],
    ["sabzi", 150],
    ["lassi", 150],
    ["samosa", 150],
    ["fries", 350],
    ["kheer", 250],
    ["juice", 120],
    ["roti", 100],
    ["dahi", 100],
    ["fruit", 100],
    ["banana", 100],
    ["anda", 80],
    ["salad", 50],
    ["chai", 50],
  ];
  for (const [key, kcal] of table) {
    if (n.includes(key)) return kcal;
  }
  return null;
}

function formatSleep(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} m`;
}

export default function HealthScreen() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mealType, setMealType] = useState<string>(defaultMeal());
  const [foodName, setFoodName] = useState("");
  const [sleepHours, setSleepHours] = useState(8);
  const [targets, setTargets] = useState({ dailySteps: DEFAULT_DAILY_STEPS_TARGET, weeklyKm: WEEKLY_DISTANCE_TARGET_KM });
  const [editSteps, setEditSteps] = useState(String(DEFAULT_DAILY_STEPS_TARGET));
  const [editKm, setEditKm] = useState(String(WEEKLY_DISTANCE_TARGET_KM));
  const [savingTargets, setSavingTargets] = useState(false);

  const load = useCallback(async () => {
    setError("");
    // Sync any logs saved while offline (best-effort).
    await syncPendingHealthLogs();
    await syncTargets();
    try {
      const today = todayStr();
      const sums = await apiJson<Summary[]>(
        `/health-logs/summary?from=${today}&to=${today}`,
      );
      setSummary(sums[0] ?? null);
    } catch {
      // Offline: show the summary computed from local logs.
      const local = await getLocalSummary(todayStr());
      if (local) {
        setSummary(local);
      } else {
        setError(t("health.loadFailed"));
      }
    }
    // Targets: local first, refreshed from the server when online.
    const localTg = await getTargetsLocal();
    setTargets(localTg);
    setEditSteps(String(localTg.dailySteps));
    setEditKm(String(localTg.weeklyKm));
    try {
      const tg = await apiJson<{ daily_steps_target: number; weekly_distance_km_target: number }>("/users/me/targets");
      setTargets({ dailySteps: tg.daily_steps_target, weeklyKm: tg.weekly_distance_km_target });
      setEditSteps(String(tg.daily_steps_target));
      setEditKm(String(tg.weekly_distance_km_target));
    } catch {
      // keep local values
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const addLog = async (kind: string, payload: Record<string, any>) => {
    setError("");
    setBusy(true);
    try {
      // Phone pehle: save locally (works offline), then sync to server.
      await saveHealthLogLocal(kind, payload, todayStr());
      await syncPendingHealthLogs();
      await load();
    } catch {
      setError(t("health.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveMeal = () => {
    if (!foodName.trim()) return;
    addLog("meal", { meal_type: mealType, name: foodName.trim() });
    setFoodName("");
  };

  const saveSleep = () => {
    const min = Math.round(sleepHours * 60);
    if (min <= 0) return;
    addLog("sleep", { minutes: min });
  };

  const saveTargets = async () => {
    const ds = parseInt(editSteps, 10);
    const km = parseFloat(editKm);
    if (!ds || ds <= 0 || !km || km <= 0) return;
    setSavingTargets(true);
    try {
      // Phone pehle: save locally (works offline), sync when online.
      await saveTargetsLocal({ dailySteps: ds, weeklyKm: km });
      setTargets({ dailySteps: ds, weeklyKm: km });
    } catch {
      // keep old values
    } finally {
      setSavingTargets(false);
    }
  };

  const waterMl = summary?.water_ml ?? 0;
  const waterPct = Math.min(waterMl / WATER_GOAL_ML, 1) * 100;

  return (
    <ScrollView
      style={styles.box}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>{t("health.title")}</Text>
      {summary ? (
        <Text style={styles.sub}>
          {t("health.summary", {
            logs: summary.logs_count,
            meals: summary.meals_count,
            kcal: summary.total_calories ?? 0,
            water: summary.water_ml,
            sleep: formatSleep(summary.sleep_minutes),
            exercise: summary.exercise_minutes,
          })}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.heading}>{t("health.water")}</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${waterPct}%` }]} />
        </View>
        <Text style={styles.goalText}>{`${waterMl} / ${WATER_GOAL_ML} ml`}</Text>
        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.btnPrimary, styles.btnHalf]} onPress={() => addLog("water", { millilitres: 250 })} disabled={busy}>
            <Text style={styles.btnPrimaryText}>+250 ml</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary, styles.btnHalf]} onPress={() => addLog("water", { millilitres: 500 })} disabled={busy}>
            <Text style={styles.btnPrimaryText}>+500 ml</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>{t("health.food")}</Text>
        <View style={styles.row}>
          {MEAL_TYPES.map((m) => (
            <Pressable key={m} onPress={() => setMealType(m)}>
              <Text style={mealType === m ? styles.chipActive : styles.chipInactive}>{t(MEAL_KEYS[m])}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={styles.input}
          placeholder={t("health.foodName")}
          value={foodName}
          onChangeText={setFoodName}
        />
        {foodName.trim() && estimateKcal(foodName.trim()) !== null ? (
          <Text style={styles.estimate}>≈ {estimateKcal(foodName.trim())} kcal</Text>
        ) : null}
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={saveMeal} disabled={busy || !foodName.trim()}>
          <Text style={styles.btnPrimaryText}>{busy ? t("health.saving") : t("health.saveMeal")}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>{t("health.sleep")}</Text>
        <Text style={{ fontSize: 34, fontWeight: "bold", textAlign: "center" }}>
          {sleepHours % 1 === 0 ? `${sleepHours} h` : `${sleepHours.toFixed(1)} h`}
        </Text>
        <View style={[styles.row, { marginTop: 10 }]}>
          {SLEEP_CHIPS.map((h) => (
            <Pressable key={h} onPress={() => setSleepHours(h)}>
              <Text style={sleepHours === h ? styles.chipActive : styles.chipInactive}>{h}h</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.btnOutline, styles.btnHalf]}
            onPress={() => setSleepHours((v) => Math.max(0.5, v - 0.5))}
          >
            <Text style={styles.btnOutlineText}>- 0.5h</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnOutline, styles.btnHalf]}
            onPress={() => setSleepHours((v) => Math.min(16, v + 0.5))}
          >
            <Text style={styles.btnOutlineText}>+ 0.5h</Text>
          </Pressable>
        </View>
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={saveSleep} disabled={busy}>
          <Text style={styles.btnPrimaryText}>{busy ? t("health.saving") : t("health.saveSleep")}</Text>
        </Pressable>
      </View>

      <ExerciseStopwatch />

      <View style={styles.card}>
        <Text style={styles.heading}>{t("health.targets")}</Text>
        <Text style={styles.sub}>{t("health.dailyStepsTarget")}</Text>
        <TextInput
          style={styles.input}
          value={editSteps}
          onChangeText={setEditSteps}
          keyboardType="numeric"
        />
        <Text style={styles.sub}>{t("health.weeklyKmTarget")}</Text>
        <TextInput
          style={styles.input}
          value={editKm}
          onChangeText={setEditKm}
          keyboardType="numeric"
        />
        <Pressable
          style={[styles.btn, styles.btnPrimary, savingTargets && { opacity: 0.5 }]}
          disabled={savingTargets}
          onPress={saveTargets}
        >
          <Text style={styles.btnPrimaryText}>{t("health.save")}</Text>
        </Pressable>
        <Text style={styles.sub}>
          {targets.dailySteps} {t("insights.steps")} · {targets.weeklyKm} km
        </Text>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center" },
  sub: { textAlign: "center", color: "#555" },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14 },
  heading: { fontSize: 18, fontWeight: "bold", marginBottom: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#fff", borderRadius: 8, padding: 12, marginTop: 8 },
  estimate: { textAlign: "center", color: "#555", marginTop: 6 },
  log: { fontSize: 15, paddingVertical: 2 },
  error: { color: "red", textAlign: "center" },
  barTrack: { height: 10, backgroundColor: "#e5e7eb", borderRadius: 5, overflow: "hidden", marginVertical: 6 },
  barFill: { height: 10, backgroundColor: GREEN, borderRadius: 5 },
  goalText: { textAlign: "center", color: "#555", fontSize: 14, marginBottom: 8 },
  chipActive: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#fff",
    backgroundColor: GREEN,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  chipInactive: {
    fontSize: 15,
    color: "#555",
    borderWidth: 1,
    borderColor: "#ccc",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnHalf: { flex: 1, marginTop: 0 },
  btnPrimary: { backgroundColor: GREEN },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  btnOutline: { borderWidth: 1, borderColor: GREEN },
  btnOutlineText: { color: GREEN, fontSize: 16, fontWeight: "bold" },
});
