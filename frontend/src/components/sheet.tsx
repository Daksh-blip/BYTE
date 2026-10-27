import React from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeStyles, spacing, radius, font } from "@/src/theme";

export function Sheet({
  visible,
  onClose,
  title,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  testID: string;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.root}>
        <Pressable testID={`${testID}-backdrop`} style={s.backdrop} onPress={onClose} />
        <View testID={testID} style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={s.handle} />
          {title ? <Text style={s.title}>{title}</Text> : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetRow({
  label,
  onPress,
  danger,
  testID,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  testID: string;
}) {
  const s = useStyles();
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}>
      <Text style={[s.rowText, danger && s.danger]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const), backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.md,
    maxHeight: "85%",
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: spacing.sm },
  title: { color: c.onSurface, fontSize: font.xl, fontWeight: "700", marginBottom: spacing.xs },
  row: { minHeight: 52, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: c.divider },
  rowText: { color: c.onSurface, fontSize: font.lg, fontWeight: "500" },
  danger: { color: c.error },
}));
