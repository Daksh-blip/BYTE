import { goBack } from "@/src/go-back";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import dayjs from "dayjs";

import { api, MessageT, photoSource, Profile } from "@/src/api";
import { useAuth } from "@/src/auth";
import { decrypt, encrypt, myPublicKey, safetyNumber } from "@/src/e2ee";
import { storage } from "@/src/utils/storage";
import { SafetySheet } from "@/src/components/safety-sheet";
import { Sheet } from "@/src/components/sheet";
import { Button, IconButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Row = { id: string; mine: boolean; text: string | null; at: string; pending?: boolean };

export default function Chat() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const [other, setOther] = useState<Profile | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [lockInfo, setLockInfo] = useState(false);
  const [gone, setGone] = useState(false);
  const cache = useRef(new Map<string, string | null>());
  const localSent = useRef(new Map<string, Row>());
  const listRef = useRef<FlatList<Row>>(null);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await api<MessageT[]>(`/matches/${matchId}/messages`);
      const serverRows: Row[] = msgs.map((m) => {
        const mine = m.sender_id === user?.id;
        if (!cache.current.has(m.id)) cache.current.set(m.id, decrypt(m, mine));
        localSent.current.delete(m.id);
        return { id: m.id, mine, text: cache.current.get(m.id) ?? null, at: m.created_at };
      });
      // Keep messages we just sent that this (possibly stale) response doesn't include yet.
      setRows((prev) => {
        const pending = (prev ?? []).filter((r) => r.pending);
        return [...serverRows, ...Array.from(localSent.current.values()), ...pending];
      });
    } catch (e: any) {
      if (e.status === 404) setGone(true);
    }
  }, [matchId, user?.id]);

  useEffect(() => {
    api(`/matches/${matchId}`)
      .then((m) => setOther(m.user))
      .catch(() => setGone(true));
    loadMessages();
    const t = setInterval(() => {
      loadMessages();
      api(`/matches/${matchId}`).then((m) => setOther(m.user)).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [matchId, loadMessages]);

  const send = async () => {
    const body = text.trim();
    if (!body || !other?.public_key || sending) return;
    setSending(true);
    try {
      const payload = encrypt(body, other.public_key);
      const tempId = `tmp-${Date.now()}`;
      setRows((r) => [...(r ?? []), { id: tempId, mine: true, text: body, at: new Date().toISOString(), pending: true }]);
      setText("");
      const m = await api<MessageT>(`/matches/${matchId}/messages`, { method: "POST", body: payload });
      cache.current.set(m.id, body);
      const sent = { id: m.id, mine: true, text: body, at: m.created_at };
      localSent.current.set(m.id, sent);
      setRows((r) => {
        const rest = (r ?? []).filter((x) => x.id !== m.id);
        return rest.map((x) => (x.id === tempId ? sent : x));
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (e: any) {
      toast(e.message, "error");
      setRows((r) => (r ?? []).filter((x) => !x.pending));
    } finally {
      setSending(false);
    }
  };

  const safety = useMemo(() => {
    const mine = myPublicKey();
    return mine && other?.public_key ? safetyNumber(mine, other.public_key) : null;
  }, [other?.public_key]);

  // Identity-key change detection: remember the key we last saw for this match.
  const [keyChanged, setKeyChanged] = useState(false);
  useEffect(() => {
    if (!other?.public_key) return;
    const k = `peer_key_${matchId}`;
    storage.getItem(k, null as string | null).then((seen) => {
      if (seen && seen !== other.public_key) setKeyChanged(true);
      else if (!seen) storage.setItem(k, other.public_key);
    });
  }, [other?.public_key, matchId]);

  const acceptKey = () => {
    if (other?.public_key) storage.setItem(`peer_key_${matchId}`, other.public_key);
    setKeyChanged(false);
  };

  const icebreakers = useMemo(() => {
    if (!other || !user) return [];
    const out: string[] = [];
    const shared = other.interests.filter((i) => user.interests.includes(i));
    if (shared[0]) out.push(`I see we're both into ${shared[0].toLowerCase()} — how did you get into it?`);
    if (other.prompts[0]) out.push(`Your answer to “${other.prompts[0].question}” caught my eye. Tell me more?`);
    if (other.city) out.push(`What's your favorite spot in ${other.city}?`);
    if (other.interests[0] && other.interests[0] !== shared[0]) out.push(`What's the best thing about ${other.interests[0].toLowerCase()}?`);
    out.push("What's something you're looking forward to this week?");
    return out.slice(0, 3);
  }, [other, user]);

  if (gone) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]} testID="chat-gone">
        <Text style={s.goneText}>This conversation is no longer available.</Text>
        <Button testID="chat-gone-back" title="Back to chats" onPress={() => goBack("/chats")} />
      </View>
    );
  }

  return (
    <View style={s.root} testID="chat-screen">
      <View style={[s.header, { paddingTop: insets.top + spacing.xs }]}>
        <IconButton testID="chat-back-button" icon="chevron-back" onPress={() => goBack("/chats")} />
        <Pressable
          testID="chat-header-profile"
          style={s.headerUser}
          onPress={() => other && router.push({ pathname: "/user/[userId]", params: { userId: other.id } })}
        >
          <Image source={photoSource(other?.photos[0]?.url)} style={s.headerAvatar} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={s.headerName} numberOfLines={1}>
              {other?.name ?? ""}
            </Text>
            <Pressable testID="chat-e2ee-indicator" onPress={() => setLockInfo(true)} style={s.lockRow} hitSlop={8}>
              <Ionicons name="lock-closed" size={11} color={colors.brandPrimary} />
              <Text style={s.lockText}>End-to-end encrypted</Text>
            </Pressable>
          </View>
        </Pressable>
        <IconButton testID="chat-menu-button" icon="ellipsis-horizontal" onPress={() => setMenu(true)} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "translate-with-padding"} style={{ flex: 1 }}>
        {rows === null ? (
          <View style={s.center}>
            <ActivityIndicator testID="chat-loading" color={colors.brandPrimary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.id}
            contentContainerStyle={s.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={s.intro}>
                <View style={s.introIcon}>
                  <Ionicons name="lock-closed" size={22} color={colors.brandPrimary} />
                </View>
                <Text style={s.introText}>
                  Messages with {other?.name ?? "your match"} are end-to-end encrypted. Not even BYTE TALKS can read them.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View testID={`message-${item.id}`} style={[s.bubbleWrap, item.mine ? s.right : s.left]}>
                <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleTheirs]}>
                  {item.text !== null ? (
                    <Text style={[s.msg, item.mine && { color: colors.onBrandPrimary }]}>{item.text}</Text>
                  ) : (
                    <Text style={[s.msg, s.undecryptable, item.mine && { color: colors.onBrandPrimary }]}>Encrypted on another device</Text>
                  )}
                </View>
                <Text style={s.time}>{item.pending ? "Sending…" : dayjs(item.at).format("h:mm A")}</Text>
              </View>
            )}
          />
        )}

        {keyChanged ? (
          <View style={s.keyChanged} testID="chat-key-changed-banner">
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={s.waitingText}>
              {other?.name}&apos;s security key changed. This usually means a new device or reinstall. Check the safety number before sharing anything sensitive.
            </Text>
            <Pressable testID="chat-key-changed-ok" onPress={acceptKey} hitSlop={8}>
              <Text style={s.keyOk}>OK</Text>
            </Pressable>
          </View>
        ) : null}

        {rows && rows.length === 0 && other?.public_key ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.iceRow} style={s.iceScroll} keyboardShouldPersistTaps="handled">
            {icebreakers.map((t, i) => (
              <Pressable key={t} testID={`icebreaker-${i}`} style={s.ice} onPress={() => setText(t)}>
                <Ionicons name="bulb-outline" size={14} color={colors.brandPrimary} />
                <Text style={s.iceText} numberOfLines={2}>
                  {t}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {other && !other.public_key ? (
          <View style={s.waiting} testID="chat-waiting-key">
            <Ionicons name="hourglass-outline" size={16} color={colors.warning} />
            <Text style={s.waitingText}>Secure chat activates once {other.name} opens BYTE TALKS.</Text>
          </View>
        ) : null}

        <View style={[s.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput
            testID="chat-message-input"
            value={text}
            onChangeText={setText}
            placeholder={other?.public_key ? "Write an encrypted message…" : "Waiting for secure keys…"}
            placeholderTextColor={colors.muted}
            editable={!!other?.public_key}
            multiline
            maxLength={2000}
            style={s.input}
          />
          <Pressable
            testID="chat-send-button"
            onPress={send}
            disabled={!text.trim() || !other?.public_key}
            style={[s.send, (!text.trim() || !other?.public_key) && { opacity: 0.4 }]}
          >
            <Ionicons name="arrow-up" size={22} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {other ? (
        <SafetySheet visible={menu} onClose={() => setMenu(false)} userId={other.id} name={other.name} matchId={matchId} onDone={() => goBack("/chats")} />
      ) : null}

      <Sheet visible={lockInfo} onClose={() => setLockInfo(false)} title="Your chat is private" testID="e2ee-info-sheet">
        <Text style={s.sheetBody}>
          Messages are encrypted on your phone and can only be unlocked on {other?.name ?? "your match"}&apos;s phone. Our servers only store scrambled data.
        </Text>
        {safety ? (
          <View style={s.safetyBox}>
            <Text style={s.safetyLabel}>Safety number</Text>
            <Text testID="e2ee-safety-number" style={s.safetyNum}>
              {safety}
            </Text>
            <Text style={s.sheetBody}>Compare this number with {other?.name} in person. If it matches, nobody is listening in.</Text>
          </View>
        ) : null}
        <Button testID="e2ee-info-close" title="Got it" onPress={() => setLockInfo(false)} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  goneText: { color: c.onSurface, fontSize: font.lg, textAlign: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs, paddingBottom: spacing.sm, backgroundColor: c.glass, borderBottomWidth: 1, borderBottomColor: c.divider },
  headerUser: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary },
  headerName: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
  lockRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  lockText: { color: c.brandPrimary, fontSize: 11, fontWeight: "600" },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  intro: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.xl },
  introIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.brandPrimarySoft, alignItems: "center", justifyContent: "center" },
  introText: { color: c.muted, fontSize: font.sm, textAlign: "center", lineHeight: 18 },
  bubbleWrap: { maxWidth: "80%", gap: 2 },
  right: { alignSelf: "flex-end", alignItems: "flex-end" },
  left: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: 20, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  bubbleMine: { backgroundColor: c.brandPrimary, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: c.surfaceTertiary, borderBottomLeftRadius: 6 },
  msg: { color: c.onSurface, fontSize: font.lg, lineHeight: 22 },
  undecryptable: { fontStyle: "italic", color: c.muted },
  time: { color: c.muted, fontSize: 11, marginHorizontal: spacing.xs },
  waiting: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary },
  waitingText: { color: c.onSurfaceSecondary, fontSize: font.sm, flex: 1 },
  keyChanged: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.warning },
  keyOk: { color: c.brandPrimary, fontWeight: "700", fontSize: font.base },
  iceScroll: { flexGrow: 0, flexShrink: 0 },
  iceRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  ice: { width: 220, flexShrink: 0, flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  iceText: { color: c.onSurfaceSecondary, fontSize: font.sm, flex: 1, lineHeight: 18 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: c.surfaceSecondary, borderRadius: 22, paddingHorizontal: spacing.lg, paddingTop: 12, paddingBottom: 12, color: c.onSurface, fontSize: font.lg },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  sheetBody: { color: c.muted, fontSize: font.base, lineHeight: 20 },
  safetyBox: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  safetyLabel: { color: c.muted, fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  safetyNum: { color: c.brandPrimary, fontSize: font.xl, fontWeight: "700", letterSpacing: 2, fontVariant: ["tabular-nums"] },
}));
