import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/src/auth";
import { hasLoginNotice } from "@/src/auth-notice";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { loading, user } = useAuth();
  const { colors } = useTheme();
  if (loading) {
    return (
      <View testID="app-loading" style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href={hasLoginNotice() ? "/auth/login" : "/welcome"} />;
  if (user.role === "admin") return <Redirect href="/admin" />;
  const restricted = user.status === "banned" || (user.status === "suspended" && !!user.suspended_until && new Date(user.suspended_until) > new Date());
  if (restricted) return <Redirect href="/restricted" />;
  if (!user.onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/discover" />;
}
