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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import * as Crypto from "expo-crypto";
import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";

type Summary = {
  logged_date: string;
  logs_count: number;
  meals_count: number;
  total_calories: number | null;
  water_ml: number;
  sleep_minutes: number;
  exercise_minutes: number;
};

type LogItem = {
  id: string;
  kind: string;
  logged_date: string;
  payload: Record<string, any>;
  client_uuid: string;
  created_at: string;
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

function formatHours(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} m`;
}

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

function describeLog(log: LogItem, t: (key: any, params?: any) => string): string {
  const p = log.payload ?? {};
  if (log.kind === "meal") {
    const mt = p.meal_type ?? "meal";
    const name =
      mt === "breakfast" || mt === "lunch" || mt === "dinner" || mt === "snack" ? t(MEAL_KEYS[mt as keyof typeof MEAL_KEYS]) : mt;
    return `${name}${p.calories !== undefined && p.calories !== null ? ` — ${p.calories} kcal` : ""}`;
  }
  if (log.kind === "water") return t("health.waterLog", { ml: p.millilitres ?? "?" });
  if (log.kind === "sleep")
    return typeof p.minutes === "number" ? `${t("health.sleep")}: ${formatHours(p.minutes)}` : t("health.sleepLog", { min: "?" });
  if (log.kind === "exercise") return `${p.kind ?? "exercise"} — ${p.minutes ?? "?"} min`;
  return log.kind;
}

export default function HealthScreen() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mealType, setMealType] = useState<string>(defaultMeal());
  const [calories, setCalories] = useState("");
  const [sleepHours, setSleepHours] = useState("8");
  const [exKind, setExKind] = useState("");
  const [exMin, setExMin] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const today = todayStr();
      const sums = await apiJson<Summary[]>(
        `/health-logs/summary?from=${today}&to=${today}`,
      );
      setSummary(sums[0] ?? null);
      setLogs(await apiJson<LogItem[]>(`/health-logs?date=${today}`));
    } catch (e: any) {
      setError(e.message ?? t("health.loadFailed"));
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
      await apiJson("/health-logs", {
        method: "POST",
        body: JSON.stringify({
          kind,
          logged_date: todayStr(),
          payload,
          client_uuid: Crypto.randomUUID(),
        }),
      });
      await load();
    } catch (e: any) {
      setError(e.message ?? t("health.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveMeal = () => {
    const payload: Record<string, any> = { meal_type: mealType };
    const cal = parseInt(calories, 10);
    if (!Number.isNaN(cal) && cal >= 0) payload.calories = cal;
    addLog("meal", payload);
  };

  const stepSleep = (delta: number) => {
    const cur = parseFloat(sleepHours);
    const next = (Number.isNaN(cur) ? 8 : cur) + delta;
    setSleepHours(String(Math.min(24, Math.max(0, Math.round(next * 2) / 2))));
  };

  const saveSleep = () => {
    const hours = parseFloat(sleepHours);
    if (Number.isNaN(hours) || hours <= 0 || hours > 24) {
      setError(t("health.sleepHoursError"));
      return;
    }
    addLog("sleep", { minutes: Math.round(hours * 60) });
  };

  const saveExercise = () => {
    const min = parseInt(exMin, 10);
    if (!exKind.trim()) {
      setError(t("health.exerciseKindError"));
      return;
    }
    if (Number.isNaN(min) || min <= 0) {
      setError(t("health.exerciseMinutesError"));
      return;
    }
    addLog("exercise", { kind: exKind.trim(), minutes: min });
  };

  const waterMl = summary?.water_ml ?? 0;
  const waterPct = Math.min(waterMl / WATER_GOAL_ML, 1) * 100;

  return (
    <ScrollView
      style={styles.box}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {summary ? (
        <Text style={styles.sub}>
          {t("health.summary", {
            logs: summary.logs_count,
            meals: summary.meals_count,
            kcal: summary.total_calories ?? 0,
            water: summary.water_ml,
            sleep: formatHours(summary.sleep_minutes ?? 0),
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
          placeholder={t("health.caloriesPlaceholder")}
          keyboardType="numeric"
          value={calories}
          onChangeText={setCalories}
        />
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={saveMeal} disabled={busy}>
          <Text style={styles.btnPrimaryText}>{busy ? t("health.saving") : t("health.saveMeal")}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>{t("health.sleep")}</Text>
        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.btnOutline, styles.stepBtn]} onPress={() => stepSleep(-0.5)} disabled={busy}>
            <Text style={styles.btnOutlineText}>-</Text>
          </Pressable>
          <TextInput
            style={[styles.input, styles.sleepInput]}
            keyboardType="decimal-pad"
            value={sleepHours}
            onChangeText={setSleepHours}
          />
          <Text style={styles.unitText}>h</Text>
          <Pressable style={[styles.btn, styles.btnPrimary, styles.stepBtn]} onPress={() => stepSleep(0.5)} disabled={busy}>
            <Text style={styles.btnPrimaryText}>+</Text>
          </Pressable>
        </View>
        <View style={[styles.row, { marginTop: 12 }]}>
          {[5, 6, 7, 8, 9, 10].map((h) => (
            <Pressable key={h} onPress={() => setSleepHours(String(h))}>
              <Text style={parseFloat(sleepHours) === h ? styles.chipActive : styles.chipInactive}>{h} h</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={saveSleep} disabled={busy}>
          <Text style={styles.btnPrimaryText}>{busy ? t("health.saving") : t("health.saveSleep")}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>{t("health.exercise")}</Text>
        <TextInput
          style={styles.input}
          placeholder={t("health.kindPlaceholder")}
          value={exKind}
          onChangeText={setExKind}
        />
        <TextInput
          style={styles.input}
          placeholder={t("health.minutesPlaceholder")}
          keyboardType="numeric"
          value={exMin}
          onChangeText={setExMin}
        />
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={saveExercise} disabled={busy}>
          <Text style={styles.btnPrimaryText}>{busy ? t("health.saving") : t("health.saveExercise")}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>{t("health.todayLogs")}</Text>
        {logs.length === 0 ? (
          <Text style={styles.sub}>{t("health.noLogs")}</Text>
        ) : (
          logs.map((log) => (
            <Text key={log.id} style={styles.log}>
              • {describeLog(log, t)}
            </Text>
          ))
        )}
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
  stepBtn: { width: 52, marginTop: 0 },
  sleepInput: { flex: 1, marginTop: 0, textAlign: "center", fontSize: 18 },
  unitText: { fontSize: 18, fontWeight: "bold", alignSelf: "center" },
});
