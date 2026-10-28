import { Linking, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "@/src/components/screen-header";
import { COPYRIGHT, LEGAL_UPDATED, SUPPORT_EMAIL } from "@/src/legal";
import { makeStyles, spacing, font } from "@/src/theme";

export type Section = { title: string; body: string[] };

/** A readable legal document: title, sections of paragraphs, contact and copyright. */
export function LegalPage({ title, intro, sections, testID }: { title: string; intro: string; sections: Section[]; testID: string }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={s.root} testID={testID}>
      <ScreenHeader title={title} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <Text style={s.updated}>Last updated {LEGAL_UPDATED}</Text>
        <Text style={s.p}>{intro}</Text>
        {sections.map((sec) => (
          <View key={sec.title} style={s.section}>
            <Text style={s.h}>{sec.title}</Text>
            {sec.body.map((p) => (
              <Text key={p.slice(0, 40)} style={s.p}>
                {p}
              </Text>
            ))}
          </View>
        ))}
        <View style={s.section}>
          <Text style={s.h}>Contact</Text>
          <Text style={s.p}>
            Questions or requests:{" "}
            <Text testID={`${testID}-email`} style={s.link} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
              {SUPPORT_EMAIL}
            </Text>
          </Text>
        </View>
        <Text testID={`${testID}-copyright`} style={s.copy}>
          {COPYRIGHT}. All rights reserved.
        </Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingTop: spacing.md },
  updated: { color: c.muted, fontSize: font.sm },
  section: { gap: spacing.sm },
  h: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  p: { color: c.onSurfaceSecondary, fontSize: font.base, lineHeight: 22 },
  link: { color: c.brandPrimary, fontWeight: "700" },
  copy: { color: c.muted, fontSize: font.sm, textAlign: "center", marginTop: spacing.lg },
}));
