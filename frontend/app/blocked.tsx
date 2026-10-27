import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, photoSource } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { EmptyState } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Blocked = { id: string; name: string; photo: string | null };

export default function BlockedPeople() {
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Blocked[] | null>(null);

  const load = useCallback(() => {
    api<Blocked[]>("/blocks")
      .then(setItems)
      .catch((e) => {
        toast(e.message, "error");
        setItems([]);
      });
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const unblock = async (b: Blocked) => {
    try {
      await api(`/blocks/${b.id}`, { method: "DELETE" });
      setItems((x) => (x ?? []).filter((i) => i.id !== b.id));
      toast(`${b.name} is unblocked`, "success");
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  return (
    <View style={s.root} testID="blocked-screen">
      <ScreenHeader title="Blocked people" />
      {items === null ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          contentContainerStyle={[{ padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }, !items.length && { flex: 1 }]}
          ListEmptyComponent={<EmptyState testID="blocked-empty" icon="shield-outline" title="No one blocked" body="People you block won't see your profile or be able to message you." />}
          renderItem={({ item }) => (
            <View style={s.row} testID={`blocked-row-${item.id}`}>
              <Image source={photoSource(item.photo)} style={s.avatar} contentFit="cover" />
              <Text style={s.name}>{item.name}</Text>
              <Pressable testID={`unblock-${item.id}`} style={s.btn} onPress={() => unblock(item)}>
                <Text style={s.btnText}>Unblock</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surfaceTertiary },
  name: { flex: 1, color: c.onSurface, fontSize: font.lg, fontWeight: "600" },
  btn: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.borderStrong, justifyContent: "center" },
  btnText: { color: c.onSurface, fontWeight: "600" },
}));
