import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";

import { usesNativeTabs } from "@/src/navigation";
import { useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();

  if (usesNativeTabs) {
    return (
      <NativeTabs tintColor={colors.brandPrimary}>
        <NativeTabs.Trigger name="discover">
          <NativeTabs.Trigger.Icon sf="flame.fill" />
          <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="likes">
          <NativeTabs.Trigger.Icon sf="heart.fill" />
          <NativeTabs.Trigger.Label>Likes</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="chats">
          <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right.fill" />
          <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Icon sf="person.crop.circle.fill" />
          <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  const icon = (on: React.ComponentProps<typeof Ionicons>["name"], off: React.ComponentProps<typeof Ionicons>["name"]) => {
    const TabIcon = ({ focused, color }: { focused: boolean; color: unknown }) => (
      <Ionicons name={focused ? on : off} size={24} color={color as string} />
    );
    return TabIcon;
  };

  return (
    <Tabs
      screenListeners={{ tabPress: () => Haptics.selectionAsync().catch(() => {}) }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.divider,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarButtonTestID: "tab-discover", tabBarIcon: icon("flame", "flame-outline") }} />
      <Tabs.Screen name="likes" options={{ title: "Likes", tabBarButtonTestID: "tab-likes", tabBarIcon: icon("heart", "heart-outline") }} />
      <Tabs.Screen name="chats" options={{ title: "Chats", tabBarButtonTestID: "tab-chats", tabBarIcon: icon("chatbubbles", "chatbubbles-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarButtonTestID: "tab-profile", tabBarIcon: icon("person-circle", "person-circle-outline") }} />
    </Tabs>
  );
}
