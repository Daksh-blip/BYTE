import { useState } from "react";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, Field } from "@/src/components/ui";

export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
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
