import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import * as Updates from "expo-updates";

// OTA update check — runs once when the user is inside the app.
// If a new JS update was published (eas update), it downloads in the
// background and offers a restart to apply it. Silent when offline,
// when no update exists, or in dev (Metro) where OTA is disabled.
// Native changes (new native module / permission / app.json native
// change) still need a fresh APK build — OTA covers JS/TS only.
export function useAppUpdate(enabled: boolean) {
  const askedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        if (!Updates.isEnabled) return; // dev / Metro — OTA off
        const check = await Updates.checkForUpdateAsync();
        if (cancelled || !check.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (cancelled || askedRef.current) return;
        askedRef.current = true;
        Alert.alert(
          "Naya update available",
          "App ka naya version download ho gaya hai. Restart karke update lagayein?",
          [
            { text: "Baad mein", style: "cancel" },
            { text: "Update karein", onPress: () => void Updates.reloadAsync() },
          ]
        );
      } catch {
        // offline ya check fail — chup chap, agli dafa phir try hoga
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
