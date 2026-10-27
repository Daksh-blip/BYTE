import React, { forwardRef, useImperativeHandle, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Ionicons from "@react-native-vector-icons/ionicons";

import { photoSource, Profile } from "@/src/api";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

export type SwipeDir = "left" | "right" | "up";
export type SwipeCardHandle = { swipe: (dir: SwipeDir) => void };

type Props = { profile: Profile; onSwiped: (dir: SwipeDir) => void; onOpen: () => void; active: boolean };

export const SwipeCard = forwardRef<SwipeCardHandle, Props>(function SwipeCard({ profile, onSwiped, onOpen, active }, ref) {
  const s = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const [idx, setIdx] = useState(0);
  const photos = profile.photos;

  const fly = (dir: SwipeDir) => {
    "worklet";
    const tx = dir === "left" ? -width * 1.5 : dir === "right" ? width * 1.5 : 0;
    const ty = dir === "up" ? -1200 : 0;
    x.value = withTiming(tx, { duration: 260 });
    y.value = withTiming(ty, { duration: 260 }, () => scheduleOnRN(onSwiped, dir));
  };

  useImperativeHandle(ref, () => ({ swipe: (dir: SwipeDir) => fly(dir) }));

  const pan = usePanGesture({
    enabled: active,
    onUpdate: (e) => {
      "worklet";
      x.value = e.translationX;
      y.value = e.translationY;
    },
    onDeactivate: (e) => {
      "worklet";
      if (e.translationX > width * 0.28 || e.velocityX > 900) fly("right");
      else if (e.translationX < -width * 0.28 || e.velocityX < -900) fly("left");
      else if (e.translationY < -160) fly("up");
      else {
        x.value = withSpring(0);
        y.value = withSpring(0);
      }
    },
  });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${interpolate(x.value, [-width, width], [-12, 12])}deg` }],
  }));
  const likeStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, width * 0.25], [0, 1], "clamp") }));
  const nopeStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-width * 0.25, 0], [1, 0], "clamp") }));
  const superStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [-140, 0], [1, 0], "clamp") }));

  const tap = (side: "l" | "r") => {
    if (side === "r" && idx < photos.length - 1) setIdx(idx + 1);
    else if (side === "l" && idx > 0) setIdx(idx - 1);
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View testID={active ? `swipe-card-${profile.id}` : `swipe-card-next-${profile.id}`} style={[s.card, cardStyle]} pointerEvents={active ? "auto" : "none"}>
        <Image source={photoSource(photos[idx]?.url)} style={s.img} contentFit="cover" transition={150} />
        <View style={s.bars}>
          {photos.map((p, i) => (
            <View key={p.id} style={[s.bar, i === idx && s.barOn]} />
          ))}
        </View>
        <View style={s.tapRow}>
          <Pressable testID={active ? "card-prev-photo" : undefined} style={s.tapZone} onPress={() => tap("l")} />
          <Pressable testID={active ? "card-next-photo" : undefined} style={s.tapZone} onPress={() => tap("r")} />
        </View>

        <Animated.View style={[s.stamp, s.stampLike, likeStyle]}>
          <Text style={[s.stampText, { color: colors.success }]}>LIKE</Text>
        </Animated.View>
        <Animated.View style={[s.stamp, s.stampNope, nopeStyle]}>
          <Text style={[s.stampText, { color: colors.error }]}>NOPE</Text>
        </Animated.View>
        <Animated.View style={[s.stamp, s.stampSuper, superStyle]}>
          <Text style={[s.stampText, { color: colors.brandSecondary }]}>SUPER</Text>
        </Animated.View>

        {profile.is_demo ? (
          <View style={s.demo} testID={active ? "card-demo-badge" : undefined}>
            <Text style={s.demoText}>Demo profile</Text>
          </View>
        ) : null}

        <LinearGradient colors={[colors.scrimClear, colors.scrim]} style={s.scrim} pointerEvents="box-none">
          <Pressable testID={active ? "card-open-profile" : undefined} onPress={onOpen} style={s.info}>
            {profile.compatibility ? (
              <View style={s.compat} testID={active ? "card-compatibility" : undefined}>
                <Ionicons name="sparkles" size={13} color={colors.brandPrimary} />
                <Text style={s.compatText} numberOfLines={1}>
                  {profile.compatibility.reasons[0] ?? "New to you"}
                </Text>
              </View>
            ) : null}
            <View style={s.nameRow}>
              <Text style={s.name} numberOfLines={1}>
                {profile.name}
                {profile.age ? <Text style={s.age}>  {profile.age}</Text> : null}
              </Text>
              {profile.photo_verified ? <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} /> : null}
            </View>
            {profile.job || profile.city ? (
              <Text style={s.meta} numberOfLines={1}>
                {[profile.job, profile.city].filter(Boolean).join("  ·  ")}
              </Text>
            ) : null}
            {profile.bio ? (
              <Text style={s.bio} numberOfLines={2}>
                {profile.bio}
              </Text>
            ) : null}
            <View style={s.tags}>
              {profile.interests.slice(0, 3).map((i) => (
                <View key={i} style={s.tag}>
                  <Text style={s.tagText}>{i}</Text>
                </View>
              ))}
              <Ionicons name="chevron-up-circle-outline" size={24} color={colors.onSurface} style={{ marginLeft: "auto" }} />
            </View>
          </Pressable>
        </LinearGradient>
      </Animated.View>
    </GestureDetector>
  );
});

const useStyles = makeStyles((c) => ({
  card: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const), borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  img: { width: "100%", height: "100%" },
  bars: { position: "absolute", top: spacing.md, left: spacing.md, right: spacing.md, flexDirection: "row", gap: spacing.xs },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: c.overlay },
  barOn: { backgroundColor: c.onSurface },
  tapRow: { position: "absolute", top: 0, left: 0, right: 0, bottom: "40%", flexDirection: "row" },
  tapZone: { flex: 1 },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 120, paddingHorizontal: spacing.lg, paddingBottom: 100 },
  info: { gap: spacing.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: c.onSurface, fontSize: 30, fontWeight: "800", flexShrink: 1 },
  age: { fontWeight: "400", fontSize: 26 },
  meta: { color: c.onSurfaceTertiary, fontSize: font.base, fontWeight: "500" },
  bio: { color: c.onSurfaceSecondary, fontSize: font.base, lineHeight: 20, marginTop: spacing.xs },
  tags: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  tag: { backgroundColor: c.glass, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: c.border },
  tagText: { color: c.onSurface, fontSize: font.sm, fontWeight: "600" },
  demo: { position: "absolute", top: spacing.xl, right: spacing.md, backgroundColor: c.overlay, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: c.warning },
  demoText: { color: c.warning, fontSize: font.sm, fontWeight: "700" },
  compat: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: c.brandPrimarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4, marginBottom: spacing.xs, maxWidth: "100%" },
  compatText: { color: c.brandPrimary, fontSize: font.sm, fontWeight: "700", flexShrink: 1 },
  stamp: { position: "absolute", top: 60, borderWidth: 3, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  stampLike: { left: spacing.xl, borderColor: c.success, transform: [{ rotate: "-14deg" }] },
  stampNope: { right: spacing.xl, borderColor: c.error, transform: [{ rotate: "14deg" }] },
  stampSuper: { alignSelf: "center", top: 140, borderColor: c.brandSecondary },
  stampText: { fontSize: 32, fontWeight: "900", letterSpacing: 2 },
}));
