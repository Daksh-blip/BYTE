import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { Sheet } from "@/src/components/sheet";
import { Button, Chip } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Idea = { title: string; why: string };
type Props = { visible: boolean; onClose: () => void; matchId: string; name: string; onPick: (text: string) => void };

/** Claude suggestions from both profiles (never from chat messages, which stay end-to-end encrypted). */
export function AiIdeasSheet({ visible, onClose, matchId, name, onPick }: Props) {
  const s = useStyles();
  const { colors } = useTheme();
  const [tab, setTab] = useState<"openers" | "dates">("openers");
  const [openers, setOpeners] = useState<string[] | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (which: "openers" | "dates") => {
    setBusy(true);
    setErr(null);
    try {
      if (which === "openers") setOpeners((await api<{ icebreakers: string[] }>(`/ai/icebreakers/${matchId}`, { method: "POST" })).icebreakers);
      else setIdeas((await api<{ ideas: Idea[] }>(`/ai/date-ideas/${matchId}`, { method: "POST" })).ideas);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!visible || busy) return;
    if (tab === "openers" && !openers) load("openers");
    if (tab === "dates" && !ideas) load("dates");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tab]);

  const list = tab === "openers" ? openers : ideas;

  return (
    <Sheet visible={visible} onClose={onClose} title="AI ideas" testID="ai-ideas-sheet">
      <View style={s.tabs}>
        <Chip testID="ai-tab-openers" label="Openers" selected={tab === "openers"} onPress={() => setTab("openers")} />
        <Chip testID="ai-tab-dates" label="Date ideas" selected={tab === "dates"} onPress={() => setTab("dates")} />
      </View>
      <Text style={s.note}>Made by Claude from your and {name}&apos;s profiles. Your messages are never shared.</Text>
      {busy ? (
        <View style={s.loading} testID="ai-ideas-loading">
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={s.note}>Thinking of ideas…</Text>
        </View>
      ) : err ? (
        <Text testID="ai-ideas-error" style={s.err}>
          {err}
        </Text>
      ) : tab === "openers" ? (
        openers?.map((t, i) => (
          <Pressable
            key={t}
            testID={`ai-opener-${i}`}
            style={s.card}
            onPress={() => {
              onPick(t);
              onClose();
            }}
          >
            <Text style={s.text}>{t}</Text>
            <View style={s.use}>
              <Ionicons name="create-outline" size={14} color={colors.brandPrimary} />
              <Text style={s.useText}>Use this</Text>
            </View>
          </Pressable>
        ))
      ) : (
        ideas?.map((d, i) => (
          <Pressable
            key={d.title}
            testID={`ai-date-${i}`}
            style={s.card}
            onPress={() => {
              onPick(`How about this for a first date: ${d.title}? ${d.why}`);
              onClose();
            }}
          >
            <Text style={s.title}>{d.title}</Text>
            <Text style={s.why}>{d.why}</Text>
            <View style={s.use}>
              <Ionicons name="send-outline" size={14} color={colors.brandPrimary} />
              <Text style={s.useText}>Suggest it</Text>
            </View>
          </Pressable>
        ))
      )}
      {list && !busy ? <Button testID="ai-ideas-refresh" title="New ideas" icon="refresh" variant="ghost" onPress={() => load(tab)} /> : null}
      {err && !busy ? <Button testID="ai-ideas-retry" title="Try again" variant="secondary" onPress={() => load(tab)} /> : null}
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  tabs: { flexDirection: "row", gap: spacing.sm },
  note: { color: c.muted, fontSize: font.sm, lineHeight: 18 },
  loading: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  err: { color: c.error, fontSize: font.base },
  card: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  text: { color: c.onSurface, fontSize: font.base, lineHeight: 20 },
  title: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  why: { color: c.onSurfaceSecondary, fontSize: font.base, lineHeight: 20 },
  use: { flexDirection: "row", alignItems: "center", gap: 4 },
  useText: { color: c.brandPrimary, fontSize: font.sm, fontWeight: "700" },
}));
