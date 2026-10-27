import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { ZoomIn } from "react-native-reanimated";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, photoSource, Profile } from "@/src/api";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { DISCOVER_MODES } from "@/src/constants";
import { SwipeCard, SwipeCardHandle, SwipeDir } from "@/src/components/swipe-card";
import { Button, EmptyState, IconButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type MatchInfo = { match_id: string; user: Profile };

export default function Discover() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const [deck, setDeck] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const topRef = useRef<SwipeCardHandle>(null);

  const [mode, setMode] = useState<string>("smart");
  const [canUndo, setCanUndo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDeck(await api<Profile[]>(`/discover?mode=${mode}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  const undo = async () => {
    try {
      const p = await api<Profile>("/swipes/undo", { method: "POST" });
      setDeck((d) => [p, ...d]);
      setCanUndo(false);
    } catch (e: any) {
      toast(e.message, "error");
      setCanUndo(false);
    }
  };

  const onSwiped = useCallback(
    async (dir: SwipeDir) => {
      const target = deck[0];
      if (!target) return;
      setDeck((d) => d.slice(1));
      const action = dir === "right" ? "like" : dir === "up" ? "superlike" : "pass";
      setCanUndo(action === "pass");
      if (action === "pass") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      try {
        const r = await api("/swipes", { method: "POST", body: { target_id: target.id, action } });
        if (r.matched) setMatch({ match_id: r.match_id, user: r.user });
      } catch (e: any) {
        toast(e.message, "error");
      }
    },
    [deck, toast],
  );

  const top = deck[0];
  const nextCard = deck[1];

  return (
    <View style={[s.root, { paddingTop: insets.top }]} testID="discover-screen">
      <View style={s.header}>
        <View style={s.brandRow}>
          <View style={s.logo}>
            <Ionicons name="chatbubbles" size={16} color={colors.onBrandPrimary} />
          </View>
          <Text style={s.brand}>BYTE TALKS</Text>
        </View>
        <View style={s.headerActions}>
          {canUndo ? <IconButton testID="discover-undo-button" icon="arrow-undo-outline" color={colors.warning} onPress={undo} /> : null}
          <IconButton testID="discover-filters-button" icon="options-outline" onPress={() => router.push("/edit-profile")} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.modeRow} contentContainerStyle={s.modeRowContent}>
        {DISCOVER_MODES.map((m) => {
          const on = m.value === mode;
          return (
            <Pressable key={m.value} testID={`discover-mode-${m.value}`} onPress={() => setMode(m.value)} style={[s.mode, on && s.modeOn]}>
              <Ionicons name={m.icon as any} size={14} color={on ? colors.brandPrimary : colors.muted} />
              <Text style={[s.modeText, on && { color: colors.brandPrimary }]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[s.deckArea, { marginBottom: bottomChrome + spacing.lg }]}>
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator testID="discover-loading" color={colors.brandPrimary} size="large" />
          </View>
        ) : error ? (
          <EmptyState testID="discover-error" icon="cloud-offline-outline" title="Connection lost" body={error} action={<Button testID="discover-retry" title="Retry" onPress={load} />} />
        ) : !top ? (
          <EmptyState
            testID="discover-empty"
            icon="radio-outline"
            title={mode === "smart" ? "That's today's Smart Picks" : "No new profiles here"}
            body={
              mode === "smart"
                ? "We show fewer, more relevant people. Try Explore, or check back later for fresh picks."
                : "You've seen everyone in this view. Try another mode or widen your preferences."
            }
            action={<Button testID="discover-refresh" title="Refresh" variant="secondary" onPress={load} />}
          />
        ) : (
          <>
            <View style={s.stack}>
              {nextCard ? <SwipeCard key={nextCard.id} profile={nextCard} onSwiped={() => {}} onOpen={() => {}} active={false} /> : null}
              <SwipeCard
                key={top.id}
                ref={topRef}
                profile={top}
                active
                onSwiped={onSwiped}
                onOpen={() => router.push({ pathname: "/user/[userId]", params: { userId: top.id } })}
              />
            </View>
            <View style={s.actions}>
              <Pressable testID="discover-pass-button" style={[s.action, s.actionSm]} onPress={() => topRef.current?.swipe("left")}>
                <Ionicons name="close" size={30} color={colors.error} />
              </Pressable>
              <Pressable testID="discover-superlike-button" style={[s.action, s.actionXs]} onPress={() => topRef.current?.swipe("up")}>
                <Ionicons name="star" size={22} color={colors.brandSecondary} />
              </Pressable>
              <Pressable testID="discover-like-button" style={[s.action, s.actionSm, s.likeBtn]} onPress={() => topRef.current?.swipe("right")}>
                <Ionicons name="heart" size={30} color={colors.onBrandTertiary} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      <Modal visible={!!match} transparent animationType="fade" onRequestClose={() => setMatch(null)}>
        {match ? (
          <View style={s.matchRoot} testID="match-modal">
            <Animated.View entering={ZoomIn.springify()} style={s.matchInner}>
              <Text style={s.matchTitle}>It&apos;s a match!</Text>
              <Text style={s.matchSub}>You and {match.user.name} liked each other.</Text>
              {match.user.is_demo ? <Text style={s.lockText}>This is a demo profile used to preview matching.</Text> : null}
              <View style={s.avatars}>
                <Image source={photoSource(user?.photos[0]?.url)} style={[s.avatar, { transform: [{ rotate: "-8deg" }] }]} contentFit="cover" />
                <Image source={photoSource(match.user.photos[0]?.url)} style={[s.avatar, { transform: [{ rotate: "8deg" }], marginLeft: -24 }]} contentFit="cover" />
              </View>
              <View style={s.lockRow}>
                <Ionicons name="lock-closed" size={14} color={colors.brandPrimary} />
                <Text style={s.lockText}>Messages are end-to-end encrypted</Text>
              </View>
              <Button
                testID="match-send-message"
                title="Send a message"
                style={{ alignSelf: "stretch" }}
                onPress={() => {
                  const id = match.match_id;
                  setMatch(null);
                  router.push({ pathname: "/chat/[matchId]", params: { matchId: id } });
                }}
              />
              <Button testID="match-keep-swiping" title="Keep swiping" variant="ghost" onPress={() => setMatch(null)} />
            </Animated.View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: spacing.lg, paddingRight: spacing.sm },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerActions: { flexDirection: "row", alignItems: "center" },
  modeRow: { height: 56, flexGrow: 0, flexShrink: 0 },
  modeRowContent: { paddingHorizontal: spacing.md, gap: spacing.sm, alignItems: "center" },
  mode: { height: 36, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  modeOn: { borderColor: c.brandPrimary, backgroundColor: c.brandPrimarySoft },
  modeText: { color: c.muted, fontSize: font.base, fontWeight: "600" },
  logo: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  brand: { color: c.onSurface, fontSize: font.lg, fontWeight: "800", letterSpacing: 2 },
  deckArea: { flex: 1, paddingHorizontal: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  stack: { flex: 1 },
  actions: { position: "absolute", bottom: spacing.lg, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.xl },
  action: { alignItems: "center", justifyContent: "center", backgroundColor: c.glass, borderWidth: 1, borderColor: c.border, borderRadius: radius.pill },
  actionSm: { width: 64, height: 64 },
  actionXs: { width: 48, height: 48 },
  likeBtn: { backgroundColor: c.brandTertiary, borderColor: c.brandTertiary },
  matchRoot: { flex: 1, backgroundColor: c.scrim, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  matchInner: { alignItems: "center", gap: spacing.md, width: "100%", maxWidth: 380 },
  matchTitle: { color: c.brandPrimary, fontSize: 40, fontWeight: "900", fontStyle: "italic" },
  matchSub: { color: c.onSurfaceSecondary, fontSize: font.lg },
  avatars: { flexDirection: "row", marginVertical: spacing.xl },
  avatar: { width: 130, height: 170, borderRadius: radius.md, borderWidth: 3, borderColor: c.surface },
  lockRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  lockText: { color: c.muted, fontSize: font.sm },
}));
