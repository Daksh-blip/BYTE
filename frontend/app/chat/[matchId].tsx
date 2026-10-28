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
import * as ImagePicker from "expo-image-picker";
import { Linking } from "react-native";
import { decodePhoto, encodePhoto, isPhoto, mediaStatus, PhotoMsg, uploadEncryptedPhoto } from "@/src/chat-photo";
import { PhotoBubble } from "@/src/components/photo-bubble";
import { isLive, onLive, sendTyping } from "@/src/live";
import { useAuth } from "@/src/auth";
import { decryptLegacy } from "@/src/e2ee";
import { FAILED } from "@/src/signal/cache";
import {
  acceptNewIdentity,
  confirmSafetyNumber,
  hasSessionWith,
  myDevice,
  useLinkState,
  readSignal,
  safetyNumber,
  sendSignal,
  SignalError,
  unavailableText,
  updateCached,
  useSignalStatus,
} from "@/src/signal";
import { SafetySheet } from "@/src/components/safety-sheet";
import { AiIdeasSheet } from "@/src/components/ai-ideas-sheet";
import { Sheet } from "@/src/components/sheet";
import { Button, IconButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Kind = "text" | "unavailable" | "failed" | "system" | "photo";
type Row = { id: string; mine: boolean; text: string; kind: Kind; legacy: boolean; at: string; pending?: boolean; photo?: PhotoMsg };
type MatchInfo = { user: Profile; protocol: "nacl-box-v1" | "signal-v1"; receipts?: boolean; peer_read_at?: string | null };

export default function Chat() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const status = useSignalStatus();
  const linkState = useLinkState();
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
  const [typing, setTyping] = useState(false);
  const [voOpened, setVoOpened] = useState<Record<string, boolean>>({});
  const [pendingPhoto, setPendingPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoPerm, setPhotoPerm] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
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
      if (t !== undefined && isPhoto(t)) {
        const photo = decodePhoto(t);
        return photo ? { ...base, kind: "photo", text: "", photo } : { ...base, kind: "failed", text: "Unsupported photo format" };
      }
      if (t !== undefined) return { ...base, kind: "text", text: t };
      if (!m.ciphertext) return { ...base, kind: "unavailable", text: mine ? "Sent from another of your devices before this one was linked" : "Sent before this device was linked" };
      return { ...base, kind: "unavailable", text: "Unlocking…" };
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
    const t = setInterval(() => !isLive() && loadMessages(), 3000); // polling only as a fallback when offline from live
    const slow = setInterval(loadMessages, 20000);
    return () => {
      clearInterval(t);
      clearInterval(slow);
    };
  }, [other?.id, status, loadMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMedia = useCallback(() => {
    mediaStatus(matchId).then(setVoOpened).catch(() => {});
  }, [matchId]);

  // Instant delivery: live events trigger fetches; typing + read come only when both people allow receipts.
  useEffect(() => {
    refreshMedia();
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    const off = onLive((e) => {
      if (e.match_id !== matchId) return;
      if (e.type === "message") {
        setTyping(false);
        loadMessages();
      } else if (e.type === "typing") {
        setTyping(true);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => setTyping(false), 4000);
      } else if (e.type === "read") setMatch((x) => (x ? { ...x, peer_read_at: e.at } : x));
      else if (e.type === "opened") refreshMedia();
    });
    return () => {
      off();
      clearTimeout(typingTimer);
    };
  }, [matchId, loadMessages, refreshMedia]);

  const pickPhoto = async () => {
    if (!other || !canType) return;
    if (Platform.OS !== "web") {
      const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!cur.granted) {
        const r = cur.canAskAgain ? await ImagePicker.requestMediaLibraryPermissionsAsync() : cur;
        if (!r.granted) return setPhotoPerm(true);
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!res.canceled && res.assets[0]) setPendingPhoto(res.assets[0]);
  };

  const sendPhoto = async (viewOnce: boolean) => {
    const asset = pendingPhoto;
    if (!asset || !other) return;
    setPendingPhoto(null);
    setSending(true);
    try {
      const payload = await uploadEncryptedPhoto(matchId, asset, viewOnce);
      await sendSignal(matchId, other.id, encodePhoto(payload));
      await loadMessages();
    } catch (e: any) {
      if (e instanceof SignalError && e.code === "IDENTITY_CHANGED") setNewIdentity(e.identity);
      else toast(e.message || "Photo not sent", "error");
    } finally {
      setSending(false);
    }
  };

  const markOpened = (row: Row) => {
    if (!row.photo) return;
    // Forget the key locally once a view-once photo was opened.
    updateCached(matchId, row.id, encodePhoto({ ...row.photo, k: "", n: "", opened: true })).then(() => loadMessages());
  };

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

  const canType = isSignal && status === "ready" && !newIdentity && linkState === "active";
  const lastMine = rows ? [...rows].reverse().find((r) => r.mine && !r.pending) : undefined;
  const readMark = (r: Row) =>
    match?.receipts && match.peer_read_at && r.id === lastMine?.id && dayjs(match.peer_read_at).isAfter(dayjs(r.at).subtract(1, "second")) ? " · Read" : "";
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
              ) : item.kind === "photo" && item.photo ? (
                <View style={[s.bubbleWrap, item.mine ? s.right : s.left]}>
                  <PhotoBubble
                    testID={`message-${item.id}`}
                    photo={item.photo}
                    mine={item.mine}
                    serverOpened={voOpened[item.photo.id]}
                    onViewOnceOpened={() => markOpened(item)}
                  />
                  <Text style={s.time}>
                    {dayjs(item.at).format("h:mm A")} · {item.photo.vo ? "View once · " : ""}Encrypted photo{readMark(item)}
                  </Text>
                </View>
              ) : (
                <View testID={`message-${item.id}`} style={[s.bubbleWrap, item.mine ? s.right : s.left]}>
                  <View style={[s.bubble, item.mine ? s.bubbleMine : s.bubbleTheirs]}>
                    <Text style={[s.msg, item.kind !== "text" && s.undecryptable, item.mine && { color: colors.onBrandPrimary }]}>{item.text}</Text>
                  </View>
                  <Text style={s.time}>
                    {item.pending ? "Sending…" : dayjs(item.at).format("h:mm A")}
                    {item.legacy ? " · Legacy encryption" : ""}
                    {readMark(item)}
                  </Text>
                </View>
              )
            }
          />
        )}

        {typing ? (
          <Text testID="chat-typing" style={s.typing}>
            {other?.name} is typing…
          </Text>
        ) : null}

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

        {isSignal && status === "ready" && linkState === "pending" ? (
          <View style={s.waiting} testID="chat-device-pending">
            <Ionicons name="phone-portrait-outline" size={16} color={colors.warning} />
            <Text style={s.waitingText}>This device isn&apos;t linked yet. Approve it from one of your linked devices (Settings › Secure chat devices).</Text>
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
            <Pressable testID="chat-photo-button" onPress={pickPhoto} disabled={!canType || sending} style={[s.attach, !canType && { opacity: 0.4 }]} hitSlop={6}>
              <Ionicons name="image-outline" size={22} color={colors.brandPrimary} />
            </Pressable>
            <Pressable testID="chat-ai-button" onPress={() => setAiOpen(true)} disabled={!canType || !other} style={[s.attach, !canType && { opacity: 0.4 }]} hitSlop={6}>
              <Ionicons name="sparkles-outline" size={22} color={colors.brandPrimary} />
            </Pressable>
            <TextInput
              testID="chat-message-input"
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (v) sendTyping(matchId);
              }}
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
        <AiIdeasSheet visible={aiOpen} onClose={() => setAiOpen(false)} matchId={matchId} name={other.name} onPick={setText} />
      ) : null}

      {other ? (
        <SafetySheet visible={menu} onClose={() => setMenu(false)} userId={other.id} name={other.name} matchId={matchId} onDone={() => goBack("/chats")} />
      ) : null}

      <Sheet visible={!!pendingPhoto} onClose={() => setPendingPhoto(null)} title="Send encrypted photo" testID="photo-send-sheet">
        <Text style={s.sheetBody}>The photo is encrypted on this device before upload. Only {other?.name ?? "your match"} can open it.</Text>
        <Button testID="photo-send-normal" title="Send photo" icon="image-outline" onPress={() => sendPhoto(false)} />
        <Button testID="photo-send-view-once" title="Send as view-once" variant="secondary" icon="eye-outline" onPress={() => sendPhoto(true)} />
        <Button testID="photo-send-cancel" title="Cancel" variant="ghost" onPress={() => setPendingPhoto(null)} />
      </Sheet>

      <Sheet visible={photoPerm} onClose={() => setPhotoPerm(false)} title="Allow photo access" testID="photo-perm-sheet">
        <Text style={s.sheetBody}>To share a photo, allow BYTE TALKS to access your photos in Settings. Everything else in chat still works.</Text>
        <Button testID="photo-perm-settings" title="Open Settings" onPress={() => Linking.openSettings()} />
        <Button testID="photo-perm-close" title="Not now" variant="ghost" onPress={() => setPhotoPerm(false)} />
      </Sheet>

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
  attach: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  typing: { color: c.brandPrimary, fontSize: font.sm, fontStyle: "italic", marginHorizontal: spacing.lg, marginBottom: spacing.xs },
  sheetBody: { color: c.muted, fontSize: font.base, lineHeight: 20 },
  safetyBox: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  safetyLabel: { color: c.muted, fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  safetyNum: { color: c.brandPrimary, fontSize: font.lg, fontWeight: "700", letterSpacing: 1, fontVariant: ["tabular-nums"] },
}));
