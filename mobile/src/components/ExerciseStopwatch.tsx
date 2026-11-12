import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { getCached, setCached } from "../cache/cache";
import { drainExerciseOutbox, enqueueExercise } from "../health/healthStore";

type Exercise = {
  id: string;
  exercise_type: string;
  duration_minutes: number;
  calories: number;
  logged_date: string;
};

type Phase = "idle" | "running" | "paused" | "stopped";

type SavedStopwatch = {
  etype: string;
  baseSec: number;
  phase: Phase;
  startedAtMs: number | null;
};

const TYPES = ["running", "cycling", "gym", "swimming", "walking", "other"];
const SW_KEY = "exercise_stopwatch";

/** Stopwatch exercise recorder: Start / Pause / Resume / Stop / Reset / Save.
 *  State is saved to local SQLite so it survives leaving the screen. */
export default function ExerciseStopwatch() {
  const { t } = useLanguage();
  const [etype, setEtype] = useState("running");
  const [baseSec, setBaseSec] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Exercise[]>([]);
  const stateRef = useRef({ etype, baseSec, phase, startedAtMs });

  const running = phase === "running";
  const elapsedSec = Math.floor(
    baseSec + (running && startedAtMs ? (nowMs - startedAtMs) / 1000 : 0)
  );

  // Keep the ref fresh so the unmount-save always has the latest state.
  useEffect(() => {
    stateRef.current = { etype, baseSec, phase, startedAtMs };
  });

  const persist = useCallback((s: SavedStopwatch) => {
    setCached(SW_KEY, s);
  }, []);

  const load = useCallback(async () => {
    // Sync any exercise saved while offline, then refresh the list.
    await drainExerciseOutbox();
    try {
      const items = await apiJson<Exercise[]>("/exercise");
      setItems(items);
      await setCached("exercise:list", items);
    } catch {
      const cached = await getCached<Exercise[]>("exercise:list");
      setItems(cached?.data ?? []);
    }
  }, []);

  // Restore a stopwatch that was left running/paused/stopped.
  useEffect(() => {
    (async () => {
      const saved = await getCached<SavedStopwatch>(SW_KEY);
      if (!saved || !saved.data) return;
      const s = saved.data;
      if (s.baseSec <= 0 && s.phase !== "running") return;
      setEtype(s.etype);
      setBaseSec(s.baseSec);
      setPhase(s.phase === "running" ? "running" : s.phase === "stopped" ? "stopped" : "paused");
      setStartedAtMs(s.phase === "running" ? s.startedAtMs : null);
    })();
    load();
  }, [load]);

  // Tick while running so the display updates every second.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Save on unmount (leaving the screen) so the timer survives.
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (s.baseSec > 0 || s.phase === "running") {
        setCached(SW_KEY, { etype: s.etype, baseSec: s.baseSec, phase: s.phase, startedAtMs: s.startedAtMs });
      }
    };
  }, []);

  function start() {
    const s: SavedStopwatch = { etype, baseSec, phase: "running", startedAtMs: Date.now() };
    setStartedAtMs(s.startedAtMs);
    setPhase("running");
    setNowMs(Date.now());
    persist(s);
  }

  function pause() {
    const s: SavedStopwatch = { etype, baseSec: elapsedSec, phase: "paused", startedAtMs: null };
    setBaseSec(elapsedSec);
    setStartedAtMs(null);
    setPhase("paused");
    persist(s);
  }

  function stop() {
    const s: SavedStopwatch = { etype, baseSec: elapsedSec, phase: "stopped", startedAtMs: null };
    setBaseSec(elapsedSec);
    setStartedAtMs(null);
    setPhase("stopped");
    persist(s);
  }

  function reset() {
    setBaseSec(0);
    setStartedAtMs(null);
    setPhase("idle");
    setCached(SW_KEY, { etype, baseSec: 0, phase: "idle" as Phase, startedAtMs: null });
  }

  async function save() {
    const mins = Math.max(1, Math.round(elapsedSec / 60));
    if (elapsedSec <= 0 || phase !== "stopped" || saving) return;
    setSaving(true);
    try {
      await apiJson("/exercise", {
        method: "POST",
        body: JSON.stringify({ exercise_type: etype, duration_minutes: mins }),
      });
      reset();
      await load();
    } catch {
      // Offline: queue it — it syncs on the next load. Timer resets so
      // the user sees the exercise as saved.
      await enqueueExercise(etype, mins);
      reset();
      await load();
    } finally {
      setSaving(false);
    }
  }

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const phaseLabel = running ? `● ${etype}` : phase === "paused" ? `${etype} · ${t("insights.paused")}` : etype;

  return (
    <View style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 14 }}>
      <Text style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8 }}>{t("insights.exercise")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TYPES.map((ty) => (
          <Pressable
            key={ty}
            onPress={() => setEtype(ty)}
            disabled={running}
            style={{
              borderWidth: 1,
              borderColor: etype === ty ? "#22c55e" : "#d1d5db",
              backgroundColor: etype === ty ? "#dcfce7" : "#fff",
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 6,
              opacity: running ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 13 }}>{ty}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ fontSize: 44, fontWeight: "bold", textAlign: "center", marginTop: 12 }}>
        {mm}:{ss}
      </Text>
      <Text style={{ textAlign: "center", color: running ? "#dc2626" : "#555", marginTop: 2 }}>
        {phaseLabel}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {phase === "idle" && (
          <Pressable
            style={{ flex: 1, backgroundColor: "#22c55e", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
            onPress={start}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>{t("insights.start")}</Text>
          </Pressable>
        )}
        {running && (
          <>
            <Pressable
              style={{ flex: 1, backgroundColor: "#f59e0b", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
              onPress={pause}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>{t("insights.pause")}</Text>
            </Pressable>
            <Pressable
              style={{ flex: 1, backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
              onPress={stop}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>{t("insights.stop")}</Text>
            </Pressable>
          </>
        )}
        {phase === "paused" && (
          <>
            <Pressable
              style={{ flex: 1, backgroundColor: "#22c55e", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
              onPress={start}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>{t("insights.resume")}</Text>
            </Pressable>
            <Pressable
              style={{ flex: 1, backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
              onPress={stop}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>{t("insights.stop")}</Text>
            </Pressable>
          </>
        )}
      </View>
      {phase === "stopped" && (
        <Pressable
          style={{ borderWidth: 1, borderColor: "#22c55e", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10 }}
          onPress={reset}
        >
          <Text style={{ color: "#22c55e", fontSize: 15, fontWeight: "bold" }}>{t("insights.reset")}</Text>
        </Pressable>
      )}
      {phase === "paused" && (
        <Pressable
          style={{ borderWidth: 1, borderColor: "#22c55e", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10 }}
          onPress={reset}
        >
          <Text style={{ color: "#22c55e", fontSize: 15, fontWeight: "bold" }}>{t("insights.reset")}</Text>
        </Pressable>
      )}
      <Pressable
        style={{ backgroundColor: "#22c55e", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10, opacity: phase === "stopped" && elapsedSec > 0 && !saving ? 1 : 0.5 }}
        disabled={phase !== "stopped" || elapsedSec <= 0 || saving}
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
