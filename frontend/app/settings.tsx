import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import dayjs from "dayjs";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, Me } from "@/src/api";
import { useAuth } from "@/src/auth";
import { myDevice, unavailableText, useSignalStatus } from "@/src/signal";

type DeviceT = { id: string; platform: string; active: boolean; created_at: string; revoked_at: string | null; revoked_reason: string | null; current: boolean };
import { ScreenHeader } from "@/src/components/screen-header";
import { Sheet } from "@/src/components/sheet";
import { Button, Field } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

export default function Settings() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user, setUser, signOut, signIn } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const signalStatus = useSignalStatus();
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceT[] | null>(null);

  const openDevices = async () => {
    setDevicesOpen(true);
    setDevices(null);
    try {
      setDevices(await api<DeviceT[]>("/signal/devices"));
    } catch (e: any) {
      setDevices([]);
      toast(e.message, "error");
    }
  };

  const revoke = async (id: string) => {
    try {
      await api(`/signal/devices/${id}`, { method: "DELETE" });
      toast("Device removed and signed out", "success");
      setDevices(await api<DeviceT[]>("/signal/devices"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const changePassword = async () => {
    setPwError(null);
    if (!curPw) return setPwError("Enter your current password");
    if (newPw.length < 8) return setPwError("New password must be at least 8 characters");
    setPwBusy(true);
    try {
      const r = await api("/me/password", { method: "POST", body: { current_password: curPw, new_password: newPw } });
      if (user) await signIn(r.token, user);
      setPwOpen(false);
      setCurPw("");
      setNewPw("");
      toast("Password changed", "success");
    } catch (e: any) {
      setPwError(e.message);
    } finally {
      setPwBusy(false);
    }
  };

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
        <View style={s.group}>
          <View style={s.row}>
            <Ionicons name="shield-checkmark" size={20} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Signal Protocol</Text>
              <Text testID="settings-signal-status" style={s.sub}>
                {signalStatus === "ready" ? "Active on this device. Keys never leave it." : unavailableText(signalStatus)}
              </Text>
            </View>
          </View>
          <Pressable testID="settings-devices-row" style={[s.row, s.top]} onPress={openDevices}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Secure chat devices</Text>
              <Text style={s.sub}>See and remove devices that can read new messages.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </View>

        <Text style={s.section}>Account</Text>
        <View style={s.group}>
          <View style={s.row}>
            <Text style={[s.label, { flex: 1 }]}>Email</Text>
            <Text testID="settings-email" style={s.sub}>
              {user?.email}
            </Text>
          </View>
          <Pressable testID="settings-password-row" style={[s.row, s.top]} onPress={() => setPwOpen(true)}>
            <Text style={[s.label, { flex: 1 }]}>Change password</Text>
            <Ionicons name="key-outline" size={20} color={colors.muted} />
          </Pressable>
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

        <View testID="settings-about" style={s.about}>
          <Text style={s.aboutBrand}>BYTE TALKS</Text>
          <Text style={s.sub}>Created by Daksh Mishra, Founder</Text>
        </View>
      </ScrollView>

      <Sheet visible={pwOpen} onClose={() => setPwOpen(false)} title="Change password" testID="change-password-sheet">
        <Field
          testID="change-password-current"
          label="Current password"
          value={curPw}
          onChangeText={setCurPw}
          secure
          autoComplete="current-password"
          error={pwError && /current/i.test(pwError) && !/different/i.test(pwError) ? pwError : null}
        />
        <Field
          testID="change-password-new"
          label="New password"
          value={newPw}
          onChangeText={setNewPw}
          secure
          autoComplete="new-password"
          placeholder="At least 8 characters"
          error={pwError && !(/current/i.test(pwError) && !/different/i.test(pwError)) ? pwError : null}
        />
        <Text style={s.sub}>You&apos;ll stay signed in here. Other devices will be signed out.</Text>
        <Button testID="change-password-submit" title="Update password" loading={pwBusy} onPress={changePassword} />
      </Sheet>

      <Sheet visible={devicesOpen} onClose={() => setDevicesOpen(false)} title="Secure chat devices" testID="devices-sheet">
        <Text style={s.sub}>
          One device at a time holds your Signal keys. Setting up a new one replaces the old one, and your matches see a security-key change. Messages already
          on a removed device stay there.
        </Text>
        {devices === null ? <ActivityIndicator color={colors.brandPrimary} /> : null}
        {devices?.length === 0 ? <Text style={s.sub}>No secure devices yet.</Text> : null}
        {devices?.slice(0, 6).map((d) => (
          <View key={d.id} testID={`device-${d.id}`} style={[s.group, s.row]}>
            <Ionicons name={d.platform === "web" ? "desktop-outline" : "phone-portrait-outline"} size={20} color={d.active ? colors.brandPrimary : colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={s.label}>
                {d.platform || "Device"} {d.current || d.id === myDevice() ? "· This device" : ""}
              </Text>
              <Text style={s.sub}>
                {d.active ? `Active since ${dayjs(d.created_at).format("MMM D, YYYY")}` : `${d.revoked_reason === "revoked" ? "Removed" : "Replaced"} ${dayjs(d.revoked_at).format("MMM D")}`}
              </Text>
            </View>
            {d.active && !d.current && signalStatus === "ready" && d.id !== myDevice() ? (
              <Pressable testID={`device-revoke-${d.id}`} onPress={() => revoke(d.id)} hitSlop={8}>
                <Text style={s.revoke}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <Button testID="devices-close" title="Done" variant="ghost" onPress={() => setDevicesOpen(false)} />
      </Sheet>

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
  about: { alignItems: "center", gap: 4, marginTop: spacing.lg },
  revoke: { color: c.error, fontWeight: "700", fontSize: font.base },
  aboutBrand: { color: c.brandPrimary, fontSize: font.base, fontWeight: "800", letterSpacing: 3 },
}));
