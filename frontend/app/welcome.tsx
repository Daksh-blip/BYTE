import { Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { SocialButtons } from "@/src/components/social-buttons";
import { COPYRIGHT } from "@/src/legal";
import { Button } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, font, radius } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=1000&q=80&auto=format&fit=crop";

export default function Welcome() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={s.root} testID="welcome-screen">
      <Image source={{ uri: HERO }} style={s.hero} contentFit="cover" />
      <LinearGradient colors={[colors.scrimClear, colors.surface]} locations={[0.2, 0.75]} style={s.fade} />
      <View style={[s.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Animated.View entering={FadeInDown.duration(500)} style={s.brandRow}>
          <View style={s.logo}>
            <Ionicons name="chatbubbles" size={22} color={colors.onBrandPrimary} />
          </View>
          <Text style={s.brand}>BYTE TALKS</Text>
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(100).duration(500)} style={s.title}>
          Meet by personality.{"\n"}
          <Text style={{ color: colors.brandPrimary }}>Connect privately.</Text>
        </Animated.Text>
        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={s.points}>
          {[
            ["lock-closed", "End-to-end encrypted chats"],
            ["shield-checkmark", "Report, block & safety tools"],
            ["sparkles", "Real people, real interests"],
          ].map(([icon, label]) => (
            <View key={label} style={s.point}>
              <Ionicons name={icon as any} size={18} color={colors.brandPrimary} />
              <Text style={s.pointText}>{label}</Text>
            </View>
          ))}
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(300).duration(500)} style={s.actions}>
          <SocialButtons />
          <Button testID="welcome-create-account" title="Create account with email" onPress={() => router.push("/auth/signup")} />
          <Button testID="welcome-sign-in" title="I already have an account" variant="secondary" onPress={() => router.push("/auth/login")} />
          <Text style={s.legal}>
            By continuing you confirm you are 18+ and agree to our{" "}
            <Text testID="welcome-terms-link" style={s.legalLink} onPress={() => router.push("/legal/terms")}>
              Terms
            </Text>{" "}
            and{" "}
            <Text testID="welcome-privacy-link" style={s.legalLink} onPress={() => router.push("/legal/privacy")}>
              Privacy Policy
            </Text>
            .
          </Text>
          <Text testID="welcome-founder" style={s.founder}>
            Created by Daksh Mishra · Founder · {COPYRIGHT}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { position: "absolute", top: 0, left: 0, right: 0, height: "65%" },
  fade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  content: { flex: 1, justifyContent: "flex-end", paddingHorizontal: spacing.xl, gap: spacing.xl },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  brand: { color: c.onSurface, fontSize: font.lg, fontWeight: "800", letterSpacing: 3 },
  title: { color: c.onSurface, fontSize: 34, fontWeight: "800", lineHeight: 40 },
  points: { gap: spacing.sm },
  point: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pointText: { color: c.onSurfaceSecondary, fontSize: font.base, fontWeight: "500" },
  actions: { gap: spacing.md },
  legal: { color: c.muted, fontSize: font.sm, textAlign: "center", lineHeight: 18 },
  legalLink: { color: c.brandPrimary, fontWeight: "700", textDecorationLine: "underline" },
  founder: { color: c.onSurfaceSecondary, fontSize: font.sm, textAlign: "center", fontWeight: "600", letterSpacing: 0.5 },
}));
