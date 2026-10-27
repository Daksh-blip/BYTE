// Design tokens for BYTE TALKS (dark midnight theme). Keys match the "color"
// block of /app/design_guidelines.json. Components import from here only.

import { useMemo } from "react";
import { Appearance, StyleSheet } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#090A0F",
  onSurface: "#F2F2F4",
  surfaceSecondary: "#151722",
  onSurfaceSecondary: "#E5E6EB",
  surfaceTertiary: "#212330",
  onSurfaceTertiary: "#D1D3DA",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#000000",
  muted: "#8B8D99",

  brand: "#00E5FF",
  onBrand: "#000000",
  brandPrimary: "#00E5FF",
  onBrandPrimary: "#000000",
  brandSecondary: "#B238FF",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FF4D94",
  onBrandTertiary: "#FFFFFF",

  success: "#00FF9D",
  onSuccess: "#000000",
  warning: "#FFB800",
  onWarning: "#000000",
  error: "#FF3366",
  onError: "#FFFFFF",
  info: "#00E5FF",
  onInfo: "#000000",

  border: "#2C2E3E",
  borderStrong: "#44475A",
  divider: "#1F212D",

  // extras
  scrim: "rgba(9,10,15,0.92)",
  scrimClear: "rgba(9,10,15,0)",
  glass: "rgba(21,23,34,0.78)",
  overlay: "rgba(0,0,0,0.6)",
  brandPrimarySoft: "rgba(0,229,255,0.12)",
  brandSecondarySoft: "rgba(178,56,255,0.14)",
  brandTertiarySoft: "rgba(255,77,148,0.14)",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark: ThemeColors } = { light: dark, dark };

export const colors = dark;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 8, md: 16, lg: 24, pill: 999 };
export const font = { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, display: 32 };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

// The app ships a single dark look; pin native chrome to dark.
setColorScheme?.("dark");

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  return { scheme: "dark", colors: dark };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors: c } = useTheme();
    return useMemo(() => StyleSheet.create(factory(c)), [c]);
  };
}
