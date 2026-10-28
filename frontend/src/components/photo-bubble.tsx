import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";

import { openEncryptedPhoto, PhotoMsg } from "@/src/chat-photo";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

const memory = new Map<string, string>(); // decrypted normal photos, in memory only

type Props = { photo: PhotoMsg; mine: boolean; serverOpened?: boolean; testID: string; onViewOnceOpened: () => void };

export function PhotoBubble({ photo, mine, serverOpened, testID, onViewOnceOpened }: Props) {
  const s = useStyles();
  const { colors } = useTheme();
  const [uri, setUri] = useState<string | null>(memory.get(photo.id) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ratio = photo.w && photo.h ? Math.min(1.6, Math.max(0.6, photo.w / photo.h)) : 1;

  useEffect(() => {
    if (photo.vo || uri) return;
    openEncryptedPhoto(photo)
      .then((u) => {
        memory.set(photo.id, u);
        setUri(u);
      })
      .catch((e) => setErr(e.message));
  }, [photo, uri]);

  if (photo.vo) {
    const opened = photo.opened || serverOpened;
    const label = mine ? (opened ? "View-once photo · Opened" : "View-once photo · Not opened yet") : opened ? "View-once photo · Opened" : "View-once photo · Tap to open";
    const open = async () => {
      if (mine || opened || busy) return;
      setBusy(true);
      try {
        setFull(await openEncryptedPhoto(photo));
      } catch (e: any) {
        setErr(e.message);
        // Drop the key only when the server says it's gone (410) or not ours (403); keep it on network errors so the user can retry.
        if (e?.status === 410 || e?.status === 403) onViewOnceOpened();
      } finally {
        setBusy(false);
      }
    };
    return (
      <>
        <Pressable testID={testID} onPress={open} style={s.vo} disabled={mine || !!opened}>
          {busy ? <ActivityIndicator color={colors.brandPrimary} /> : <Ionicons name={opened ? "eye-off-outline" : "eye-outline"} size={18} color={colors.brandPrimary} />}
          <Text style={s.voText}>{err ?? label}</Text>
        </Pressable>
        <Modal visible={!!full} transparent animationType="fade" onRequestClose={() => setFull(null)}>
          <Pressable
            testID="view-once-viewer"
            style={s.viewer}
            onPress={() => {
              setFull(null); // the decrypted image is dropped from memory when closed
              onViewOnceOpened();
            }}
          >
            {full ? <Image source={{ uri: full }} style={s.full} contentFit="contain" /> : null}
            <Text style={s.hint}>Tap to close. This photo can&apos;t be opened again.</Text>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <Pressable testID={testID} onPress={() => uri && setFull(uri)} style={[s.photo, { aspectRatio: ratio }]}>
      {uri ? <Image source={{ uri }} style={s.img} contentFit="cover" /> : err ? <Text style={s.voText}>{err}</Text> : <ActivityIndicator color={colors.brandPrimary} />}
      <Modal visible={!!full} transparent animationType="fade" onRequestClose={() => setFull(null)}>
        <Pressable style={s.viewer} onPress={() => setFull(null)}>
          {full ? <Image source={{ uri: full }} style={s.full} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  photo: { width: 220, borderRadius: radius.md, overflow: "hidden", backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  img: { width: "100%", height: "100%" },
  vo: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 20, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border, minHeight: 44 },
  voText: { color: c.onSurfaceSecondary, fontSize: font.base, flexShrink: 1 },
  viewer: { flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.lg },
  full: { width: "100%", height: "80%" },
  hint: { color: c.muted, fontSize: font.sm },
}));
