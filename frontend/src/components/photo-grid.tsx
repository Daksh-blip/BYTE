import React, { useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, Me, photoSource, uploadPhoto } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Sheet } from "@/src/components/sheet";
import { Button } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

const SLOTS = 6;

/** Profile photo manager: add (with permission handling), remove, set main photo. */
export function PhotoGrid() {
  const s = useStyles();
  const { colors } = useTheme();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [perm, setPerm] = useState<"explain" | "blocked" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const photos = user?.photos ?? [];

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [3, 4], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setUploading(true);
    try {
      const me = await uploadPhoto({ uri: a.uri, name: a.fileName ?? "photo.jpg", mimeType: a.mimeType ?? "image/jpeg" });
      setUser(me as Me);
      toast("Photo added", "success");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const onAdd = async () => {
    if (Platform.OS === "web") return pick();
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (current.granted) return pick();
    if (!current.canAskAgain) return setPerm("blocked");
    setPerm("explain");
  };

  const requestAndPick = async () => {
    const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (r.granted) {
      setPerm(null);
      pick();
    } else setPerm("blocked");
  };

  const act = async (fn: () => Promise<Me>) => {
    try {
      setUser(await fn());
    } catch (e: any) {
      toast(e.message, "error");
    }
    setSelected(null);
  };

  return (
    <View>
      <View style={s.grid}>
        {Array.from({ length: SLOTS }).map((_, i) => {
          const p = photos[i];
          if (p) {
            return (
              <Pressable key={p.id} testID={`photo-slot-${i}`} style={s.slot} onPress={() => setSelected(p.id)}>
                <Image source={photoSource(p.url)} style={s.img} contentFit="cover" transition={200} />
                {i === 0 ? (
                  <View style={s.mainBadge}>
                    <Text style={s.mainText}>Main</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }
          const isNext = i === photos.length;
          return (
            <Pressable
              key={`empty-${i}`}
              testID={`photo-add-${i}`}
              style={[s.slot, s.emptySlot, isNext && { borderColor: colors.brandPrimary }]}
              onPress={onAdd}
              disabled={uploading}
            >
              {uploading && isNext ? (
                <ActivityIndicator color={colors.brandPrimary} />
              ) : (
                <Ionicons name="add" size={28} color={isNext ? colors.brandPrimary : colors.muted} />
              )}
            </Pressable>
          );
        })}
      </View>

      <Sheet visible={perm === "explain"} onClose={() => setPerm(null)} title="Add your best photos" testID="photo-permission-sheet">
        <Text style={s.body}>BYTE TALKS needs access to your photos so you can pick pictures for your profile. We only upload the ones you choose.</Text>
        <Button testID="photo-permission-continue" title="Continue" onPress={requestAndPick} />
        <Button testID="photo-permission-later" title="Not now" variant="ghost" onPress={() => setPerm(null)} />
      </Sheet>

      <Sheet visible={perm === "blocked"} onClose={() => setPerm(null)} title="Photo access is off" testID="photo-blocked-sheet">
        <Text style={s.body}>To add profile photos, allow photo access for BYTE TALKS in your device settings.</Text>
        <Button
          testID="photo-open-settings"
          title="Open Settings"
          onPress={() => {
            setPerm(null);
            Linking.openSettings();
          }}
        />
        <Button testID="photo-blocked-close" title="Not now" variant="ghost" onPress={() => setPerm(null)} />
      </Sheet>

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title="Photo" testID="photo-actions-sheet">
        {selected && photos[0]?.id !== selected ? (
          <Button
            testID="photo-make-main"
            title="Make main photo"
            variant="secondary"
            onPress={() => act(() => api<Me>(`/me/photos/${selected}/primary`, { method: "PUT" }))}
          />
        ) : null}
        <Button
          testID="photo-delete"
          title="Remove photo"
          variant="danger"
          onPress={() => act(() => api<Me>(`/me/photos/${selected}`, { method: "DELETE" }))}
        />
        <Button testID="photo-actions-cancel" title="Cancel" variant="ghost" onPress={() => setSelected(null)} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  slot: { width: "31.5%", aspectRatio: 3 / 4, borderRadius: radius.md, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  emptySlot: { borderWidth: 1.5, borderStyle: "dashed", borderColor: c.border, alignItems: "center", justifyContent: "center" },
  img: { width: "100%", height: "100%" },
  mainBadge: {
    position: "absolute",
    left: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: c.brandPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  mainText: { color: c.onBrandPrimary, fontSize: font.sm, fontWeight: "700" },
  body: { color: c.muted, fontSize: font.base, lineHeight: 20 },
}));
