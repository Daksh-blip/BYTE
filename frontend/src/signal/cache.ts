// Device-local message history. Signal deletes message keys after decrypting, so each plaintext is kept here,
// encrypted with XChaCha20-Poly1305 under a random key in secure storage. It never goes to the server.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { encoding, type Base64 } from "@open-e2ee/signal-protocol-sdk";
import * as Crypto from "expo-crypto";

import { storage } from "@/src/utils/storage";

export const FAILED = "\u0000failed"; // a message that failed authentication or was already used
export type Cache = Record<string, string>;

const keys = new Map<string, Uint8Array>();

async function key(uid: string) {
  const hit = keys.get(uid);
  if (hit) return hit;
  const name = `msgkey_${uid}`;
  const stored = await storage.secureGet(name, null as string | null);
  let k: Uint8Array;
  if (stored) k = encoding.base64ToBytes(stored as Base64);
  else {
    k = Crypto.getRandomBytes(32);
    await storage.secureSet(name, encoding.bytesToBase64(k));
  }
  keys.set(uid, k);
  return k;
}

export async function loadCache(uid: string, matchId: string): Promise<Cache> {
  const raw = await storage.getItem(`msgcache_${uid}_${matchId}`, null as string | null);
  if (!raw) return {};
  try {
    const all = encoding.base64ToBytes(raw as Base64);
    const out = xchacha20poly1305(await key(uid), all.slice(0, 24)).decrypt(all.slice(24));
    return JSON.parse(encoding.bytesToString(out));
  } catch {
    return {};
  }
}

export async function saveCache(uid: string, matchId: string, cache: Cache) {
  const nonce = Crypto.getRandomBytes(24);
  const ct = xchacha20poly1305(await key(uid), nonce).encrypt(encoding.stringToBytes(JSON.stringify(cache)));
  const all = new Uint8Array(24 + ct.length);
  all.set(nonce);
  all.set(ct, 24);
  await storage.setItem(`msgcache_${uid}_${matchId}`, encoding.bytesToBase64(all));
}

export function clearCacheKeys() {
  keys.clear();
}
