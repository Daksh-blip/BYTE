import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { ScreenHeader } from "@/src/components/screen-header";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

const TIPS: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; body: string }[] = [
  { icon: "lock-closed", title: "Your chats are end-to-end encrypted", body: "Messages are locked on your phone and unlocked only on your match's phone. We can't read them." },
  { icon: "cash-outline", title: "Never send money", body: "Anyone asking for money, gift cards or crypto — however good the story — is very likely a scammer. Report them." },
  { icon: "people-outline", title: "Meet in public", body: "For first dates, choose a busy public place and tell a friend where you'll be and when." },
  { icon: "car-outline", title: "Arrange your own transport", body: "Keep control of how you get to and from your date so you can leave whenever you want." },
  { icon: "eye-off-outline", title: "Protect personal info", body: "Don't share your home address, workplace details or financial info until you truly trust someone." },
  { icon: "flag-outline", title: "Report & block anytime", body: "Tap ··· on any profile or chat to report or block. Reports are confidential." },
];

export default function Safety() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={s.root} testID="safety-screen">
      <ScreenHeader title="Safety center" />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={s.intro}>Your safety comes first. Here&apos;s how to date confidently on BYTE TALKS.</Text>
        {TIPS.map((t) => (
          <View key={t.title} style={s.card}>
            <View style={s.icon}>
              <Ionicons name={t.icon} size={20} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.title}>{t.title}</Text>
              <Text style={s.text}>{t.body}</Text>
            </View>
          </View>
        ))}
        <Text style={s.footer}>In immediate danger? Contact your local emergency services right away.</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  body: { padding: spacing.lg, gap: spacing.md },
  intro: { color: c.onSurfaceSecondary, fontSize: font.lg, lineHeight: 24, marginBottom: spacing.sm },
  card: { flexDirection: "row", gap: spacing.md, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandPrimarySoft, alignItems: "center", justifyContent: "center" },
  title: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  text: { color: c.muted, fontSize: font.base, lineHeight: 20 },
  footer: { color: c.warning, fontSize: font.sm, textAlign: "center", marginTop: spacing.md },
}));
