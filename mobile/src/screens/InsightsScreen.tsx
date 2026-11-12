import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import InsightsCalendar from "../components/InsightsCalendar";
import { getLocalDay, getLocalWeek } from "../steps/localInsights";
import InsightsRecords from "../components/InsightsRecords";
const WEEKLY_DISTANCE_TARGET_KM = 7;

import {
  DEFAULT_DAILY_STEPS_TARGET,
  getTodaySteps,
  EIFFEL_HEIGHT_M,
  kcalToCola,
  kcalToCookies,
  metersToLandmark,
  METERS_PER_STEP,
  MINAR_HEIGHT_M,
  stepsToKcal,
  stepsToKm,
} from "../steps/phoneSteps";

type DailySteps = {
  date: string;
  steps: number | null;
  valid_m: number;
};

type Insights = {
  week_start: string;
  sleep_avg_minutes: number | null;
  sleep_vs_prev_week_minutes: number | null;
  steps_avg_per_day: number | null;
  logging_days: number;
  late_dinner_sleep_note: {
    confidence: string;
    status: string;
    late_dinner_days: number;
    difference_minutes: number | null;
    note: string;
  };
  activity_summary: string;
  confidence: string;
  disclaimer: string;
  daily_steps?: DailySteps[];
};

type Tab = "today" | "weekly" | "calendar" | "records";

const GREEN = "#22c55e";
const SLEEP_TARGET_MIN = 480;

function weekdayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function formatHours(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} m`;
}

function formatSleepDiff(min: number): string {
  const sign = min > 0 ? "+" : min < 0 ? "-" : "";
  return sign + formatHours(Math.abs(min));
}

function todayPkt(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function InsightsScreen() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("today");
  const [data, setData] = useState<Insights | null>(null);
  const [todaySteps, setTodaySteps] = useState<number | null>(null);
  const [lastNightSleep, setLastNightSleep] = useState<number | null>(null);
  const [targets, setTargets] = useState({ dailySteps: DEFAULT_DAILY_STEPS_TARGET, weeklyKm: WEEKLY_DISTANCE_TARGET_KM });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await apiJson<Insights>("/insights/weekly"));
    } catch (e: any) {
      // Offline: build the weekly view from local SQLite (walks only).
      try {
        const week = await getLocalWeek();
        const weekStart = week[0]?.date ?? new Date().toISOString().slice(0, 10);
        const steps = week.map((d) => d.steps ?? 0);
        const avg = steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null;
        setData({
          week_start: weekStart,
          sleep_avg_minutes: null,
          sleep_vs_prev_week_minutes: null,
          steps_avg_per_day: avg,
          logging_days: week.filter((d) => d.sessions > 0).length,
          late_dinner_sleep_note: { confidence: "pattern", status: "insufficient_data", late_dinner_days: 0, difference_minutes: null, note: "" },
          activity_summary: "",
          confidence: "pattern",
          disclaimer: "",
          daily_steps: week.map((d) => ({ date: d.date, steps: d.steps, valid_m: d.valid_m })),
        } as Insights);
        setError("");
      } catch {
        setError(e.message ?? t("insights.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
    // Phone steps are local (OS counter) — never blocks insights.
    let steps = await getTodaySteps();
    if (steps === null) {
      // Vivo: pedometer history is not exposed even with permission —
      // fall back to today's walk steps from local SQLite.
      try {
        const d = await getLocalDay(todayPkt());
        steps = d.steps;
      } catch {
        steps = null;
      }
    }
    setTodaySteps(steps);
    // Last night's sleep (logged today) — from the health summary.
    try {
      const today = todayPkt();
      const sums = await apiJson<{ sleep_minutes: number }[]>(`/health-logs/summary?from=${today}&to=${today}`);
      const mins = sums[0]?.sleep_minutes;
      setLastNightSleep(typeof mins === "number" && mins > 0 ? mins : null);
    } catch {
      setLastNightSleep(null);
    }
    // Targets are a user setting (display only here — edited in Health).
    try {
      const tg = await apiJson<{ daily_steps_target: number; weekly_distance_km_target: number }>("/users/me/targets");
      setTargets({ dailySteps: tg.daily_steps_target, weeklyKm: tg.weekly_distance_km_target });
    } catch {
      // keep defaults
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const daily = data?.daily_steps ?? [];
  const maxSteps = daily.reduce((m, d) => Math.max(m, d.steps ?? 0), 0);
  const weekTotalSteps = daily.reduce((a, d) => a + (d.steps ?? 0), 0);
  const weekTotalKm = daily.reduce((a, d) => a + (d.valid_m ?? 0), 0) / 1000;
  const weekTotalKcal = Math.round(stepsToKcal(weekTotalSteps));
  const sleepForBar = lastNightSleep ?? data?.sleep_avg_minutes ?? null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "today", label: t("insights.today") },
    { key: "weekly", label: t("insights.tabWeekly") },
    { key: "calendar", label: t("insights.calendar") },
    { key: "records", label: t("insights.tabRecords") },
  ];

  return (
    <ScrollView
      style={styles.box}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {data ? <Text style={styles.sub}>{t("insights.week", { week: data.week_start })}</Text> : null}
      <View style={styles.tabBar}>
        {tabs.map((tb) => (
          <Pressable
            key={tb.key}
            style={[styles.tab, tab === tb.key && styles.tabActive]}
            onPress={() => setTab(tb.key)}
          >
            <Text numberOfLines={1} style={[styles.tabText, tab === tb.key && styles.tabTextActive]}>{tb.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {data ? (
        <>
          {tab === "today" && (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("insights.today")}</Text>
                {todaySteps !== null ? (
                  <>
                    <Text style={styles.todaySteps}>{todaySteps}</Text>
                    <Text style={styles.todayLine}>
                      {stepsToKm(todaySteps).toFixed(2)} km · {Math.round(stepsToKcal(todaySteps))} kcal ≈{" "}
                      {kcalToCookies(stepsToKcal(todaySteps)).toFixed(2)} {t("insights.cookies")}
                    </Text>
                    <View style={styles.targetBar}>
                      <View
                        style={[
                          styles.targetFill,
                          { width: `${Math.min((todaySteps / targets.dailySteps) * 100, 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.todayLine}>
                      {todaySteps} / {targets.dailySteps} {t("insights.steps")}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.todayLine}>{t("insights.noStepData")}</Text>
                )}
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("insights.sleep")}</Text>
                <Text style={styles.todaySteps}>
                  {lastNightSleep !== null ? formatHours(lastNightSleep) : t("insights.noData")}
                </Text>
                <Text style={styles.todayLine}>
                  {t("insights.lastNight")} · {t("insights.sleepAvg")}:{" "}
                  {data.sleep_avg_minutes !== null ? formatHours(data.sleep_avg_minutes) : t("insights.noData")}
                </Text>
                {sleepForBar !== null ? (
                  <>
                    <View style={styles.targetBar}>
                      <View
                        style={[
                          styles.targetFill,
                          { width: `${Math.min((sleepForBar / SLEEP_TARGET_MIN) * 100, 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.todayLine}>
                      {t("insights.sleepTarget")} ({Math.round((sleepForBar / SLEEP_TARGET_MIN) * 100)}%)
                    </Text>
                  </>
                ) : null}
              </View>
            </>
          )}
          {tab === "weekly" && (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("insights.weekly")}</Text>
                <Text style={styles.todaySteps}>{weekTotalSteps}</Text>
                <Text style={styles.todayLine}>
                  {weekTotalKm.toFixed(2)} km · {weekTotalKcal} kcal ≈{" "}
                  {kcalToCookies(weekTotalKcal).toFixed(2)} {t("insights.cookies")}
                </Text>
                <View style={styles.targetBar}>
                  <View
                    style={[
                      styles.targetFill,
                      { width: `${Math.min((weekTotalKm / targets.weeklyKm) * 100, 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.todayLine}>
                  {weekTotalKm.toFixed(2)} / {targets.weeklyKm} km · {t("insights.weeklyTarget")}
                </Text>
              </View>
              <View style={styles.grid}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>{t("insights.sleepAvg")}</Text>
                  <Text style={styles.statValue}>
                    {data.sleep_avg_minutes !== null ? formatHours(data.sleep_avg_minutes) : t("insights.noData")}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>{t("insights.stepsAvg")}</Text>
                  <Text style={styles.statValue}>
                    {data.steps_avg_per_day !== null ? data.steps_avg_per_day : t("insights.noData")}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>{t("insights.prevWeekDiff")}</Text>
                  <Text style={styles.statValue}>
                    {data.sleep_vs_prev_week_minutes !== null
                      ? formatSleepDiff(data.sleep_vs_prev_week_minutes)
                      : t("insights.noPrevData")}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{t("insights.loggingDays", { days: data.logging_days })}</Text>
                </View>
              </View>
              {daily.length > 0 && maxSteps > 0 ? (
                <View style={styles.card}>
                  <View style={styles.chart}>
                    {daily.map((d) => {
                      const h = Math.max(((d.steps ?? 0) / maxSteps) * 100, 2);
                      return (
                        <View key={d.date} style={styles.barCol}>
                          <Text style={styles.barValue}>{d.steps ?? 0}</Text>
                          <View style={styles.barArea}>
                            <View style={[styles.bar, { height: `${h}%` }]} />
                          </View>
                          <Text style={styles.barLabel}>{weekdayShort(d.date)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              {data.activity_summary ? (
                <View style={styles.card}>
                  <Text>{data.activity_summary}</Text>
                </View>
              ) : null}
              <View style={styles.card}>
                <Text>
                  {t("insights.lateDinner")} {data.late_dinner_sleep_note.note}
                  {data.late_dinner_sleep_note.status !== "insufficient_data"
                    ? ` (${data.late_dinner_sleep_note.late_dinner_days === 1
                      ? t("insights.day", { d: data.late_dinner_sleep_note.late_dinner_days })
                      : t("insights.days", { d: data.late_dinner_sleep_note.late_dinner_days })})`
                    : ""}
                </Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("insights.fun")}</Text>
                {todaySteps !== null && (
                  <Text style={styles.todayLine}>
                    {t("insights.today")}: {stepsToKm(todaySteps).toFixed(2)} km ≈{" "}
                    {metersToLandmark(todaySteps * METERS_PER_STEP, MINAR_HEIGHT_M).toFixed(1)}×
                    Minar-e-Pakistan · {Math.round(stepsToKcal(todaySteps))} kcal ≈{" "}
                    {kcalToCookies(stepsToKcal(todaySteps)).toFixed(2)} {t("insights.cookies")}
                  </Text>
                )}
                <Text style={styles.todayLine}>
                  {t("insights.weekly")}: {weekTotalKm.toFixed(2)} km ≈{" "}
                  {metersToLandmark(weekTotalKm * 1000, EIFFEL_HEIGHT_M).toFixed(1)}×
                  Eiffel Tower · {weekTotalKcal} kcal ≈{" "}
                  {kcalToCola(weekTotalKcal).toFixed(2)} {t("insights.cola")}
                </Text>
              </View>
              <Text style={styles.disclaimer}>{data.disclaimer}</Text>
            </>
          )}
          {tab === "calendar" && <InsightsCalendar weekSteps={data?.daily_steps ?? []} />}
          {tab === "records" && <InsightsRecords />}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center" },
  sub: { textAlign: "center", color: "#555" },
  tabBar: { flexDirection: "row", gap: 6 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
  },
  tabActive: { backgroundColor: GREEN, borderColor: GREEN },
  tabText: { fontSize: 13, fontWeight: "bold", color: "#555" },
  tabTextActive: { color: "#fff" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: {
    flexGrow: 1,
    flexBasis: "47%",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
  },
  statLabel: { fontSize: 13, color: "#555" },
  statValue: { fontSize: 18, fontWeight: "bold", marginTop: 4 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14 },
  cardTitle: { fontSize: 15, fontWeight: "bold", marginBottom: 6 },
  todaySteps: { fontSize: 34, fontWeight: "bold", textAlign: "center" },
  todayLine: { textAlign: "center", color: "#555", marginTop: 6 },
  targetBar: { height: 10, backgroundColor: "#e5e7eb", borderRadius: 5, marginTop: 10, overflow: "hidden" },
  targetFill: { height: "100%", backgroundColor: GREEN, borderRadius: 5 },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 140 },
  barCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  barValue: { fontSize: 10, color: "#555", marginBottom: 2 },
  barArea: { flex: 1, width: "100%", justifyContent: "flex-end" },
  bar: { backgroundColor: GREEN, borderRadius: 4, width: "100%" },
  barLabel: { fontSize: 11, color: "#555", marginTop: 4 },
  disclaimer: { color: "#555", fontStyle: "italic", marginTop: 4 },
  error: { color: "red", textAlign: "center" },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  btnOutline: { borderWidth: 1, borderColor: GREEN },
  btnOutlineText: { color: GREEN, fontSize: 16, fontWeight: "bold" },
});
