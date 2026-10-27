import { goBack } from "@/src/go-back";
import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton } from "@/src/components/ui";
import { makeStyles, spacing, font } from "@/src/theme";

/** Sticky header for pushed (non-tab) screens. */
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const s = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.header, { paddingTop: insets.top + spacing.xs }]}>
      <IconButton testID="screen-back-button" icon="chevron-back" onPress={() => goBack("/profile")} />
      <Text style={s.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={s.right}>{right}</View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs, paddingBottom: spacing.sm, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  title: { flex: 1, color: c.onSurface, fontSize: font.xl, fontWeight: "700", textAlign: "center" },
  right: { minWidth: 44, alignItems: "flex-end" },
}));
