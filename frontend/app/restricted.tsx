import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import dayjs from "dayjs";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button, Field } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Appeal = { id: string; message: string; status: string; note: string; created_at: string };

export default function Restricted() {
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut, refreshUser } = useAuth();
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Appeal[]>("/appeals").then(setAppeals).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const banned = user?.status === "banned";
  const openAppeal = appeals.find((a) => a.status === "open");
  const last = appeals[0];

  const submit = async () => {
    setBusy(true);
    try {
      await api("/appeals", { method: "POST", body: { message: msg.trim() } });
      toast("Appeal sent. A moderator will review it.", "success");
      setMsg("");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    await refreshUser().catch(() => {});
    router.replace("/");
  };

  return (
    <View style={s.root} testID="restricted-screen">
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[s.body, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={s.icon}>
          <Ionicons name={banned ? "ban" : "pause-circle"} size={36} color={colors.brandPrimary} />
        </View>
        <Text testID="restricted-title" style={s.title}>
          {banned ? "Your account is banned" : "Your account is suspended"}
        </Text>
        {!banned && user?.suspended_until ? <Text style={s.sub}>Until {dayjs(user.suspended_until).format("MMM D, YYYY h:mm A")}</Text> : null}
        <View style={s.card}>
          <Text style={s.label}>Reason</Text>
          <Text testID="restricted-reason" style={s.reason}>
            {user?.status_reason || "Violation of community guidelines"}
          </Text>
        </View>

        {openAppeal ? (
          <View style={s.card} testID="restricted-appeal-open">
            <Text style={s.label}>Appeal under review</Text>
            <Text style={s.sub}>Sent {dayjs(openAppeal.created_at).format("MMM D")}. We&apos;ll update your account when a moderator decides.</Text>
          </View>
        ) : (
          <>
            {last && last.status === "denied" ? (
              <View style={s.card}>
                <Text style={s.label}>Previous appeal denied</Text>
                <Text style={s.sub}>{last.note || "The restriction was upheld."}</Text>
              </View>
            ) : null}
            <Field
              testID="restricted-appeal-input"
              label="Appeal this decision"
              value={msg}
              onChangeText={setMsg}
              placeholder="Explain what happened (at least 10 characters)"
              multiline
              maxLength={1000}
              style={{ minHeight: 110, textAlignVertical: "top" }}
            />
            <Button testID="restricted-appeal-submit" title="Send appeal" loading={busy} disabled={msg.trim().length < 10} onPress={submit} />
          </>
        )}
        <Button testID="restricted-recheck" title="Check status again" variant="secondary" onPress={recheck} />
        <Button testID="restricted-logout" title="Sign out" variant="ghost" onPress={() => signOut().then(() => router.replace("/welcome"))} />
        <Text style={s.foot}>You can still download your data or delete your account from these settings at any time.</Text>
        <Button testID="restricted-settings" title="Data & account" variant="ghost" onPress={() => router.push("/settings")} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  body: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  icon: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.brandPrimarySoft, alignItems: "center", justifyContent: "center" },
  title: { color: c.onSurface, fontSize: 28, fontWeight: "800" },
  sub: { color: c.muted, fontSize: font.base, lineHeight: 20 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  label: { color: c.muted, fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  reason: { color: c.onSurface, fontSize: font.lg },
  foot: { color: c.muted, fontSize: font.sm, textAlign: "center" },
}));
