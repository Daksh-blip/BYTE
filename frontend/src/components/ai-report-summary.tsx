import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Summary = { summary: string; risk: "low" | "medium" | "high"; suggested_action: string; why: string };

/** Claude's take on a report, for the moderator. The decision always stays with the human. */
export function AiReportSummary({ reportId, onSuggest }: { reportId: string; onSuggest: (action: string) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
  }, [reportId]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await api<Summary>(`/admin/reports/${reportId}/ai-summary`, { method: "POST" }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Pressable testID="admin-ai-summary-button" onPress={run} disabled={busy} style={s.trigger}>
        {busy ? <ActivityIndicator color={colors.brandPrimary} /> : <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />}
        <Text style={s.triggerText}>{busy ? "Reviewing report…" : err ? "AI review failed. Tap to retry." : "AI review of this report"}</Text>
      </Pressable>
    );
  }
  const riskColor = { low: colors.success, medium: colors.warning, high: colors.error }[data.risk];
  return (
    <View testID="admin-ai-summary" style={s.box}>
      <View style={s.row}>
        <Ionicons name="sparkles" size={14} color={colors.brandPrimary} />
        <Text style={s.head}>AI review</Text>
        <Text testID="admin-ai-risk" style={[s.risk, { color: riskColor, borderColor: riskColor }]}>
          {data.risk} risk
        </Text>
      </View>
      <Text style={s.text}>{data.summary}</Text>
      <Text style={s.why}>{data.why}</Text>
      <Pressable testID="admin-ai-apply" onPress={() => onSuggest(data.suggested_action)} hitSlop={6}>
        <Text style={s.apply}>Suggested: {data.suggested_action}. Tap to select it.</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  trigger: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  triggerText: { color: c.brandPrimary, fontSize: font.base, fontWeight: "700" },
  box: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  head: { color: c.onSurface, fontWeight: "700", fontSize: font.base, flex: 1 },
  risk: { fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  text: { color: c.onSurface, fontSize: font.base, lineHeight: 20 },
  why: { color: c.muted, fontSize: font.sm, lineHeight: 18 },
  apply: { color: c.brandPrimary, fontSize: font.sm, fontWeight: "700" },
}));
