import React, { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../i18n/LanguageContext";

export default function RegisterScreen({ navigation }: any) {
  const { t } = useLanguage();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onRegister = async () => {
    setError("");
    if (password.length < 8) {
      setError(t("register.passwordShort"));
      return;
    }
    setBusy(true);
    try {
      await register(email.trim(), password, displayName.trim());
    } catch (e: any) {
      setError(e.message ?? t("register.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("register.title")}</Text>
      <TextInput style={styles.input} placeholder={t("register.displayName")}
        value={displayName} onChangeText={setDisplayName} />
      <TextInput style={styles.input} placeholder={t("register.email")} autoCapitalize="none"
        keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder={t("register.password")} secureTextEntry
        value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={busy ? t("register.creating") : t("register.register")} onPress={onRegister} disabled={busy} />
      <View style={styles.gap} />
      <Button title={t("register.backToLogin")} onPress={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 12 },
  error: { color: "red", textAlign: "center" },
  gap: { height: 8 },
});
