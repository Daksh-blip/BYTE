import "react-native-get-random-values"; // must load before the Signal SDK makes its first call
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { LogBox, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { ToastProvider } from "@/src/components/toast";
import { AuthProvider, useAuth } from "@/src/auth";
import { hasLoginNotice } from "@/src/auth-notice";
import { queryClient } from "@/src/query-client";
import { initializeRevenueCat, SubscriptionProvider } from "@/src/revenuecat";
import { colors } from "@/src/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

try {
  initializeRevenueCat();
} catch (err) {
  console.warn("RevenueCat unavailable:", err);
}

function Subscriptions({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <SubscriptionProvider userId={user?.id ?? null}>{children}</SubscriptionProvider>;
}

const PUBLIC_ROUTES = new Set(["", "index", "welcome", "auth", "+html"]);

// Signed-out users opening any protected deep link go to Welcome; after an auto-logout (login notice pending) they go to login.
function AuthGuard() {
  const { user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] ?? "";
  useEffect(() => {
    if (!user && !PUBLIC_ROUTES.has(first)) router.replace(hasLoginNotice() ? "/auth/login" : "/welcome");
  }, [user, first, router]);
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <AuthProvider>
              <Subscriptions>
                <ToastProvider>
                  <StatusBar style="light" />
                  <AuthGuard />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
                </ToastProvider>
              </Subscriptions>
            </AuthProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
});
