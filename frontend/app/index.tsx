import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/src/auth";
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
  if (!user) return <Redirect href="/welcome" />;
  if (!user.onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/discover" />;
}
