import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import { Pedometer } from "expo-sensors";
import { WALK_TASK } from "../walk/backgroundTask";
import WalkLiveMap from "../walk/WalkLiveMap";
import {
  createLocalSession,
  deleteLocalSession,
  deleteStaleSessions,
  getMaxSeq,
  getPointsCount,
  getUnfinishedSession,
  insertPoint,
  setSessionStatus,
  type LocalSession,
} from "../walk/walkStore";
import { getDb } from "../db/database";
import { apiJson } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";

type Phase = "idle" | "active" | "paused" | "done";

function formatElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return "00:00";
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function WalkScreen() {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<LocalSession | null>(null);
  const [points, setPoints] = useState(0);
  const [steps, setSteps] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [now, setNow] = useState(Date.now());

  const subRef = useRef<Location.LocationSubscription | null>(null);
  const modeRef = useRef<"foreground" | "background" | null>(null);
  const sessionRef = useRef<LocalSession | null>(null);
  const seqRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const stepsSubRef = useRef<{ remove: () => void } | null>(null);
  const stepsBaselineRef = useRef<number | null>(null);
  const stepsRef = useRef<number | null>(null);
  // Live dot: last time a position was POSTed (throttle to 1 per 5 s).
  const lastLiveSentRef = useRef(0);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  useEffect(() => {
    (async () => {
      await getDb();
      // 24h se purani adhuri walk abandon hai — wapas nahi aani chahiye.
      const stale = await deleteStaleSessions();
      if (stale > 0) {
        console.log(`[walk] deleted ${stale} stale session(s)`);
      }
      const unfinished = await getUnfinishedSession();
      if (unfinished) {
        sessionRef.current = unfinished;
        setSession(unfinished);
        setPoints(await getPointsCount(unfinished.session_uuid));
        seqRef.current = await getMaxSeq(unfinished.session_uuid);
        setPhaseBoth(unfinished.status === "paused" ? "paused" : "active");
        // NOTE: an unfinished session found here was active when the app
        // died, so it restarts paused — the user presses Resume to continue.
        if (unfinished.status === "active") {
          await setSessionStatus(unfinished.session_uuid, "paused");
          setPhaseBoth("paused");
        }
      }
    })();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      // Only foreground tracking stops when leaving the screen.
      // Background tracking must keep running — that is the point.
      if (modeRef.current === "foreground") {
        subRef.current?.remove();
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Points written by the background task while this screen was
      // hidden only show up when we refresh from the database.
      (async () => {
        if (sessionRef.current) {
          setPoints(await getPointsCount(sessionRef.current.session_uuid));
        }
      })();
    }, []),
  );

      // Background mode mein counter screen par rehte hue bhi refresh hona
    // chahiye — focus effect sirf screen par wapas aane par chalta hai.
    useEffect(() => {
      const id = setInterval(async () => {
        if (sessionRef.current) {
          setPoints(await getPointsCount(sessionRef.current.session_uuid));
          setSteps(stepsRef.current);
          // Steps sirf memory mein na rahen — har 5s SQLite mein save
          // karo taake remount/resume pe bhi na khoyen.
          if (stepsRef.current !== null) {
            await setSessionStatus(
              sessionRef.current.session_uuid,
              "active",
              null,
              stepsRef.current,
            );
          }
        }
      }, 5000);
      return () => clearInterval(id);
    }, []);


const onPosition = async (pos: Location.LocationObject) => {
    const s = sessionRef.current;
    if (!s || phaseRef.current !== "active") return;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const recordedAt = new Date(pos.timestamp).toISOString();
    try {
      await insertPoint(s.session_uuid, {
        seq,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
        recorded_at: recordedAt,
      });
      setPoints(seq);
    } catch {
      // A duplicate seq (e.g. a retried insert) must not kill tracking.
      seqRef.current = await getMaxSeq(s.session_uuid);
    }
    // Live dot (foreground only): at most once per 5 s, fire-and-forget.
    // A failed POST must never break tracking, so it is never awaited.
    const nowMs = Date.now();
    if (nowMs - lastLiveSentRef.current >= 5000) {
      lastLiveSentRef.current = nowMs;
      apiJson("/live/position", {
        method: "POST",
        body: JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      }).catch(() => {});
    }
  };

  const stopTracking = async () => {
    if (modeRef.current === "background") {
      try {
        await Location.stopLocationUpdatesAsync(WALK_TASK);
      } catch {
        // Task was not running — nothing to stop.
      }
    } else {
      subRef.current?.remove();
    }
    subRef.current = null;
    modeRef.current = null;
  };

  const subscribe = async () => {
    let bgPerm: Location.PermissionResponse | null = null;
    try {
      bgPerm = await Location.requestBackgroundPermissionsAsync();
    } catch {
      // Permission missing from the native build — fall back to
      // foreground tracking instead of crashing the walk.
      bgPerm = null;
    }
    if (bgPerm?.status === "granted") {
      const started = await Location.hasStartedLocationUpdatesAsync(WALK_TASK);
      if (!started) {
        await Location.startLocationUpdatesAsync(WALK_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
          foregroundService: {
            notificationTitle: t("walk.notifTitle"),
            notificationBody: t("walk.notifBody"),
            notificationColor: "#0066cc",
          },
        });
      }
      modeRef.current = "background";
    } else {
      subRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        onPosition,
      );
      modeRef.current = "foreground";
    }
  };

  const startWalk = async () => {
    setError("");
    setSummary("");
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      setError(t("walk.needPermission"));
      return;
    }
    const uuid = Crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await createLocalSession(uuid, startedAt);
    const row: LocalSession = {
      session_uuid: uuid,
      status: "active",
      started_at: startedAt,
      ended_at: null,
      total_steps: null,
    };
    sessionRef.current = row;
    seqRef.current = 0;
    setSession(row);
    setPoints(0);
    setSteps(null);
    await subscribe();
    setPhaseBoth("active");
    stepsBaselineRef.current = null;
    stepsRef.current = null;
    try {
      if (await Pedometer.isAvailableAsync()) {
        stepsSubRef.current?.remove();
        stepsSubRef.current = Pedometer.watchStepCount((result) => {
          if (stepsBaselineRef.current === null) {
            stepsBaselineRef.current = result.steps;
          }
          stepsRef.current = result.steps - (stepsBaselineRef.current ?? 0);
        });
      }
    } catch {
      // Pedometer unavailable — steps stay null, walk continues.
    }
  };

  const pauseWalk = async () => {
    await stopTracking();
    if (sessionRef.current) {
      await setSessionStatus(sessionRef.current.session_uuid, "paused");
    }
    setPhaseBoth("paused");
  };

  const resumeWalk = async () => {
    setError("");
    await subscribe();
    if (!stepsSubRef.current) {
      // NOTE: stepsRef/baseline reset NAHI karte — pause se pehle wale
      // steps zaya ho jate hain. Purana baseline barkarar rehta hai,
      // Pedometer usi se aage count karta hai.
      try {
        if (await Pedometer.isAvailableAsync()) {
          stepsSubRef.current = Pedometer.watchStepCount((result) => {
            if (stepsBaselineRef.current === null) {
              stepsBaselineRef.current = result.steps;
            }
            stepsRef.current = result.steps - (stepsBaselineRef.current ?? 0);
          });
        }
      } catch {
        // Pedometer unavailable — steps stay null, walk continues.
      }
    }
    if (sessionRef.current) {
      await setSessionStatus(sessionRef.current.session_uuid, "active");
    }
    setPhaseBoth("active");
  };

  const stopWalk = async () => {
    await stopTracking();
    const s = sessionRef.current;
    if (!s) return;
    const count = await getPointsCount(s.session_uuid);
    if (count === 0) {
      await deleteLocalSession(s.session_uuid);
      sessionRef.current = null;
      setSession(null);
      setSummary(t("walk.noPoints"));
      setPhaseBoth("done");
      return;
    }
    stepsSubRef.current?.remove();
    stepsSubRef.current = null;
    const steps: number | null = stepsRef.current;
    await setSessionStatus(s.session_uuid, "pending_sync", new Date().toISOString(), steps);
    sessionRef.current = null;
    setSession(null);
    setSummary(
      t("walk.saved", {
        count,
        steps: steps !== null ? steps : t("walk.unknownSteps"),
      }),
    );
    setPhaseBoth("done");
  };

  const discardWalk = async () => {
    await stopTracking();
    stepsSubRef.current?.remove();
    stepsSubRef.current = null;
    if (sessionRef.current) {
      await deleteLocalSession(sessionRef.current.session_uuid);
    }
    sessionRef.current = null;
    setSession(null);
    setSummary(t("walk.discarded"));
    setPhaseBoth("idle");
  };

  return (
    <View style={styles.box}>
      <View style={styles.mapWrap}>
        <WalkLiveMap sessionUuid={session?.session_uuid ?? null} showOverlay={false} />
      </View>
      <View style={styles.bottomCard}>
        {phase === "idle" ? (
          <>
            <Text style={styles.note}>{summary || t("walk.idleNote")}</Text>
            <Pressable style={[styles.btn, styles.btnGreen]} onPress={startWalk}>
              <Text style={styles.btnGreenText}>{t("walk.startWalk")}</Text>
            </Pressable>
          </>
        ) : null}
        {session ? (
          <>
            <Text style={styles.big}>{phase === "active" ? t("walk.walking") : t("walk.paused")}</Text>
            <Text style={styles.meta}>
              {t("walk.time", { time: formatElapsed(session.started_at, now) })} • {t("walk.points", { count: points })} • {t("live.steps", { steps: steps === null ? "—" : steps })}
            </Text>
            <Text style={styles.session}>{t("walk.session", { id: session.session_uuid.slice(0, 8) })}</Text>
            <Text style={styles.legend}>
              <Text style={{ color: "#008800" }}>●</Text> {t("live.legendOwn")}{"  "}
              <Text style={{ color: "#aa0000" }}>●</Text> {t("live.legendOther")}{"  "}
              <Text style={{ color: "#B8860B" }}>●</Text> {t("live.legendCapture")}{"  "}
              <Text style={{ color: "#cc3300" }}>●</Text> {t("live.legendChallenge")}
            </Text>
            {phase === "active" ? (
              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.btnAmber, styles.btnFlex]} onPress={pauseWalk}>
                  <Text style={styles.btnAmberText}>{t("walk.pause")}</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnRed, styles.btnFlex]} onPress={stopWalk}>
                  <Text style={styles.btnRedText}>{t("walk.stop")}</Text>
                </Pressable>
              </View>
            ) : null}
            {phase === "paused" ? (
              <>
                <View style={styles.row}>
                  <Pressable style={[styles.btn, styles.btnGreen, styles.btnFlex]} onPress={resumeWalk}>
                    <Text style={styles.btnGreenText}>{t("walk.resume")}</Text>
                  </Pressable>
                  <Pressable style={[styles.btn, styles.btnRed, styles.btnFlex]} onPress={stopWalk}>
                    <Text style={styles.btnRedText}>{t("walk.stop")}</Text>
                  </Pressable>
                </View>
                <Pressable onPress={discardWalk}>
                  <Text style={styles.simLink}>{t("walk.discard")}</Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : null}
        {phase === "done" ? (
          <>
            <Text style={styles.note}>{summary}</Text>
            <Pressable
              style={[styles.btn, styles.btnGreen]}
              onPress={() => {
                setSummary("");
                setPhaseBoth("idle");
              }}
            >
              <Text style={styles.btnGreenText}>{t("walk.newWalk")}</Text>
            </Pressable>
          </>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1 },
  mapWrap: { flex: 1 },
  bottomCard: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    paddingBottom: 22,
    gap: 8,
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  },
  big: { fontSize: 18, fontWeight: "bold", textAlign: "center" },
  meta: { fontSize: 15, color: "#333", textAlign: "center" },
  session: { fontSize: 12, color: "#888", textAlign: "center" },
  note: { textAlign: "center", color: "#555" },
  legend: { fontSize: 11, color: "#333333", textAlign: "center" },
  error: { color: "red", textAlign: "center" },
  row: { flexDirection: "row", gap: 10 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnFlex: { flex: 1 },
  btnGreen: { backgroundColor: "#22c55e" },
  btnGreenText: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },
  btnRed: { backgroundColor: "#dc2626" },
  btnRedText: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },
  btnAmber: { borderWidth: 1, borderColor: "#d97706", backgroundColor: "#fff" },
  btnAmberText: { color: "#b45309", fontSize: 16, fontWeight: "bold" },
  simLink: { textAlign: "center", color: "#888", fontSize: 14, paddingVertical: 4 },
});
