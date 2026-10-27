import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, photoSource, Profile } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { Button, EmptyState } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

export default function Likes() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [items, setItems] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await api<Profile[]>("/likes"));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="likes-screen">
      <View style={s.header}>
        <Text style={s.title}>Likes</Text>
        {items?.length ? (
          <View style={s.count}>
            <Text testID="likes-count" style={s.countText}>
              {items.length}
            </Text>
          </View>
        ) : null}
      </View>
      {items === null && !error ? (
        <View style={s.center}>
          <ActivityIndicator testID="likes-loading" color={colors.brandPrimary} />
        </View>
      ) : error ? (
        <EmptyState testID="likes-error" icon="cloud-offline-outline" title="Couldn't load likes" body={error} action={<Button testID="likes-retry" title="Retry" onPress={load} />} />
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={[s.list, { paddingBottom: bottomChrome + spacing.xl }, !items?.length && { flex: 1 }]}
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
          ListHeaderComponent={items?.length ? <Text style={s.sub}>These people already like you. Like them back to match instantly.</Text> : undefined}
          ListEmptyComponent={<EmptyState testID="likes-empty" icon="heart-outline" title="No likes yet" body="Keep swiping — when someone likes you, they'll show up here." />}
          renderItem={({ item }) => (
            <Pressable
              testID={`like-card-${item.id}`}
              style={s.card}
              onPress={() => router.push({ pathname: "/user/[userId]", params: { userId: item.id, actions: "1" } })}
            >
              <Image source={photoSource(item.photos[0]?.url)} style={s.img} contentFit="cover" transition={200} />
              {item.superlike ? (
                <View style={s.superBadge}>
                  <Ionicons name="star" size={12} color={colors.onBrandSecondary} />
                  <Text style={s.superText}>Super</Text>
                </View>
              ) : null}
              {item.is_demo ? (
                <View style={s.demoBadge}>
                  <Text style={s.demoText}>Demo</Text>
                </View>
              ) : null}
              <LinearGradient colors={[colors.scrimClear, colors.scrim]} style={s.scrim}>
                <Text style={s.name} numberOfLines={1}>
                  {item.name}
                  {item.age ? `, ${item.age}` : ""}
                </Text>
                {item.note ? (
                  <Text testID={`like-note-${item.id}`} style={s.note} numberOfLines={2}>
                    “{item.note}”
                  </Text>
                ) : item.compatibility?.reasons[0] ? (
                  <Text style={s.note} numberOfLines={1}>
                    {item.compatibility.reasons[0]}
                  </Text>
                ) : null}
              </LinearGradient>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { height: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  title: { color: c.onSurface, fontSize: font.xxl, fontWeight: "800" },
  count: { backgroundColor: c.brandTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center" },
  countText: { color: c.onBrandTertiary, fontWeight: "800", fontSize: font.sm },
  sub: { color: c.muted, fontSize: font.base, marginBottom: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  card: { flex: 1, aspectRatio: 3 / 4, borderRadius: radius.md, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  img: { width: "100%", height: "100%" },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 40, padding: spacing.md },
  name: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  superBadge: { position: "absolute", top: spacing.sm, left: spacing.sm, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.brandSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  superText: { color: c.onBrandSecondary, fontSize: font.sm, fontWeight: "700" },
  demoBadge: { position: "absolute", top: spacing.sm, right: spacing.sm, backgroundColor: c.overlay, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  demoText: { color: c.warning, fontSize: 11, fontWeight: "700" },
  note: { color: c.onSurfaceSecondary, fontSize: font.sm, marginTop: 2 },
}));
