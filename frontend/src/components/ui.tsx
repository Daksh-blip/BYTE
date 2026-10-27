import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, TextInputProps, View, ViewStyle, StyleProp } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type BtnProps = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  testID: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, onPress, variant = "primary", loading, disabled, icon, testID, style }: BtnProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const bg = {
    primary: colors.brandPrimary,
    secondary: colors.surfaceTertiary,
    ghost: "transparent",
    danger: colors.error,
  }[variant];
  const fg = {
    primary: colors.onBrandPrimary,
    secondary: colors.onSurface,
    ghost: colors.brandPrimary,
    danger: colors.onError,
  }[variant];
  const off = disabled || loading;
  return (
    <Animated.View style={[anim, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        disabled={off}
        onPressIn={() => (scale.value = withSpring(0.97))}
        onPressOut={() => (scale.value = withSpring(1))}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress();
        }}
        style={[s.btn, { backgroundColor: bg, opacity: off ? 0.5 : 1 }, variant === "ghost" && s.ghost]}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={s.btnRow}>
            {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
            <Text style={[s.btnText, { color: fg }]}>{title}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

type FieldProps = TextInputProps & { label: string; error?: string | null; testID: string; secure?: boolean };

export function Field({ label, error, secure, testID, style, ...rest }: FieldProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  const [hidden, setHidden] = useState(!!secure);
  return (
    <View style={s.fieldWrap}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputBox, focus && { borderColor: colors.brandPrimary }, !!error && { borderColor: colors.error }]}>
        <TextInput
          testID={testID}
          placeholderTextColor={colors.muted}
          selectionColor={colors.brandPrimary}
          secureTextEntry={hidden}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={[s.input, style]}
          {...rest}
        />
        {secure ? (
          <Pressable testID={`${testID}-toggle`} onPress={() => setHidden((h) => !h)} hitSlop={12} style={s.eye}>
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text testID={`${testID}-error`} style={s.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress?: () => void; testID: string }) {
  const s = useStyles();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} style={[s.chip, selected && s.chipOn]}>
      <Text style={[s.chipText, selected && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  testID,
  color,
  size = 22,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  testID: string;
  color?: string;
  size?: number;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={8} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={size} color={color ?? colors.onSurface} />
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  action?: React.ReactNode;
  testID: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View testID={testID} style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={36} color={colors.brandPrimary} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  btn: { height: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  ghost: { height: 44 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  btnText: { fontSize: font.lg, fontWeight: "700", letterSpacing: 0.2 },
  fieldWrap: { gap: spacing.sm },
  label: { color: c.onSurfaceTertiary, fontSize: font.base, fontWeight: "600" },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    minHeight: 52,
  },
  input: { flex: 1, color: c.onSurface, fontSize: font.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minWidth: 0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}) },
  eye: { paddingHorizontal: spacing.lg, height: 52, justifyContent: "center" },
  error: { color: c.error, fontSize: font.sm },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    justifyContent: "center",
  },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.brandPrimarySoft },
  chipText: { color: c.onSurfaceSecondary, fontSize: font.base, fontWeight: "600" },
  chipTextOn: { color: c.brandPrimary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.brandPrimarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  emptyTitle: { color: c.onSurface, fontSize: font.xl, fontWeight: "700", textAlign: "center" },
  emptyBody: { color: c.muted, fontSize: font.base, textAlign: "center", lineHeight: 20, marginBottom: spacing.md },
}));
