import { useState } from "react";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { AuthShell } from "@/src/components/auth-shell";
import { Button, Field } from "@/src/components/ui";

export default function Signup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Enter your first name");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setBusy(true);
    try {
      const r = await api("/auth/register", { method: "POST", body: { name: name.trim(), email: email.trim(), password } });
      router.push({ pathname: "/auth/verify", params: { email: r.email, dev: r.dev_code ?? "" } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell testID="signup-screen" title="Create your account" subtitle="We'll send a 6-digit code to verify your email.">
      <Field testID="signup-name-input" label="First name" value={name} onChangeText={setName} placeholder="Your first name" autoComplete="given-name" />
      <Field
        testID="signup-email-input"
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        testID="signup-password-input"
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secure
        autoComplete="new-password"
        error={error}
        onSubmitEditing={submit}
      />
      <Button testID="signup-submit-button" title="Continue" loading={busy} onPress={submit} />
      <Button testID="signup-to-login" title="I already have an account" variant="ghost" onPress={() => router.replace("/auth/login")} />
    </AuthShell>
  );
}
