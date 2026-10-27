import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { photoSource } from "@/src/api";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Row = { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; sub: string; href: "/edit-profile" | "/settings" | "/safety" | "/blocked"; testID: string };

const ROWS: Row[] = [
  { icon: "create-outline", label: "Edit profile", sub: "Photos, bio, interests & preferences", href: "/edit-profile", testID: "profile-edit-row" },
  { icon: "shield-checkmark-outline", label: "Safety center", sub: "Dating tips and how we protect you", href: "/safety", testID: "profile-safety-row" },
  { icon: "ban-outline", label: "Blocked people", sub: "Manage who you've blocked", href: "/blocked", testID: "profile-blocked-row" },
  { icon: "settings-outline", label: "Settings", sub: "Privacy, account & sign out", href: "/settings", testID: "profile-settings-row" },
];

export default function ProfileTab() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  if (!user) return null;
  const filled = [user.bio, user.job, user.city, user.interests.length >= 3, user.photos.length >= 3].filter(Boolean).length;
  const pct = Math.round(((filled + 1) / 6) * 100);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: bottomChrome + spacing.xl }} testID="profile-screen">
      <View style={s.hero}>
        <Image source={photoSource(user.photos[0]?.url)} style={s.heroImg} contentFit="cover" />
        <LinearGradient colors={[colors.scrimClear, colors.surface]} style={s.heroFade} />
        <View style={[s.heroInfo]}>
          <Text testID="profile-my-name" style={s.name}>
            {user.name}
            {user.age ? `, ${user.age}` : ""}
          </Text>
          <Text style={s.meta}>{[user.job, user.city].filter(Boolean).join("  ·  ") || user.email}</Text>
        </View>
        <View style={[s.topBar, { top: insets.top + spacing.sm }]}>
          <Pressable testID="profile-preview-button" style={s.glassBtn} onPress={() => router.push({ pathname: "/user/[userId]", params: { userId: user.id } })}>
            <Ionicons name="eye-outline" size={18} color={colors.onSurface} />
            <Text style={s.glassText}>Preview</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.body}>
        <View style={s.completion}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text style={s.compTitle}>Profile strength {pct}%</Text>
            <View style={s.track}>
              <View style={[s.fill, { width: `${pct}%` }]} />
            </View>
            <Text style={s.compSub}>{pct < 100 ? "Add more photos and details to get better matches." : "Looking great! Your profile is complete."}</Text>
          </View>
        </View>

        {user.paused ? (
          <View style={s.paused} testID="profile-paused-banner">
            <Ionicons name="pause-circle" size={20} color={colors.warning} />
            <Text style={s.pausedText}>Your profile is paused and hidden from Discover.</Text>
          </View>
        ) : null}

        <View style={s.group}>
          {ROWS.map((r, i) => (
            <Pressable
              key={r.href}
              testID={r.testID}
              onPress={() => router.push(r.href)}
              style={({ pressed }) => [s.row, i < ROWS.length - 1 && s.rowBorder, pressed && { opacity: 0.7 }]}
            >
              <View style={s.rowIcon}>
                <Ionicons name={r.icon} size={20} color={colors.brandTertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>{r.label}</Text>
                <Text style={s.rowSub}>{r.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { height: 380 },
  heroImg: { width: "100%", height: "100%" },
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 220 },
  heroInfo: { position: "absolute", left: spacing.xl, right: spacing.xl, bottom: spacing.lg, gap: 4 },
  name: { color: c.onSurface, fontSize: 32, fontWeight: "800" },
  meta: { color: c.onSurfaceTertiary, fontSize: font.base },
  topBar: { position: "absolute", right: spacing.lg },
  glassBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: c.glass, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 44, borderWidth: 1, borderColor: c.border },
  glassText: { color: c.onSurface, fontWeight: "600", fontSize: font.base },
  body: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  completion: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, flexDirection: "row" },
  compTitle: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  track: { height: 6, backgroundColor: c.surfaceTertiary, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, backgroundColor: c.brandPrimary, borderRadius: 3 },
  compSub: { color: c.muted, fontSize: font.sm },
  paused: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.warning },
  pausedText: { color: c.onSurface, flex: 1, fontSize: font.base },
  group: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: c.divider },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandTertiarySoft, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: c.onSurface, fontSize: font.lg, fontWeight: "600" },
  rowSub: { color: c.muted, fontSize: font.sm, marginTop: 2 },
}));
