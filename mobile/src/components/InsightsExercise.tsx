import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";

type Exercise = {
  id: string;
  exercise_type: string;
  duration_minutes: number;
  calories: number;
  logged_date: string;
};

const TYPES = ["running", "cycling", "gym", "swimming", "walking", "other"];

/** Record exercise: pick a type + minutes, save, and see recent entries. */
export default function InsightsExercise() {
  const { t } = useLanguage();
  const [etype, setEtype] = useState("running");
  const [minutes, setMinutes] = useState("");
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Exercise[]>([]);

  const load = useCallback(async () => {
    try {
      setItems(await apiJson<Exercise[]>("/exercise"));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const mins = parseInt(minutes, 10);
    if (!mins || mins <= 0) return;
    setSaving(true);
    try {
      await apiJson("/exercise", {
        method: "POST",
        body: JSON.stringify({ exercise_type: etype, duration_minutes: mins }),
      });
      setMinutes("");
      await load();
    } catch {
      // keep form
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14 }}>
      <Text style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8 }}>{t("insights.exercise")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TYPES.map((ty) => (
          <Pressable
            key={ty}
            onPress={() => setEtype(ty)}
            style={{
              borderWidth: 1,
              borderColor: etype === ty ? "#22c55e" : "#d1d5db",
              backgroundColor: etype === ty ? "#dcfce7" : "#fff",
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text style={{ fontSize: 13 }}>{ty}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={{ borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10, marginTop: 10, textAlign: "center", fontSize: 16 }}
        value={minutes}
        onChangeText={setMinutes}
        keyboardType="numeric"
        placeholder={t("insights.exerciseMinutes")}
      />
      <Pressable
        style={{ backgroundColor: "#22c55e", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10, opacity: saving ? 0.5 : 1 }}
        disabled={saving}
        onPress={save}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>{t("insights.save")}</Text>
      </Pressable>
      {items.length > 0 && (
        <View style={{ marginTop: 10 }}>
          {items.slice(0, 5).map((it) => (
            <Text key={it.id} style={{ color: "#555", marginTop: 4 }}>
              {it.logged_date} · {it.exercise_type} · {it.duration_minutes} min · {it.calories} kcal
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
