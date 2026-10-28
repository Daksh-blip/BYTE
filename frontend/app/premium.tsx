import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import type { PurchasesPackage } from "react-native-purchases";

import { goBack } from "@/src/go-back";
import { isSimulatedStore, useSubscription } from "@/src/revenuecat";
import { ScreenHeader } from "@/src/components/screen-header";
import { Sheet } from "@/src/components/sheet";
import { Button } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

const PERKS: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; body: string }[] = [
  { icon: "heart", title: "See who likes you", body: "Browse everyone who liked you and match instantly." },
  { icon: "infinite", title: "Unlimited likes", body: "Free members get 25 likes a day." },
  { icon: "star", title: "5 super-likes a day", body: "Free members get 1 a day." },
  { icon: "options", title: "More discovery filters", body: "Same Goals and Has Prompts views." },
];

const FREE_NOTE = "Matching, encrypted chat, blocking, reporting and safety tools are always free.";

function periodLabel(pkg: PurchasesPackage) {
  switch (pkg.packageType) {
    case "MONTHLY":
      return "1 month";
    case "THREE_MONTH":
      return "3 months";
    case "ANNUAL":
      return "12 months";
    default:
      return pkg.product.title || pkg.identifier;
  }
}

export default function Premium() {
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { offerings, isSubscribed, identityReady, identityError, isLoading, purchase, restore, isPurchasing, isRestoring, customerInfo } =
    useSubscription();
  const ORDER: Record<string, number> = { MONTHLY: 0, THREE_MONTH: 1, SIX_MONTH: 2, ANNUAL: 3 };
  const packages = [...(offerings?.current?.availablePackages ?? [])].sort((a, b) => (ORDER[a.packageType] ?? 9) - (ORDER[b.packageType] ?? 9));
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const pkg = packages.find((p) => p.identifier === selected) ?? packages[0];

  const buy = async () => {
    if (!pkg) return;
    setConfirm(false);
    try {
      await purchase(pkg);
      toast("Welcome to Premium!", "success");
    } catch (e: any) {
      if (e?.userCancelled) return;
      toast(e?.message === "identity_not_ready" ? "Your account isn't linked to purchases yet. Try again in a moment." : e?.message ?? "Purchase failed", "error");
    }
  };

  const doRestore = async () => {
    try {
      const info = await restore();
      toast(info.entitlements.active.pro ? "Premium restored" : "No previous purchases found", info.entitlements.active.pro ? "success" : "info");
    } catch (e: any) {
      toast(e?.message ?? "Restore failed", "error");
    }
  };

  const expires = customerInfo?.entitlements.active.pro?.expirationDate;

  return (
    <View style={s.root} testID="premium-screen">
      <ScreenHeader title="BYTE TALKS Premium" />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        {isSimulatedStore ? (
          <View style={s.sim} testID="premium-simulated-banner">
            <Ionicons name="flask-outline" size={16} color={colors.warning} />
            <Text style={s.simText}>Preview mode: purchases here are simulated test purchases. No real money is charged.</Text>
          </View>
        ) : null}

        {isSubscribed ? (
          <View style={s.active} testID="premium-active">
            <Ionicons name="checkmark-circle" size={28} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={s.activeTitle}>You&apos;re Premium</Text>
              <Text style={s.sub}>{expires ? `Renews or expires ${new Date(expires).toLocaleDateString()}` : "Active"}. Manage or cancel anytime in your App Store or Google Play subscriptions.</Text>
            </View>
          </View>
        ) : null}

        {PERKS.map((p) => (
          <View key={p.title} style={s.perk}>
            <View style={s.perkIcon}>
              <Ionicons name={p.icon} size={18} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.perkTitle}>{p.title}</Text>
              <Text style={s.sub}>{p.body}</Text>
            </View>
          </View>
        ))}
        <Text style={s.free}>{FREE_NOTE} Premium doesn&apos;t guarantee matches.</Text>

        {!isSubscribed ? (
          isLoading ? (
            <ActivityIndicator color={colors.brandPrimary} testID="premium-loading" />
          ) : packages.length === 0 ? (
            <Text testID="premium-unavailable" style={s.sub}>
              Subscription options are unavailable right now. Please try again later.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {packages.map((p) => {
                const on = pkg?.identifier === p.identifier;
                return (
                  <Pressable key={p.identifier} testID={`premium-package-${p.packageType.toLowerCase()}`} onPress={() => setSelected(p.identifier)} style={[s.pkg, on && s.pkgOn]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.pkgTitle}>{periodLabel(p)}</Text>
                      {p.packageType !== "MONTHLY" && p.product.pricePerMonthString ? <Text style={s.sub}>{p.product.pricePerMonthString}/month</Text> : null}
                    </View>
                    <Text style={[s.price, on && { color: colors.brandPrimary }]}>{p.product.priceString}</Text>
                  </Pressable>
                );
              })}
              {identityError || !identityReady ? (
                <Text testID="premium-identity-error" style={s.err}>
                  {identityError ? `Couldn't link purchases to your account: ${identityError}` : "Linking purchases to your account…"}
                </Text>
              ) : null}
              <Button testID="premium-subscribe-button" title="Continue" loading={isPurchasing} disabled={!identityReady || !pkg} onPress={() => setConfirm(true)} />
              <Text style={s.legal}>Auto-renews until cancelled. Cancel anytime in your store account settings at least 24 hours before renewal.</Text>
            </View>
          )
        ) : null}

        <Button testID="premium-restore-button" title="Restore purchases" variant="ghost" loading={isRestoring} onPress={doRestore} />
        {isSubscribed ? <Button testID="premium-done-button" title="Done" variant="secondary" onPress={() => goBack("/profile")} /> : null}
      </ScrollView>

      <Sheet visible={confirm} onClose={() => setConfirm(false)} title="Confirm subscription" testID="premium-confirm-sheet">
        <Text style={s.sub}>
          {pkg ? `${periodLabel(pkg)} of Premium for ${pkg.product.priceString}.` : ""} {isSimulatedStore ? "This is a simulated test purchase." : ""}
        </Text>
        <Button testID="premium-confirm-button" title="Subscribe" onPress={buy} />
        <Button testID="premium-confirm-cancel" title="Cancel" variant="ghost" onPress={() => setConfirm(false)} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  body: { padding: spacing.lg, gap: spacing.md },
  sim: { flexDirection: "row", gap: spacing.sm, alignItems: "center", borderWidth: 1, borderColor: c.warning, borderRadius: radius.md, padding: spacing.md },
  simText: { color: c.warning, fontSize: font.sm, flex: 1 },
  active: { flexDirection: "row", gap: spacing.md, alignItems: "center", backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: c.success },
  activeTitle: { color: c.onSurface, fontSize: font.xl, fontWeight: "800" },
  perk: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  perkIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandPrimarySoft, alignItems: "center", justifyContent: "center" },
  perkTitle: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  sub: { color: c.muted, fontSize: font.sm, lineHeight: 18 },
  free: { color: c.onSurfaceTertiary, fontSize: font.sm, lineHeight: 18, marginVertical: spacing.sm },
  pkg: { flexDirection: "row", alignItems: "center", minHeight: 64, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, paddingHorizontal: spacing.lg },
  pkgOn: { borderColor: c.brandPrimary, backgroundColor: c.brandPrimarySoft },
  pkgTitle: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  price: { color: c.onSurface, fontSize: font.lg, fontWeight: "800" },
  err: { color: c.error, fontSize: font.sm },
  legal: { color: c.muted, fontSize: 11, textAlign: "center" },
}));
