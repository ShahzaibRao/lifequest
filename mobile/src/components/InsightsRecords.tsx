import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { kcalToCola, kcalToCookies, stepsToKcal } from "../steps/phoneSteps";
import { getLocalMonth } from "../steps/localInsights";

type Day = {
  date: string;
  steps: number | null;
  valid_m: number;
  sessions: number;
  xp: number;
};

/** All Records: month filter + day-wise list (steps, distance, kcal, sessions, XP). */
export default function InsightsRecords() {
  const { t } = useLanguage();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson<{ days: Day[] }>(
        `/insights/records?year=${ym.y}&month=${ym.m + 1}`
      );
      setDays(res.days ?? []);
    } catch {
      // Offline: local SQLite.
      try {
        const local = await getLocalMonth(ym.y, ym.m + 1);
        setDays(local.map((d) => ({ date: d.date, steps: d.steps, valid_m: d.valid_m, sessions: d.sessions, xp: 0 })));
      } catch {
        setDays([]);
      }
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useEffect(() => {
    load();
  }, [load]);

  const monthName = new Date(ym.y, ym.m, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14 }}>
      <Text style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8 }}>{t("insights.records")}</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Pressable onPress={() => setYm((p) => ({ y: p.m === 0 ? p.y - 1 : p.y, m: p.m === 0 ? 11 : p.m - 1 }))}>
          <Text style={{ fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 14, fontWeight: "bold" }}>{monthName}</Text>
        <Pressable onPress={() => setYm((p) => ({ y: p.m === 11 ? p.y + 1 : p.y, m: p.m === 11 ? 0 : p.m + 1 }))}>
          <Text style={{ fontSize: 18 }}>›</Text>
        </Pressable>
      </View>
      {loading ? (
        <Text style={{ textAlign: "center", color: "#555" }}>{t("insights.loading")}</Text>
      ) : days.length === 0 ? (
        <Text style={{ textAlign: "center", color: "#555" }}>{t("insights.noData")}</Text>
      ) : (
        days.map((d) => {
          const kcal = Math.round(stepsToKcal(d.steps ?? 0));
          return (
            <View
              key={d.date}
              style={{ borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingVertical: 10 }}
            >
              <Text style={{ fontSize: 14, fontWeight: "bold" }}>{d.date}</Text>
              <Text style={{ color: "#555", marginTop: 2 }}>
                {d.steps ?? 0} {t("insights.steps")} · {(d.valid_m / 1000).toFixed(2)} km · {kcal} kcal
              </Text>
              <Text style={{ color: "#555", marginTop: 2 }}>
                {d.sessions} {t("insights.sessions")} · {d.xp} XP · ≈{" "}
                {kcalToCookies(kcal).toFixed(2)} {t("insights.cookies")} ·{" "}
                {kcalToCola(kcal).toFixed(2)} {t("insights.cola")}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}
