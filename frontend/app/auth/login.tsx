import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { takeLoginNotice } from "@/src/auth-notice";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, Field } from "@/src/components/ui";
import { makeStyles, spacing, radius, font } from "@/src/theme";

export default function Login() {
  const s = useStyles();
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  // Runs every time the screen gains focus (including when returning from the reset flow to an already-mounted login).
  useFocusEffect(
    useCallback(() => {
      const n = takeLoginNotice();
      if (!n) return;
      if (n.email) setEmail(n.email);
      setPassword("");
      setError(null);
      setNotice({ message: n.message, tone: n.tone });
    }, []),
  );

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) return setError("Enter your email and password");
    setBusy(true);
    try {
      const r = await api("/auth/login", { method: "POST", body: { email: email.trim(), password } });
      await signIn(r.token, r.user);
      router.replace("/");
    } catch (e: any) {
      if (e.message === "EMAIL_NOT_VERIFIED") {
        const r = await api("/auth/resend-code", { method: "POST", body: { email: email.trim() } }).catch(() => ({}));
        router.push({ pathname: "/auth/verify", params: { email: email.trim().toLowerCase(), dev: (r as any).dev_code ?? "" } });
      } else setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell testID="login-screen" title="Welcome back" subtitle="Sign in to keep the conversation going.">
      {notice ? (
        <Text testID="login-notice" style={[s.notice, notice.tone === "error" ? s.noticeError : s.noticeOk]}>
          {notice.message}
        </Text>
      ) : null}
      <Field
        testID="login-email-input"
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        testID="login-password-input"
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secure
        autoComplete="current-password"
        error={error}
        onSubmitEditing={submit}
      />
      <Button testID="login-submit-button" title="Sign in" loading={busy} onPress={submit} />
      <Button testID="login-forgot-password" title="Forgot password?" variant="ghost" onPress={() => router.push("/auth/forgot")} />
    </AuthShell>
  );
}

const useStyles = makeStyles((c) => ({
  notice: { borderRadius: radius.md, padding: spacing.md, fontSize: font.base, borderWidth: 1, backgroundColor: c.surfaceSecondary },
  noticeOk: { color: c.success, borderColor: c.success },
  noticeError: { color: c.error, borderColor: c.error },
}));
