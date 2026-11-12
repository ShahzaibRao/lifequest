import React, { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function LoginScreen({ navigation }: any) {
  const { t } = useLanguage();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onLogin = async () => {
    setError("");
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setError(e.message ?? t("login.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>LifeQuest</Text>
      <TextInput style={styles.input} placeholder={t("login.email")} autoCapitalize="none"
        keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder={t("login.password")} secureTextEntry
        value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={busy ? t("login.loggingIn") : t("login.login")} onPress={onLogin} disabled={busy} />
      <View style={styles.gap} />
      <Button title={t("login.createAccount")} onPress={() => navigation.navigate("Register")} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "bold", textAlign: "center", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 12 },
  error: { color: "red", textAlign: "center" },
  gap: { height: 8 },
});
