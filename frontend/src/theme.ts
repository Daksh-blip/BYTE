// Design tokens for BYTE TALKS (dark midnight theme). Keys match the "color"
// block of /app/design_guidelines.json. Components import from here only.

import { useMemo } from "react";
import { Appearance, StyleSheet } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#0A0607",
  onSurface: "#F2F2F4",
  surfaceSecondary: "#170C0E",
  onSurfaceSecondary: "#EDE3E4",
  surfaceTertiary: "#251215",
  onSurfaceTertiary: "#D9C9CB",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#000000",
  muted: "#9A8587",

  brand: "#FF2D46",
  onBrand: "#FFFFFF",
  brandPrimary: "#FF2D46",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#9E1030",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FF6A4D",
  onBrandTertiary: "#FFFFFF",

  success: "#00FF9D",
  onSuccess: "#000000",
  warning: "#FFB800",
  onWarning: "#000000",
  error: "#FF5C7A",
  onError: "#FFFFFF",
  info: "#FF2D46",
  onInfo: "#FFFFFF",

  border: "#3A1D22",
  borderStrong: "#5A2A31",
  divider: "#22100F",

  // extras
  scrim: "rgba(10,6,7,0.92)",
  scrimClear: "rgba(10,6,7,0)",
  glass: "rgba(23,12,14,0.78)",
  overlay: "rgba(0,0,0,0.6)",
  brandPrimarySoft: "rgba(255,45,70,0.14)",
  brandSecondarySoft: "rgba(158,16,48,0.22)",
  brandTertiarySoft: "rgba(255,106,77,0.14)",
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
