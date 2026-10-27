import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton } from "@/src/components/ui";
import { makeStyles, spacing, font } from "@/src/theme";

/** Shared layout for auth forms: back button, title, scrollable keyboard-aware body. */
export function AuthShell({ title, subtitle, children, testID }: { title: string; subtitle?: string; children: React.ReactNode; testID: string }) {
  const s = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={s.root} testID={testID}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton testID="auth-back-button" icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))} />
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        <View style={s.form}>{children}</View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.sm },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  title: { color: c.onSurface, fontSize: 30, fontWeight: "800" },
  subtitle: { color: c.muted, fontSize: font.lg, marginTop: spacing.sm, lineHeight: 22 },
  form: { marginTop: spacing.xxl, gap: spacing.lg },
}));
