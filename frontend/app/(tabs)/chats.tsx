import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import dayjs from "dayjs";

import { api, MatchT, photoSource } from "@/src/api";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { Button, EmptyState } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

function when(iso: string) {
  const d = dayjs(iso);
  return d.isSame(dayjs(), "day") ? d.format("h:mm A") : d.isSame(dayjs(), "year") ? d.format("MMM D") : d.format("MM/DD/YY");
}

export default function Chats() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [items, setItems] = useState<MatchT[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await api<MatchT[]>("/matches"));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 6000);
      return () => clearInterval(t);
    }, [load]),
  );

  const fresh = (items ?? []).filter((m) => !m.last_message_at);
  const convos = (items ?? []).filter((m) => m.last_message_at);
  const open = (id: string) => router.push({ pathname: "/chat/[matchId]", params: { matchId: id } });

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="chats-screen">
      <View style={s.header}>
        <Text style={s.title}>Chats</Text>
        <View style={s.e2ee}>
          <Ionicons name="lock-closed" size={12} color={colors.brandPrimary} />
          <Text style={s.e2eeText}>End-to-end encrypted</Text>
        </View>
      </View>
      {items === null && !error ? (
        <View style={s.center}>
          <ActivityIndicator testID="chats-loading" color={colors.brandPrimary} />
        </View>
      ) : error ? (
        <EmptyState testID="chats-error" icon="cloud-offline-outline" title="Couldn't load chats" body={error} action={<Button testID="chats-retry" title="Retry" onPress={load} />} />
      ) : !items?.length ? (
        <EmptyState
          testID="chats-empty"
          icon="lock-closed-outline"
          title="Start matching to chat securely"
          body="When you match with someone, you can message them here with end-to-end encryption."
          action={<Button testID="chats-go-discover" title="Discover people" onPress={() => router.push("/discover")} />}
        />
      ) : (
        <FlatList
          data={convos}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingBottom: bottomChrome + spacing.xl }}
          refreshControl={
            <RefreshControl
              tintColor={colors.brandPrimary}
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            <View>
              {fresh.length ? (
                <>
                  <Text style={s.section}>New matches</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.freshRow}>
                    {fresh.map((m) => (
                      <Pressable key={m.id} testID={`new-match-${m.id}`} style={s.freshItem} onPress={() => open(m.id)}>
                        <Image source={photoSource(m.user.photos[0]?.url)} style={s.freshImg} contentFit="cover" />
                        <Text style={s.freshName} numberOfLines={1}>
                          {m.user.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              ) : null}
              <Text style={s.section}>Messages</Text>
              {!convos.length ? <Text style={s.hint}>Say hi to a new match — they&apos;re waiting!</Text> : null}
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.last_sender_id === user?.id;
            return (
              <Pressable testID={`chat-row-${item.id}`} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceSecondary }]} onPress={() => open(item.id)}>
                <Image source={photoSource(item.user.photos[0]?.url)} style={s.avatar} contentFit="cover" />
                <View style={s.rowBody}>
                  <View style={s.rowTop}>
                    <Text style={s.name} numberOfLines={1}>
                      {item.user.name}
                    </Text>
                    <Text style={s.time}>{when(item.last_message_at!)}</Text>
                  </View>
                  <View style={s.rowTop}>
                    <View style={s.preview}>
                      <Ionicons name="lock-closed" size={12} color={colors.muted} />
                      <Text style={[s.previewText, item.unread > 0 && { color: colors.onSurface, fontWeight: "600" }]} numberOfLines={1}>
                        {mine ? "You sent an encrypted message" : "New encrypted message"}
                      </Text>
                    </View>
                    {item.unread > 0 ? (
                      <View style={s.badge}>
                        <Text style={s.badgeText}>{item.unread}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  title: { color: c.onSurface, fontSize: font.xxl, fontWeight: "800" },
  e2ee: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.brandPrimarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  e2eeText: { color: c.brandPrimary, fontSize: font.sm, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: { color: c.muted, fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.md },
  hint: { color: c.muted, paddingHorizontal: spacing.lg, fontSize: font.base },
  freshRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  freshItem: { width: 76, alignItems: "center", gap: spacing.xs, flexShrink: 0 },
  freshImg: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: c.brandPrimary },
  freshName: { color: c.onSurface, fontSize: font.sm, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.surfaceTertiary },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  name: { color: c.onSurface, fontSize: font.lg, fontWeight: "700", flex: 1 },
  time: { color: c.muted, fontSize: font.sm },
  preview: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  previewText: { color: c.muted, fontSize: font.base, flex: 1 },
  badge: { backgroundColor: c.brandPrimary, minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: c.onBrandPrimary, fontSize: 11, fontWeight: "800" },
}));
