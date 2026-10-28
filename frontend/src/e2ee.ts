// LEGACY (read-only): NaCl box (X25519 + XSalsa20-Poly1305) chats from before the Signal upgrade.
// No new keys are created and nothing new is encrypted with it. Records keep protocol "nacl-box-v1".
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

import { storage } from "@/src/utils/storage";

const keyName = (uid: string) => `e2ee_sk_${uid}`;

function utf8Decode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += "%" + b[i].toString(16).padStart(2, "0");
  return decodeURIComponent(s);
}

let cached: { uid: string; pk: string; sk: Uint8Array } | null = null;

/** Load this device's legacy key pair if it has one. Never creates a key. */
export async function loadLegacyKeys(uid: string) {
  if (cached?.uid === uid) return;
  const stored = await storage.secureGet(keyName(uid), null as string | null);
  if (!stored) return;
  const kp = nacl.box.keyPair.fromSecretKey(naclUtil.decodeBase64(stored));
  cached = { uid, pk: naclUtil.encodeBase64(kp.publicKey), sk: kp.secretKey };
}

export function clearKeyCache() {
  cached = null;
}

/** Decrypt a legacy message through its original path only. Null when this device lacks the legacy key. */
export function decryptLegacy(
  msg: { ciphertext?: string; nonce?: string; sender_public_key?: string; recipient_public_key?: string },
  iAmSender: boolean,
): string | null {
  if (!cached || !msg.ciphertext || !msg.nonce || !msg.sender_public_key || !msg.recipient_public_key) return null;
  const mine = iAmSender ? msg.sender_public_key : msg.recipient_public_key;
  if (mine !== cached.pk) return null;
  const other = iAmSender ? msg.recipient_public_key : msg.sender_public_key;
  try {
    const out = nacl.box.open(naclUtil.decodeBase64(msg.ciphertext), naclUtil.decodeBase64(msg.nonce), naclUtil.decodeBase64(other), cached.sk);
    return out ? utf8Decode(out) : null;
  } catch {
    return null;
  }
}
