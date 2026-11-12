import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LANGUAGES } from "../i18n/translations";
import { useLanguage } from "../i18n/LanguageContext";
import OfflineMapCard from "../map/OfflineMapCard";

export default function SettingsScreen() {
  const { language, setLanguage, t, isRTL } = useLanguage();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("settings.language")}</Text>
      {LANGUAGES.map((l) => (
        <Pressable key={l.code} onPress={() => setLanguage(l.code)}>
          <Text style={language === l.code ? styles.rowActive : styles.row}>
            {l.label}
            {language === l.code ? " ✓" : ""}
          </Text>
        </Pressable>
      ))}
      {isRTL ? <Text style={styles.note}>{t("settings.rtlNote")}</Text> : null}
      <View style={styles.divider} />
      <OfflineMapCard />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  row: { fontSize: 18, paddingVertical: 10, color: "#888" },
  rowActive: { fontSize: 18, fontWeight: "bold", paddingVertical: 10, color: "#007AFF" },
  note: { fontSize: 14, color: "#888", marginTop: 16 },
  divider: { height: 1, backgroundColor: "#e5e7eb", marginVertical: 16 },
});
