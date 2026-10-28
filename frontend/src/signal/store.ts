// Native: SQLCipher database owned by the SDK, key in the Keychain/Keystore. Needs a dev/release build (not Expo Go).
import { expoStore } from "@open-e2ee/signal-protocol-sdk/local/store/expo";

export async function openStore(uid: string) {
  return expoStore({ name: `bytetalks-signal-${uid}.db` });
}
