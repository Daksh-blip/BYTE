import { useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, Me } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ScreenHeader } from "@/src/components/screen-header";
import { Sheet } from "@/src/components/sheet";
import { Button } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

export default function Settings() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user, setUser, signOut } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const togglePause = async (v: boolean) => {
    try {
      setUser(await api<Me>("/me", { method: "PUT", body: { paused: v } }));
      toast(v ? "Profile paused. You're hidden from Discover." : "Welcome back! You're visible again.", "success");
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const exportData = async () => {
    try {
      const data = await api("/me/export");
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === "web") {
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "bytetalks-data.json";
        a.click();
      } else {
        const file = new File(Paths.cache, "bytetalks-data.json");
        if (file.exists) file.delete();
        file.create();
        file.write(json);
        await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "My BYTE TALKS data" });
      }
      toast("Your data export is ready", "success");
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const logout = async () => {
    await signOut();
    router.replace("/welcome");
  };

  const del = async () => {
    setBusy(true);
    try {
      await api("/me", { method: "DELETE" });
      setConfirmDelete(false);
      await signOut();
      router.replace("/welcome");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root} testID="settings-screen">
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={s.section}>Privacy</Text>
        <View style={s.group}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Pause my profile</Text>
              <Text style={s.sub}>Hide from Discover. Your matches and chats stay.</Text>
            </View>
            <Switch
              testID="settings-pause-switch"
              value={!!user?.paused}
              onValueChange={togglePause}
              trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }}
              thumbColor={colors.onSurface}
            />
          </View>
          <Pressable testID="settings-blocked-row" style={[s.row, s.top]} onPress={() => router.push("/blocked")}>
            <Text style={[s.label, { flex: 1 }]}>Blocked people</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
          <Pressable testID="settings-safety-row" style={[s.row, s.top]} onPress={() => router.push("/safety")}>
            <Text style={[s.label, { flex: 1 }]}>Safety center</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </View>

        <Text style={s.section}>Encryption</Text>
        <View style={[s.group, s.row]}>
          <Ionicons name="lock-closed" size={20} color={colors.brandPrimary} />
          <Text style={[s.sub, { flex: 1 }]}>
            Your chat keys are stored only on this device. Messages sent to a different device or before reinstalling can&apos;t be read here.
          </Text>
        </View>

        <Text style={s.section}>Account</Text>
        <View style={s.group}>
          <View style={s.row}>
            <Text style={[s.label, { flex: 1 }]}>Email</Text>
            <Text testID="settings-email" style={s.sub}>
              {user?.email}
            </Text>
          </View>
          <Pressable testID="settings-export-row" style={[s.row, s.top]} onPress={exportData}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Download my data</Text>
              <Text style={s.sub}>Profile, likes, matches and reports. Messages are included only as unreadable ciphertext.</Text>
            </View>
            <Ionicons name="download-outline" size={20} color={colors.muted} />
          </Pressable>
        </View>

        <Button testID="settings-logout-button" title="Sign out" variant="secondary" icon="log-out-outline" onPress={logout} style={{ marginTop: spacing.lg }} />
        <Button testID="settings-delete-button" title="Delete account" variant="ghost" onPress={() => setConfirmDelete(true)} />
      </ScrollView>

      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your account?" testID="delete-account-sheet">
        <Text style={s.sub}>This permanently deletes your profile, photos, matches and messages. This can&apos;t be undone.</Text>
        <Button testID="delete-account-confirm" title="Delete permanently" variant="danger" loading={busy} onPress={del} />
        <Button testID="delete-account-cancel" title="Cancel" variant="ghost" onPress={() => setConfirmDelete(false)} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  body: { padding: spacing.lg, gap: spacing.md },
  section: { color: c.muted, fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.md },
  group: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, minHeight: 56 },
  top: { borderTopWidth: 1, borderTopColor: c.divider },
  label: { color: c.onSurface, fontSize: font.lg, fontWeight: "500" },
  sub: { color: c.muted, fontSize: font.sm, lineHeight: 18 },
}));
