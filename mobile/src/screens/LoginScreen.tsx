import React, { useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import { ResponseType } from "expo-auth-session";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function LoginScreen() {
  const { t } = useLanguage();
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    // Code flow: Google rejects response_type=id_token (implicit flow) for
    // Android/iOS native clients (Error 400 invalid_request). The code is
    // auto-exchanged for tokens (incl. id_token) by expo-auth-session.
    responseType: ResponseType.Code,
  });

  useEffect(() => {
    (async () => {
      if (response?.type !== "success") {
        if (response?.type === "error") {
          setError(response.error?.message ?? t("login.failed"));
        }
        return;
      }
      const idToken =
        (response.params as { id_token?: string } | undefined)?.id_token ??
        response.authentication?.idToken;
      if (!idToken) {
        setError(t("login.failed"));
        return;
      }
      setError("");
      setBusy(true);
      try {
        await signInWithGoogle(idToken);
      } catch (e: any) {
        setError(e.message ?? t("login.failed"));
      } finally {
        setBusy(false);
      }
    })();
  }, [response]);

  const onGooglePress = () => {
    if (
      !process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID &&
      !process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID &&
      !process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
    ) {
      setError("Google sign-in is not configured yet");
      return;
    }
    setError("");
    promptAsync();
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>LifeQuest</Text>
      <Text style={styles.subtitle}>{t("login.subtitle")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        title={busy ? t("login.loggingIn") : t("login.continueWithGoogle")}
        onPress={onGooglePress}
        disabled={busy || !request}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "bold", textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 15, color: "#666666", textAlign: "center", marginBottom: 12 },
  googleButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dadce0",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  error: { color: "red", textAlign: "center" },
});
