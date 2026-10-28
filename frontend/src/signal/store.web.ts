// Web: AES-256-GCM encrypted IndexedDB store. Its key lives in the same origin (see SECURITY.md).
// The browser holds one store, so it is wiped when a different account signs in here.
import { indexedDbStore } from "@open-e2ee/signal-protocol-sdk/local/store/web";

import { storage } from "@/src/utils/storage";

export async function openStore(uid: string) {
  const s = await indexedDbStore();
  const owner = await storage.getItem("signal_store_owner", null as string | null);
  if (owner !== uid) {
    await s.clearAllKeys();
    await storage.setItem("signal_store_owner", uid);
  }
  return s;
}
