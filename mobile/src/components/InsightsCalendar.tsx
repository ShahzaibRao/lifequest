import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { kcalToCola, kcalToCookies, stepsToKcal } from "../steps/phoneSteps";
import { getLocalDay } from "../steps/localInsights";

type DailyStep = { date: string; steps: number | null; valid_m: number };

type Daily = {
  date: string;
  steps: number | null;
  valid_m: number;
  sessions: number;
  xp: number;
};

const GREEN = "#22c55e";

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar: month grid, tap a day to see that day's exact progress. */
export default function InsightsCalendar({ weekSteps }: { weekSteps: DailyStep[] }) {
  const { t } = useLanguage();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Daily | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);

  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  // Monday-first weekday (0 = Mon).
  const firstWeekday = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7;
  const stepsByDate = new Map(weekSteps.map((d) => [d.date, d.steps]));

  const monthName = new Date(ym.y, ym.m, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  async function onDay(date: string) {
    setSelected(date);
    setLoadingDay(true);
    setDetail(null);
    try {
      setDetail(await apiJson<Daily>(`/insights/daily?date=${date}`));
    } catch {
      // Offline: local SQLite.
      try {
        const d = await getLocalDay(date);
        setDetail({ date: d.date, steps: d.steps, valid_m: d.valid_m, sessions: d.sessions, xp: 0 });
      } catch {
        setDetail(null);
      }
    } finally {
      setLoadingDay(false);
    }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Pressable onPress={() => setYm((p) => ({ y: p.m === 0 ? p.y - 1 : p.y, m: p.m === 0 ? 11 : p.m - 1 }))}>
          <Text style={{ fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 15, fontWeight: "bold" }}>{monthName}</Text>
        <Pressable onPress={() => setYm((p) => ({ y: p.m === 11 ? p.y + 1 : p.y, m: p.m === 11 ? 0 : p.m + 1 }))}>
          <Text style={{ fontSize: 18 }}>›</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <Text key={i} style={{ flex: 1, textAlign: "center", color: "#888", fontSize: 12 }}>
            {d}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <View key={i} style={{ width: "14.28%", aspectRatio: 1 }} />;
          const date = iso(ym.y, ym.m, d);
          const steps = stepsByDate.get(date);
          const isSel = selected === date;
          return (
            <Pressable
              key={i}
              onPress={() => onDay(date)}
              style={{
                width: "14.28%",
                aspectRatio: 1,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isSel ? GREEN : "transparent",
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 14, color: isSel ? "#fff" : "#111", fontWeight: steps ? "bold" : "normal" }}>
                {d}
              </Text>
              {steps ? (
                <Text style={{ fontSize: 9, color: isSel ? "#fff" : GREEN }}>{steps}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {selected && (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: "bold", textAlign: "center" }}>{selected}</Text>
          {loadingDay ? (
            <Text style={{ textAlign: "center", color: "#555", marginTop: 6 }}>{t("insights.loading")}</Text>
          ) : detail ? (
            <>
              <Text style={{ textAlign: "center", color: "#555", marginTop: 6 }}>
                {detail.steps ?? 0} {t("insights.steps")} · {(detail.valid_m / 1000).toFixed(2)} km ·{" "}
                {Math.round(stepsToKcal(detail.steps ?? 0))} kcal
              </Text>
              <Text style={{ textAlign: "center", color: "#555", marginTop: 4 }}>
                {detail.sessions} {t("insights.sessions")} · {detail.xp} XP
              </Text>
              <Text style={{ textAlign: "center", color: "#555", marginTop: 4 }}>
                ≈ {kcalToCookies(stepsToKcal(detail.steps ?? 0)).toFixed(2)} {t("insights.cookies")} ·{" "}
                {kcalToCola(stepsToKcal(detail.steps ?? 0)).toFixed(2)} {t("insights.cola")}
              </Text>
            </>
          ) : (
            <Text style={{ textAlign: "center", color: "#555", marginTop: 6 }}>{t("insights.noData")}</Text>
          )}
        </View>
      )}
    </View>
  );
}
