import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { Sheet } from "@/src/components/sheet";
import { Button } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

/** "Write with AI" for the bio field: Claude offers two versions based on the saved profile and the current draft. */
export function AiBioHelper({ draft, onPick }: { draft: string; onPick: (bio: string) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [bios, setBios] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setOpen(true);
    setBusy(true);
    setErr(null);
    try {
      setBios((await api<{ bios: string[] }>("/ai/bio", { method: "POST", body: { draft } })).bios);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable testID="edit-bio-ai-button" onPress={load} style={s.trigger} hitSlop={8}>
        <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
        <Text style={s.triggerText}>{draft.trim() ? "Improve with AI" : "Write with AI"}</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Bio ideas" testID="ai-bio-sheet">
        <Text style={s.note}>Claude uses your saved profile and draft. Pick one, then edit it so it sounds like you.</Text>
        {busy ? (
          <View style={s.loading}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        ) : err ? (
          <Text testID="ai-bio-error" style={s.err}>
            {err}
          </Text>
        ) : (
          bios?.map((b, i) => (
            <Pressable
              key={b}
              testID={`ai-bio-${i}`}
              style={s.card}
              onPress={() => {
                onPick(b);
                setOpen(false);
              }}
            >
              <Text style={s.text}>{b}</Text>
              <Text style={s.use}>Use this</Text>
            </Pressable>
          ))
        )}
        {!busy ? <Button testID="ai-bio-refresh" title={err ? "Try again" : "New ideas"} icon="refresh" variant="ghost" onPress={load} /> : null}
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  trigger: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 44 },
  triggerText: { color: c.brandPrimary, fontSize: font.base, fontWeight: "700" },
  note: { color: c.muted, fontSize: font.sm, lineHeight: 18 },
  loading: { paddingVertical: spacing.xl, alignItems: "center" },
  err: { color: c.error, fontSize: font.base },
  card: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  text: { color: c.onSurface, fontSize: font.base, lineHeight: 20 },
  use: { color: c.brandPrimary, fontSize: font.sm, fontWeight: "700" },
}));
