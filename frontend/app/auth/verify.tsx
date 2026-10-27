import { useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, Field } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, spacing, radius, font } from "@/src/theme";

export default function Verify() {
  const s = useStyles();
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ email: string; dev?: string }>();
  const [dev, setDev] = useState(params.dev || "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (code.length !== 6) return setError("Enter the 6-digit code");
    setBusy(true);
    try {
      const r = await api("/auth/verify-email", { method: "POST", body: { email: params.email, code } });
      await signIn(r.token, r.user);
      router.replace("/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const r = await api("/auth/resend-code", { method: "POST", body: { email: params.email } });
      setDev(r.dev_code ?? "");
      toast("A new code is on its way", "success");
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  return (
    <AuthShell testID="verify-screen" title="Check your email" subtitle={`Enter the 6-digit code we sent to ${params.email}.`}>
      {dev ? (
        <Text testID="verify-dev-code" style={s.dev}>
          Email delivery isn&apos;t set up in this preview. Your code is {dev}
        </Text>
      ) : null}
      <Field
        testID="verify-code-input"
        label="Verification code"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={6}
        style={s.code}
        error={error}
        onSubmitEditing={submit}
      />
      <Button testID="verify-submit-button" title="Verify email" loading={busy} onPress={submit} />
      <Button testID="verify-resend-button" title="Resend code" variant="ghost" onPress={resend} />
    </AuthShell>
  );
}

const useStyles = makeStyles((c) => ({
  dev: {
    color: c.warning,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: font.base,
    borderWidth: 1,
    borderColor: c.warning,
  },
  code: { fontSize: 24, letterSpacing: 8, fontWeight: "700" },
}));
