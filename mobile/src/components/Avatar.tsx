import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type AvatarPreset = {
  key: string;
  icon: string;
  color: string;
};

type Props = {
  avatarKey: string | null | undefined;
  presets: AvatarPreset[];
  displayName: string;
  size?: number;
};

const FALLBACK_COLORS = ["#22c55e", "#ef4444", "#3b82f6", "#f97316", "#a855f7", "#14b8a6"];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
}

function colorForName(name: string): string {
  let h = 0;
  for (const ch of name) h = (h + ch.charCodeAt(0)) % 997;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

export default function Avatar({ avatarKey, presets, displayName, size = 36 }: Props) {
  const preset = useMemo(
    () => (avatarKey ? presets.find((p) => p.key === avatarKey) ?? null : null),
    [avatarKey, presets],
  );
  const bg = preset ? preset.color : colorForName(displayName);
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      {preset ? (
        <Ionicons name={preset.icon as keyof typeof Ionicons.glyphMap} size={size * 0.55} color="#ffffff" />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initialsOf(displayName)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  initials: { color: "#ffffff", fontWeight: "bold" },
});
