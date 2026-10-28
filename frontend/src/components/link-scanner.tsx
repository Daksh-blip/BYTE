import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

export const LINK_PREFIX = "bytetalks-link:v1:";

export const linkPayload = (deviceId: string, code: string) => `${LINK_PREFIX}${deviceId}:${code}`;

function parse(data: string): { deviceId: string; code: string } | null {
  if (!data.startsWith(LINK_PREFIX)) return null;
  const [deviceId, code] = data.slice(LINK_PREFIX.length).split(":");
  return /^[a-f0-9]{24}$/.test(deviceId ?? "") && /^\d{6}$/.test(code ?? "") ? { deviceId, code } : null;
}

type Props = { visible: boolean; onClose: () => void; onScanned: (deviceId: string, code: string) => Promise<void> };

/** Scans the QR code shown on a new device and approves it. */
export function LinkScanner({ visible, onClose, onScanned }: Props) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lock = useRef(false);

  const onCode = async ({ data }: { data: string }) => {
    if (lock.current) return;
    const p = parse(data);
    if (!p) return setErr("That isn't a BYTE TALKS link code.");
    lock.current = true;
    setBusy(true);
    setErr(null);
    try {
      await onScanned(p.deviceId, p.code);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setTimeout(() => (lock.current = false), 1500);
    }
  };

  const body = () => {
    if (!perm) return <ActivityIndicator color={colors.brandPrimary} />;
    if (!perm.granted) {
      return (
        <View testID="link-scanner-permission" style={s.permBox}>
          <Ionicons name="qr-code-outline" size={40} color={colors.brandPrimary} />
          <Text style={s.title}>Scan to link a device</Text>
          <Text style={s.sub}>Allow the camera to scan the code on your new device. Nothing is recorded or uploaded.</Text>
          {perm.canAskAgain ? (
            <Button testID="link-scanner-allow" title="Allow camera" icon="camera-outline" onPress={requestPerm} />
          ) : (
            <>
              <Text style={s.sub}>Camera access is turned off for BYTE TALKS. You can turn it on in Settings, or type the 6-digit code instead.</Text>
              <Button testID="link-scanner-settings" title="Open Settings" icon="settings-outline" onPress={() => Linking.openSettings()} />
            </>
          )}
        </View>
      );
    }
    return (
      <View style={s.camWrap}>
        <CameraView testID="link-scanner-camera" style={s.cam} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={busy ? undefined : onCode} />
        <View pointerEvents="none" style={s.frame} />
        {busy ? (
          <View style={s.busy}>
            <ActivityIndicator color={colors.brandPrimary} />
            <Text style={s.sub}>Linking device…</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="link-scanner" style={[s.root, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={s.header}>
          <Text style={s.title}>Scan code</Text>
          <Pressable testID="link-scanner-close" onPress={onClose} hitSlop={12} style={s.close}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
        <Text style={s.sub}>On the new device, open Settings › Secure chat devices. Point your camera at the code it shows.</Text>
        {body()}
        {err ? (
          <Text testID="link-scanner-error" style={s.err}>
            {err}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface, paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: c.onSurface, fontSize: font.xl, fontWeight: "700" },
  sub: { color: c.muted, fontSize: font.base, lineHeight: 20, textAlign: "center" },
  permBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.lg },
  camWrap: { width: "100%", aspectRatio: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.surfaceSecondary, alignSelf: "center" },
  cam: { flex: 1 },
  frame: { position: "absolute", top: "15%", left: "15%", right: "15%", bottom: "15%", borderWidth: 3, borderColor: c.brandPrimary, borderRadius: radius.md },
  busy: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: c.surface },
  err: { color: c.error, fontSize: font.base, textAlign: "center" },
}));
