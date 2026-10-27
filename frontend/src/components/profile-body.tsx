import React from "react";
import { Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Profile } from "@/src/api";
import { intentionLabel } from "@/src/constants";
import { Chip } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

/** Bio, details, prompts, interests and compatibility for a profile. */
export function ProfileBody({ p }: { p: Profile }) {
  const s = useStyles();
  const { colors } = useTheme();
  const intention = intentionLabel(p.intention);
  const shared = new Set(p.compatibility?.shared_interests ?? []);
  return (
    <View style={s.wrap}>
      {p.is_demo ? (
        <View style={s.demo} testID="profile-demo-badge">
          <Ionicons name="flask-outline" size={16} color={colors.warning} />
          <Text style={s.demoText}>Demo profile for previewing the app — not a real member.</Text>
        </View>
      ) : null}
      <View style={s.nameRow}>
        <Text testID="profile-name" style={s.name}>
          {p.name}
          {p.age ? `, ${p.age}` : ""}
        </Text>
        {p.photo_verified ? <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} /> : null}
        {p.pronouns ? <Text style={s.pronouns}>{p.pronouns}</Text> : null}
      </View>
      <View style={s.metaRow}>
        {p.job ? <Meta icon="briefcase-outline" text={p.job} /> : null}
        {p.city ? <Meta icon="location-outline" text={p.city} /> : null}
        {intention ? <Meta icon="heart-outline" text={intention} /> : null}
        {p.languages?.length ? <Meta icon="language-outline" text={p.languages.join(", ")} /> : null}
      </View>

      {p.compatibility && p.compatibility.reasons.length ? (
        <View style={[s.card, s.compatCard]} testID="profile-compatibility">
          <View style={s.compatHead}>
            <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
            <Text style={s.compatTitle}>Why you might click</Text>
          </View>
          {p.compatibility.reasons.map((r) => (
            <Text key={r} style={s.reason}>
              • {r}
            </Text>
          ))}
          <Text style={s.disclaimer}>Based only on what you both chose to share. It&apos;s a conversation starter, not a prediction.</Text>
        </View>
      ) : null}

      {p.bio ? (
        <View style={s.card}>
          <Text style={s.cardLabel}>About</Text>
          <Text style={s.bio}>{p.bio}</Text>
        </View>
      ) : null}
      {p.prompts?.map((pr) => (
        <View key={pr.question} style={s.card} testID="profile-prompt">
          <Text style={s.cardLabel}>{pr.question}</Text>
          <Text style={s.answer}>{pr.answer}</Text>
        </View>
      ))}
      {p.interests.length ? (
        <View style={s.card}>
          <Text style={s.cardLabel}>Interests</Text>
          <View style={s.chips}>
            {p.interests.map((i) => (
              <Chip key={i} label={i} selected={shared.has(i)} testID={`profile-interest-${i}`} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Meta({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.meta}>
      <Ionicons name={icon} size={16} color={colors.muted} />
      <Text style={s.metaText}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: spacing.lg },
  demo: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: c.warning, borderRadius: radius.md, padding: spacing.md },
  demoText: { color: c.warning, fontSize: font.sm, flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  name: { color: c.onSurface, fontSize: 28, fontWeight: "800" },
  pronouns: { color: c.muted, fontSize: font.base },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaText: { color: c.onSurfaceTertiary, fontSize: font.base },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  compatCard: { borderWidth: 1, borderColor: c.brandPrimarySoft },
  compatHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  compatTitle: { color: c.brandPrimary, fontSize: font.lg, fontWeight: "700" },
  reason: { color: c.onSurfaceSecondary, fontSize: font.base, lineHeight: 20 },
  disclaimer: { color: c.muted, fontSize: 11, marginTop: spacing.xs },
  cardLabel: { color: c.muted, fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  bio: { color: c.onSurfaceSecondary, fontSize: font.lg, lineHeight: 24 },
  answer: { color: c.onSurface, fontSize: font.xl, fontWeight: "600", lineHeight: 28 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
}));
