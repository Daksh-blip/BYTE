import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Text } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

type Kind = "success" | "error" | "info";
const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: Kind; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const s = useStyles();
  const { colors } = useTheme();

  const show = useCallback((msg: string, kind: Kind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, kind, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const color = toast?.kind === "error" ? colors.error : toast?.kind === "success" ? colors.success : colors.brandPrimary;
  const icon = toast?.kind === "error" ? "alert-circle" : toast?.kind === "success" ? "checkmark-circle" : "information-circle";

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          key={toast.key}
          entering={FadeInUp}
          exiting={FadeOutUp}
          pointerEvents="none"
          style={[s.toast, { top: insets.top + spacing.sm, borderColor: color }]}
          testID="toast-message"
        >
          <Ionicons name={icon} size={20} color={color} />
          <Text style={s.text}>{toast.msg}</Text>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const useStyles = makeStyles((c) => ({
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  text: { color: c.onSurface, fontSize: font.base, flex: 1, fontWeight: "500" },
}));
