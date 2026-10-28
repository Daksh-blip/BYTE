import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
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

/** Profile photo manager: add (system photo picker, no library permission), remove, set main photo. */
export function PhotoGrid() {
  const s = useStyles();
  const { colors } = useTheme();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
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

  // The system photo picker needs no photo-library permission: only the photo the user picks is shared.
  const onAdd = pick;

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
