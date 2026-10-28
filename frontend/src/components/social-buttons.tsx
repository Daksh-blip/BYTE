import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";

import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { appleAvailable, appleSignIn, googleSignIn } from "@/src/social-auth";
import { makeStyles, spacing, radius, font } from "@/src/theme";

/** "Continue with Google" everywhere, plus the native Apple button on iPhone/iPad. */
export function SocialButtons() {
  const s = useStyles();
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState<"google" | "apple" | null>(null);
  const [apple, setApple] = useState(false);

  useEffect(() => {
    appleAvailable().then(setApple).catch(() => setApple(false));
  }, []);

  const run = async (kind: "google" | "apple") => {
    setBusy(kind);
    try {
      const r = kind === "google" ? await googleSignIn() : await appleSignIn();
      if (r) {
        await signIn(r.token, r.user);
        router.replace("/");
      }
    } catch (e: any) {
      toast(e.message ?? "Sign-in failed. Please try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={s.root} testID="social-buttons">
      {apple ? (
        <AppleAuthentication.AppleAuthenticationButton
          testID="apple-sign-in-button"
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={radius.pill}
          style={s.apple}
          onPress={() => !busy && run("apple")}
        />
      ) : null}
      <Button testID="google-sign-in-button" title="Continue with Google" icon="logo-google" variant="secondary" loading={busy === "google"} onPress={() => run("google")} />
      <View style={s.divider}>
        <View style={s.line} />
        <Text style={s.or}>or</Text>
        <View style={s.line} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { gap: spacing.md },
  apple: { height: 52, width: "100%" },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  line: { flex: 1, height: 1, backgroundColor: c.divider },
  or: { color: c.muted, fontSize: font.sm },
}));
