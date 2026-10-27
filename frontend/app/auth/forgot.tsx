import { useState } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, Field } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, spacing, radius, font } from "@/src/theme";

export default function Forgot() {
  const s = useStyles();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [dev, setDev] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email");
    setBusy(true);
    try {
      const r = await api("/auth/forgot-password", { method: "POST", body: { email: email.trim() } });
      setDev(r.dev_code ?? "");
      setStep("reset");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    if (code.length !== 6) return setError("Enter the 6-digit code");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { email: email.trim(), code, password } });
      toast("Password updated. Sign in with your new password.", "success");
      router.replace("/auth/login");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (step === "email") {
    return (
      <AuthShell testID="forgot-screen" title="Reset password" subtitle="Enter your email and we'll send you a reset code.">
        <Field
          testID="forgot-email-input"
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          error={error}
          onSubmitEditing={sendCode}
        />
        <Button testID="forgot-send-button" title="Send reset code" loading={busy} onPress={sendCode} />
      </AuthShell>
    );
  }

  return (
    <AuthShell testID="reset-screen" title="Set a new password" subtitle={`If ${email} has an account, we sent a 6-digit code.`}>
      {dev ? (
        <Text testID="reset-dev-code" style={s.dev}>
          Email delivery isn&apos;t set up in this preview. Your code is {dev}
        </Text>
      ) : null}
      <Field
        testID="reset-code-input"
        label="Reset code"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        keyboardType="number-pad"
        maxLength={6}
      />
      <Field
        testID="reset-password-input"
        label="New password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secure
        error={error}
        onSubmitEditing={reset}
      />
      <Button testID="reset-submit-button" title="Update password" loading={busy} onPress={reset} />
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
}));
