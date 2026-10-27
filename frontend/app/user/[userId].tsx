import { goBack } from "@/src/go-back";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, photoSource, Profile } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ProfileBody } from "@/src/components/profile-body";
import { SafetySheet } from "@/src/components/safety-sheet";
import { Sheet } from "@/src/components/sheet";
import { EmptyState, Button } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

export default function UserProfile() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { userId, actions } = useLocalSearchParams<{ userId: string; actions?: string }>();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const isMe = userId === user?.id;

  useEffect(() => {
    api<Profile>(`/users/${userId}`)
      .then(setP)
      .catch((e) => setError(e.message));
  }, [userId]);

  const swipe = async (action: "like" | "pass", note = "") => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const r = await api("/swipes", { method: "POST", body: { target_id: userId, action, note } });
      setNoteOpen(false);
      if (r.matched) {
        toast(`You matched with ${p?.name}!`, "success");
        router.replace({ pathname: "/chat/[matchId]", params: { matchId: r.match_id } });
      } else goBack();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  if (error) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <EmptyState testID="user-error" icon="person-outline" title="Profile unavailable" body={error} action={<Button testID="user-error-back" title="Go back" onPress={() => goBack()} />} />
      </View>
    );
  }
  if (!p) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator testID="user-loading" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={s.root} testID="user-profile-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + (actions ? 120 : spacing.xl) }}>
        {p.photos.map((ph, i) => (
          <View key={ph.id}>
            <Image source={photoSource(ph.url)} style={{ width, height: width * 1.25 }} contentFit="cover" transition={200} />
            {i === 0 ? (
              <View style={s.bodyPad}>
                <ProfileBody p={p} />
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View style={[s.topBar, { top: insets.top + spacing.sm }]}>
        <Pressable testID="user-close-button" style={s.glassBtn} onPress={() => goBack()}>
          <Ionicons name="chevron-down" size={22} color={colors.onSurface} />
        </Pressable>
        {!isMe ? (
          <Pressable testID="user-menu-button" style={s.glassBtn} onPress={() => setMenu(true)}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.onSurface} />
          </Pressable>
        ) : null}
      </View>

      {actions && !isMe ? (
        <View style={[s.actions, { bottom: insets.bottom + spacing.lg }]}>
          <Pressable testID="user-pass-button" style={s.action} onPress={() => swipe("pass")}>
            <Ionicons name="close" size={30} color={colors.error} />
          </Pressable>
          <Pressable testID="user-note-button" style={[s.action, s.small]} onPress={() => setNoteOpen(true)}>
            <Ionicons name="chatbubble-ellipses" size={22} color={colors.brandPrimary} />
          </Pressable>
          <Pressable testID="user-like-button" style={[s.action, s.like]} onPress={() => swipe("like")}>
            <Ionicons name="heart" size={30} color={colors.onBrandTertiary} />
          </Pressable>
        </View>
      ) : null}

      {!isMe ? <SafetySheet visible={menu} onClose={() => setMenu(false)} userId={p.id} name={p.name} onDone={() => goBack()} /> : null}
      <Sheet visible={noteOpen} onClose={() => setNoteOpen(false)} title={`Like ${p.name} with a note`} testID="like-note-sheet">
        <Text style={s.noteHint}>A thoughtful note stands out more than a plain like. Notes are not end-to-end encrypted — save private details for chat.</Text>
        {p.prompts[0] ? <Text style={s.noteHint}>Tip: reply to “{p.prompts[0].question}”.</Text> : null}
        <TextInput
          testID="like-note-input"
          value={note}
          onChangeText={setNote}
          maxLength={140}
          placeholder="Say something about their profile…"
          placeholderTextColor={colors.muted}
          multiline
          style={s.noteInput}
        />
        <Button testID="like-note-send" title="Send like" icon="heart" disabled={!note.trim()} onPress={() => swipe("like", note.trim())} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { alignItems: "center", justifyContent: "center" },
  bodyPad: { padding: spacing.xl },
  topBar: { position: "absolute", left: spacing.lg, right: spacing.lg, flexDirection: "row", justifyContent: "space-between" },
  glassBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.glass, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border },
  actions: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: spacing.xxl },
  action: { width: 68, height: 68, borderRadius: radius.pill, backgroundColor: c.glass, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  like: { backgroundColor: c.brandTertiary, borderColor: c.brandTertiary },
  small: { width: 52, height: 52, alignSelf: "center" },
  noteHint: { color: c.muted, fontSize: font.sm, lineHeight: 18 },
  noteInput: { minHeight: 80, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, color: c.onSurface, padding: spacing.md, fontSize: font.lg, textAlignVertical: "top" },
}));
