import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import dayjs from "dayjs";

import { api, photoSource } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Sheet } from "@/src/components/sheet";
import { Button, Chip, EmptyState } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Brief = { id: string; name: string; email?: string; photo: string | null; status: string; is_demo?: boolean };
type Report = { id: string; reason: string; details: string; created_at: string; reported: Brief; reporter: Brief; prior_reports: number; resolution?: string };
type Appeal = { id: string; message: string; restriction: string; reason: string; created_at: string; user: Brief };
type Stats = { users: number; matches: number; open_reports: number; open_appeals: number; suspended: number; banned: number };

const ACTIONS = [
  { value: "dismiss", label: "Dismiss" },
  { value: "warn", label: "Warn" },
  { value: "suspend", label: "Suspend" },
  { value: "ban", label: "Ban" },
] as const;

export default function Admin() {
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<"reports" | "appeals">("reports");
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [appeals, setAppeals] = useState<Appeal[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState<Report | Appeal | null>(null);
  const [action, setAction] = useState<string>("warn");
  const [days, setDays] = useState("7");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, r, a] = await Promise.all([api<Stats>("/admin/stats"), api<Report[]>("/admin/reports"), api<Appeal[]>("/admin/appeals")]);
      setStats(st);
      setReports(r);
      setAppeals(a);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }, [toast]);

  useEffect(() => {
    if (user?.role === "admin") load();
  }, [load, user?.role]);

  if (user?.role !== "admin") {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <EmptyState testID="admin-denied" icon="lock-closed-outline" title="Admins only" body="You don't have access to the moderation dashboard." action={<Button testID="admin-denied-back" title="Go home" onPress={() => router.replace("/")} />} />
      </View>
    );
  }

  const isReport = (x: Report | Appeal): x is Report => "reporter" in x;

  const submit = async () => {
    if (!active) return;
    setBusy(true);
    try {
      if (isReport(active)) {
        await api(`/admin/reports/${active.id}/resolve`, { method: "POST", body: { action, note, days: parseInt(days, 10) || 7 } });
      } else {
        await api(`/admin/appeals/${active.id}/decide`, { method: "POST", body: { decision: action, note } });
      }
      toast("Decision saved and logged", "success");
      setActive(null);
      setNote("");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const open = (x: Report | Appeal) => {
    setActive(x);
    setAction(isReport(x) ? "warn" : "approve");
    setNote("");
  };

  const data: (Report | Appeal)[] = (tab === "reports" ? reports : appeals) ?? [];

  return (
    <View style={s.root} testID="admin-screen">
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <View>
          <Text style={s.title}>Moderation</Text>
          <Text style={s.sub}>Signed in as {user.email}</Text>
        </View>
        <Pressable testID="admin-logout" onPress={() => signOut().then(() => router.replace("/welcome"))} hitSlop={10} style={s.iconBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {stats ? (
        <View style={s.stats} testID="admin-stats">
          {[
            ["Members", stats.users],
            ["Matches", stats.matches],
            ["Reports", stats.open_reports],
            ["Appeals", stats.open_appeals],
            ["Suspended", stats.suspended],
            ["Banned", stats.banned],
          ].map(([l, v]) => (
            <View key={l as string} style={s.stat}>
              <Text style={s.statV}>{v}</Text>
              <Text style={s.statL}>{l}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={s.tabs}>
        <Chip testID="admin-tab-reports" label={`Reports (${reports?.length ?? 0})`} selected={tab === "reports"} onPress={() => setTab("reports")} />
        <Chip testID="admin-tab-appeals" label={`Appeals (${appeals?.length ?? 0})`} selected={tab === "appeals"} onPress={() => setTab("appeals")} />
      </View>
      <Text style={s.privacy}>Private messages are end-to-end encrypted. Moderators can&apos;t read them.</Text>

      {reports === null ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(x) => x.id}
          contentContainerStyle={[{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }, !data.length && { flex: 1 }]}
          refreshControl={<RefreshControl tintColor={colors.brandPrimary} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={<EmptyState testID="admin-empty" icon="checkmark-done-outline" title="Queue is clear" body={tab === "reports" ? "No open reports." : "No open appeals."} />}
          renderItem={({ item }) => {
            const subject = isReport(item) ? item.reported : item.user;
            return (
              <Pressable testID={`admin-item-${item.id}`} style={s.card} onPress={() => open(item)}>
                <Image source={photoSource(subject.photo)} style={s.avatar} contentFit="cover" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.name}>
                    {subject.name} {subject.is_demo ? <Text style={s.demo}>· demo</Text> : null}
                  </Text>
                  <Text style={s.reason}>{isReport(item) ? item.reason : `Appeal of ${item.restriction}: ${item.reason}`}</Text>
                  <Text style={s.sub} numberOfLines={2}>
                    {isReport(item) ? item.details || `${item.prior_reports} report(s) total · by ${item.reporter.name}` : item.message}
                  </Text>
                  <Text style={s.time}>{dayjs(item.created_at).format("MMM D, h:mm A")} · status: {subject.status}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            );
          }}
        />
      )}

      <Sheet visible={!!active} onClose={() => setActive(null)} title={active && isReport(active) ? "Resolve report" : "Decide appeal"} testID="admin-action-sheet">
        {active && !isReport(active) ? <Text style={s.body}>&ldquo;{active.message}&rdquo;</Text> : null}
        <View style={s.chips}>
          {(active && isReport(active) ? ACTIONS : ([{ value: "approve", label: "Lift restriction" }, { value: "deny", label: "Keep restriction" }] as const)).map((a) => (
            <Chip key={a.value} testID={`admin-action-${a.value}`} label={a.label} selected={action === a.value} onPress={() => setAction(a.value)} />
          ))}
        </View>
        {action === "suspend" ? (
          <TextInput testID="admin-days-input" value={days} onChangeText={(t) => setDays(t.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" placeholder="Days" placeholderTextColor={colors.muted} style={s.input} />
        ) : null}
        <TextInput
          testID="admin-note-input"
          value={note}
          onChangeText={setNote}
          placeholder={active && isReport(active) ? "Reason shown to the member (optional)" : "Note for the member (optional)"}
          placeholderTextColor={colors.muted}
          multiline
          style={[s.input, { minHeight: 72 }]}
        />
        <Button testID="admin-submit" title="Confirm" loading={busy} variant={action === "ban" ? "danger" : "primary"} onPress={submit} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: c.onSurface, fontSize: font.xxl, fontWeight: "800" },
  sub: { color: c.muted, fontSize: font.sm },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stats: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.lg, gap: spacing.sm },
  stat: { width: "31.5%", backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  statV: { color: c.brandPrimary, fontSize: font.xl, fontWeight: "800" },
  statL: { color: c.muted, fontSize: font.sm },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  privacy: { color: c.muted, fontSize: 11, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  card: { flexDirection: "row", gap: spacing.md, alignItems: "center", backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.surfaceTertiary },
  name: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  demo: { color: c.warning, fontSize: font.sm },
  reason: { color: c.brandPrimary, fontSize: font.base, fontWeight: "600" },
  time: { color: c.muted, fontSize: 11 },
  body: { color: c.onSurfaceSecondary, fontSize: font.base, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  input: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, color: c.onSurface, padding: spacing.md, fontSize: font.base, textAlignVertical: "top" },
}));
