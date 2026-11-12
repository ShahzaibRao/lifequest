import React, { useCallback, useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import {
  deleteHomePack,
  downloadHomePack,
  getHomePackStatus,
  resumeHomePack,
  updateHomePack,
} from "./offlineMap";
import { useLanguage } from "../i18n/LanguageContext";

type CardState = "loading" | "none" | "downloading" | "ready" | "error";

export default function OfflineMapCard() {
  const { t } = useLanguage();
  const [state, setState] = useState<CardState>("loading");
  const [progress, setProgress] = useState(0);
  const [canResume, setCanResume] = useState(false);
  const [sizeMB, setSizeMB] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await getHomePackStatus();
      if (!s) {
        setState("none");
        setSizeMB(null);
        setCanResume(false);
        return;
      }
      if (s.state === "complete") {
        setState("ready");
        setSizeMB(s.completedTileSize / (1024 * 1024));
        setCanResume(false);
      } else {
        setState("downloading");
        setProgress(s.percentage);
        setCanResume(s.state === "inactive");
      }
    } catch {
      setState("none");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onProgress = useCallback(
    (pct: number, st: string) => {
      setProgress(pct);
      if (st === "complete") refresh();
    },
    [refresh],
  );

  const onError = useCallback((msg: string) => {
    setError(msg);
    setState("error");
  }, []);

  const onDownload = async () => {
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setError(t("offline.needPermission"));
        setState("error");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setState("downloading");
      setProgress(0);
      await downloadHomePack(
        pos.coords.longitude,
        pos.coords.latitude,
        onProgress,
        onError,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("offline.downloadFailed"));
      setState("error");
    }
  };

  const onResume = async () => {
    setError(null);
    setState("downloading");
    await resumeHomePack(onProgress, onError);
    await refresh();
  };

  const onUpdate = async () => {
    setError(null);
    setState("downloading");
    await updateHomePack(onProgress, onError);
    await refresh();
  };

  const onDelete = async () => {
    await deleteHomePack();
    await refresh();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("offline.title")}</Text>
      {state === "loading" && <Text>{t("offline.checking")}</Text>}
      {state === "none" && !skipped && (
        <View>
          <Text>{t("offline.downloadPrompt")}</Text>
          <Button title={t("offline.download")} onPress={onDownload} />
          <Button title={t("offline.skip")} onPress={() => setSkipped(true)} />
        </View>
      )}
      {state === "none" && skipped && (
        <Button title={t("offline.download")} onPress={onDownload} />
      )}
      {state === "downloading" && (
        <View>
          <Text>{t("offline.downloading", { pct: Math.floor(progress) })}</Text>
          {canResume && <Button title={t("offline.resume")} onPress={onResume} />}
        </View>
      )}
      {state === "ready" && (
        <View>
          <Text>
            {t("offline.ready")}
            {sizeMB !== null ? ` (${sizeMB.toFixed(1)} MB)` : ""}
          </Text>
          <Button title={t("offline.update")} onPress={onUpdate} />
          <Button title={t("offline.delete")} onPress={onDelete} />
        </View>
      )}
      {state === "error" && (
        <View>
          <Text>{t("offline.errorLabel", { msg: error ?? "" })}</Text>
          <Button title={t("offline.retry")} onPress={onDownload} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "#cccccc",
    borderRadius: 8,
    padding: 12,
    margin: 12,
  },
  title: { fontSize: 16, fontWeight: "bold", marginBottom: 6 },
});
