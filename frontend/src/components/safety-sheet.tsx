import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { api } from "@/src/api";
import { REPORT_REASONS } from "@/src/constants";
import { Sheet, SheetRow } from "@/src/components/sheet";
import { Button, Chip } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Mode = "menu" | "report" | "block";

/** Report / block / unmatch actions for another member. */
export function SafetySheet({
  visible,
  onClose,
  userId,
  name,
  matchId,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  matchId?: string;
  onDone: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("menu");
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setMode("menu");
    setReason(null);
    setDetails("");
    onClose();
  };

  const run = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg, "success");
      close();
      onDone();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={close} testID="safety-sheet" title={mode === "report" ? `Report ${name}` : mode === "block" ? `Block ${name}?` : name}>
      {mode === "menu" ? (
        <View>
          {matchId ? (
            <SheetRow
              testID="safety-unmatch"
              label="Unmatch"
              onPress={() => run(async () => void (await api(`/matches/${matchId}`, { method: "DELETE" })), `You unmatched ${name}`)}
            />
          ) : null}
          <SheetRow testID="safety-report" label="Report" danger onPress={() => setMode("report")} />
          <SheetRow testID="safety-block" label="Block" danger onPress={() => setMode("block")} />
          <SheetRow testID="safety-cancel" label="Cancel" onPress={close} />
        </View>
      ) : null}

      {mode === "report" ? (
        <View style={s.gap}>
          <Text style={s.body}>Reports are confidential. {name} won&apos;t know who reported them.</Text>
          <View style={s.reasons}>
            {REPORT_REASONS.map((r, i) => (
              <Chip key={r} testID={`report-reason-${i}`} label={r} selected={reason === r} onPress={() => setReason(r)} />
            ))}
          </View>
          <TextInput
            testID="report-details-input"
            value={details}
            onChangeText={setDetails}
            placeholder="Anything else we should know? (optional)"
            placeholderTextColor={colors.muted}
            multiline
            style={s.input}
          />
          <Button
            testID="report-submit-button"
            title="Submit report & block"
            variant="danger"
            disabled={!reason}
            loading={busy}
            onPress={() =>
              run(async () => {
                await api("/reports", { method: "POST", body: { user_id: userId, reason, details } });
                await api("/blocks", { method: "POST", body: { user_id: userId } });
              }, "Thanks. We'll review this report.")
            }
          />
        </View>
      ) : null}

      {mode === "block" ? (
        <View style={s.gap}>
          <Text style={s.body}>
            {name} won&apos;t be able to see your profile or message you. You&apos;ll be unmatched. You can unblock them later in Settings.
          </Text>
          <Button
            testID="block-confirm-button"
            title="Block"
            variant="danger"
            loading={busy}
            onPress={() => run(async () => void (await api("/blocks", { method: "POST", body: { user_id: userId } })), `${name} is blocked`)}
          />
          <Button testID="block-cancel-button" title="Cancel" variant="ghost" onPress={() => setMode("menu")} />
        </View>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  gap: { gap: spacing.lg },
  body: { color: c.muted, fontSize: font.base, lineHeight: 20 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  input: {
    minHeight: 80,
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.md,
    color: c.onSurface,
    padding: spacing.md,
    fontSize: font.base,
    textAlignVertical: "top",
  },
}));
