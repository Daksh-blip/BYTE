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
import { decryptLegacy } from "@/src/e2ee";
import { FAILED } from "@/src/signal/cache";
import {
  acceptNewIdentity,
  confirmSafetyNumber,
  hasSessionWith,
  myDevice,
  readSignal,
  safetyNumber,
  sendSignal,
  SignalError,
  unavailableText,
  useSignalStatus,
} from "@/src/signal";
import { SafetySheet } from "@/src/components/safety-sheet";
import { Sheet } from "@/src/components/sheet";
import { Button, IconButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Kind = "text" | "unavailable" | "failed" | "system";
type Row = { id: string; mine: boolean; text: string; kind: Kind; legacy: boolean; at: string; pending?: boolean };
type MatchInfo = { user: Profile; protocol: "nacl-box-v1" | "signal-v1" };

export default function Chat() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const status = useSignalStatus();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [lockInfo, setLockInfo] = useState(false);
  const [gone, setGone] = useState(false);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [newIdentity, setNewIdentity] = useState<unknown>(null);
  const [session, setSession] = useState(false);
  const [safety, setSafety] = useState<{ numeric: string; trustState: string | null; confirmation: unknown } | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);
  const other = match?.user ?? null;
  const isSignal = match?.protocol === "signal-v1";

  const toRow = useCallback(
    (m: MessageT, cache: Record<string, string>): Row => {
      const mine = m.sender_id === user?.id;
      const base = { id: m.id, mine, at: m.created_at, legacy: m.protocol === "nacl-box-v1" };
      if (m.protocol === "system") return { ...base, kind: "system", text: "Chat upgraded to Signal Protocol. Earlier messages keep their original, older encryption." };
      if (m.protocol === "nacl-box-v1") {
        const t = decryptLegacy(m, mine);
        return t === null ? { ...base, kind: "unavailable", text: "Legacy encrypted message. Its key isn't on this device." } : { ...base, kind: "text", text: t };
      }
      if (m.protocol !== "signal-v1") return { ...base, kind: "failed", text: "Unsupported message format" };
      const t = cache[m.id];
      if (t === FAILED) return { ...base, kind: "failed", text: "This message couldn't be verified and was not shown." };
      if (t !== undefined) return { ...base, kind: "text", text: t };
      const dev = myDevice();
      const elsewhere = mine ? m.sender_device !== dev : m.recipient_device !== dev;
      return { ...base, kind: "unavailable", text: elsewhere ? "Encrypted for another of your devices" : "Unlocking…" };
    },
    [user?.id],
  );

  const loadMessages = useCallback(async (dropId?: string) => {
    try {
      const msgs = await api<MessageT[]>(`/matches/${matchId}/messages`);
      if (!other) return;
      const { cache, identityChanged } = await readSignal(matchId, other.id, msgs);
      if (identityChanged) setNewIdentity(identityChanged);
      setRows((prev) => [...msgs.map((m) => toRow(m, cache)), ...(prev ?? []).filter((r) => r.pending && r.id !== dropId)]);
    } catch (e: any) {
      if (e.status === 404) setGone(true);
    }
  }, [matchId, other, toRow]);

  useEffect(() => {
    const loadMatch = () =>
      api<MatchInfo>(`/matches/${matchId}`)
        .then(setMatch)
        .catch((e) => e.status === 404 && setGone(true));
    loadMatch();
    const t = setInterval(loadMatch, 5000);
    return () => clearInterval(t);
  }, [matchId]);

  useEffect(() => {
    if (!other) return;
    loadMessages();
    const t = setInterval(loadMessages, 3000);
    return () => clearInterval(t);
  }, [other?.id, status, loadMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (other) hasSessionWith(other.id).then(setSession);
  }, [other, rows?.length, status]);

  const send = async () => {
    const body = text.trim();
    if (!body || !other || sending || !isSignal) return;
    setSending(true);
    setBlocker(null);
    const tempId = `tmp-${Date.now()}`;
    setRows((r) => [...(r ?? []), { id: tempId, mine: true, text: body, kind: "text", legacy: false, at: new Date().toISOString(), pending: true }]);
    setText("");
    try {
      await sendSignal(matchId, other.id, body);
      setSession(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await loadMessages(tempId); // the server copy replaces the optimistic row
    } catch (e: any) {
      setText(body);
      setRows((r) => (r ?? []).filter((x) => x.id !== tempId));
      if (e instanceof SignalError && e.code === "IDENTITY_CHANGED") setNewIdentity(e.identity);
      else if (e instanceof SignalError && e.code === "NO_SECURE_DEVICE") setBlocker(`Secure chat activates once ${other.name} opens BYTE TALKS.`);
      else if (e?.message === "RECIPIENT_DEVICE_CHANGED") setBlocker(`${other.name} switched devices. Tap send again to set up a new secure session.`);
      else if (e?.message === "DEVICE_NOT_ACTIVE") setBlocker("This device is no longer your secure chat device. Sign out and back in to use it.");
      else toast(e instanceof SignalError ? e.message : "Message not sent. Nothing was sent unencrypted.", "error");
    } finally {
      setSending(false);
    }
  };

  const upgrade = async () => {
    setUpgrading(true);
    try {
      const m = await api<{ protocol: MatchInfo["protocol"] }>(`/matches/${matchId}/upgrade-encryption`, { method: "POST" });
      setMatch((x) => (x ? { ...x, protocol: m.protocol } : x));
      await loadMessages();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setUpgrading(false);
    }
  };

  const acceptKey = async () => {
    if (!other) return;
    try {
      await acceptNewIdentity(other.id, newIdentity);
      setNewIdentity(null);
      setSafety(null);
      await loadMessages();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const openInfo = async () => {
    setLockInfo(true);
    if (other && session) safetyNumber(other.id).then(setSafety).catch(() => setSafety(null));
  };

  const verify = async () => {
    if (!safety) return;
    try {
      await confirmSafetyNumber(safety.confirmation);
      setSafety({ ...safety, trustState: "VERIFIED" });
      toast("Marked as verified", "success");
    } catch (e: any) {
      toast(e.message, "error");
    }
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

  const canType = isSignal && status === "ready" && !newIdentity;
  const label = !match ? "" : !isSignal ? "Legacy encryption" : session ? "Signal Protocol · end-to-end encrypted" : "Secure session not set up yet";

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
            <Pressable testID="chat-e2ee-indicator" onPress={openInfo} style={s.lockRow} hitSlop={8}>
              <Ionicons name={isSignal && session ? "shield-checkmark" : "lock-closed"} size={11} color={isSignal ? colors.brandPrimary : colors.warning} />
              <Text testID="chat-protocol-label" style={[s.lockText, !isSignal && { color: colors.warning }]}>
                {label}
              </Text>
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
                  {isSignal
                    ? `Messages with ${other?.name ?? "your match"} use the Signal Protocol. Only your two devices can read them. Not even BYTE TALKS can.`
                    : "This chat still uses BYTE TALKS' older encryption. Upgrade it to keep chatting."}
                </Text>
              </View>
            }
            renderItem={({ item }) =>
              item.kind === "system" ? (
                <View testID={`message-${item.id}`} style={s.system}>
                  <Ionicons name="shield-checkmark" size={14} color={colors.brandPrimary} />
                  <Text style={s.systemText}>{item.text}</Text>
                </View>
              ) : (
                <View testID={`message-${item.id}`} style={[s.bubbleWrap, item.mine ? s.right : s.left]}>
                  <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleTheirs]}>
                    <Text style={[s.msg, item.kind !== "text" && s.undecryptable, item.mine && { color: colors.onBrandPrimary }]}>{item.text}</Text>
                  </View>
                  <Text style={s.time}>
                    {item.pending ? "Sending…" : dayjs(item.at).format("h:mm A")}
                    {item.legacy ? " · Legacy encryption" : ""}
                  </Text>
                </View>
              )
            }
          />
        )}

        {newIdentity ? (
          <View style={s.keyChanged} testID="chat-key-changed-banner">
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={s.waitingText}>
              {other?.name}&apos;s security key changed, usually because of a new phone or reinstall. Messages are paused until you accept the new key.
            </Text>
            <Pressable testID="chat-key-changed-accept" onPress={acceptKey} hitSlop={8}>
              <Text style={s.keyOk}>Accept</Text>
            </Pressable>
          </View>
        ) : null}

        {isSignal && status !== "ready" ? (
          <View style={s.waiting} testID="chat-signal-unavailable">
            <Ionicons name={status === "starting" ? "hourglass-outline" : "alert-circle-outline"} size={16} color={colors.warning} />
            <Text style={s.waitingText}>{unavailableText(status)}</Text>
          </View>
        ) : null}

        {blocker ? (
          <View style={s.waiting} testID="chat-waiting-key">
            <Ionicons name="hourglass-outline" size={16} color={colors.warning} />
            <Text style={s.waitingText}>{blocker}</Text>
          </View>
        ) : null}

        {rows && rows.length === 0 && canType ? (
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

        {match && !isSignal ? (
          <View style={[s.upgrade, { paddingBottom: insets.bottom + spacing.md }]} testID="chat-upgrade-card">
            <Text style={s.upgradeTitle}>Upgrade this chat to the Signal Protocol</Text>
            <Text style={s.waitingText}>
              New messages get forward secrecy and post-quantum protection. Older messages stay as they are, with their original encryption. This can&apos;t be undone.
            </Text>
            <Button testID="chat-upgrade-button" title="Upgrade encryption" icon="shield-checkmark" loading={upgrading} onPress={upgrade} />
          </View>
        ) : (
          <View style={[s.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
            <TextInput
              testID="chat-message-input"
              value={text}
              onChangeText={setText}
              placeholder={canType ? "Write an encrypted message…" : "Secure chat unavailable"}
              placeholderTextColor={colors.muted}
              editable={canType}
              multiline
              maxLength={2000}
              style={s.input}
            />
            <Pressable
              testID="chat-send-button"
              onPress={send}
              disabled={!text.trim() || !canType || sending}
              style={[s.send, (!text.trim() || !canType) && { opacity: 0.4 }]}
            >
              {sending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Ionicons name="arrow-up" size={22} color={colors.onBrandPrimary} />}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {other ? (
        <SafetySheet visible={menu} onClose={() => setMenu(false)} userId={other.id} name={other.name} matchId={matchId} onDone={() => goBack("/chats")} />
      ) : null}

      <Sheet visible={lockInfo} onClose={() => setLockInfo(false)} title="Encryption details" testID="e2ee-info-sheet">
        <Text testID="e2ee-info-protocol" style={s.sheetBody}>
          {!isSignal
            ? "This chat uses the older NaCl-box encryption: messages are encrypted on your device, but it has no forward secrecy. Upgrade to the Signal Protocol for stronger protection."
            : session
              ? `New messages use the Signal Protocol (PQXDH key agreement, Double Ratchet, post-quantum ratchet). Each message has its own key, which is deleted after use. Older messages marked "Legacy encryption" keep their original protection.`
              : "This chat is set to the Signal Protocol. The secure session starts with your first message, or when the first message from your match arrives."}
        </Text>
        {safety ? (
          <View style={s.safetyBox}>
            <Text style={s.safetyLabel}>Safety number {safety.trustState === "VERIFIED" ? "· Verified" : ""}</Text>
            <Text testID="e2ee-safety-number" style={s.safetyNum}>
              {safety.numeric}
            </Text>
            <Text style={s.sheetBody}>Compare this number with {other?.name} in person. If it matches, nobody is listening in.</Text>
            {safety.trustState !== "VERIFIED" ? <Button testID="e2ee-mark-verified" title="It matches. Mark as verified" variant="secondary" onPress={verify} /> : null}
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
  system: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", backgroundColor: c.brandPrimarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, maxWidth: "90%" },
  systemText: { color: c.onSurfaceSecondary, fontSize: font.sm, flexShrink: 1 },
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
  waitingText: { color: c.onSurfaceSecondary, fontSize: font.sm, flex: 1, lineHeight: 18 },
  keyChanged: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.warning },
  keyOk: { color: c.brandPrimary, fontWeight: "700", fontSize: font.base },
  upgrade: { gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.surfaceSecondary },
  upgradeTitle: { color: c.onSurface, fontSize: font.lg, fontWeight: "700" },
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
  safetyNum: { color: c.brandPrimary, fontSize: font.lg, fontWeight: "700", letterSpacing: 1, fontVariant: ["tabular-nums"] },
}));
