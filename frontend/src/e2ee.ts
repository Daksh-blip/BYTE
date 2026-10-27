// End-to-end encryption with NaCl box (X25519 + XSalsa20-Poly1305).
// The secret key never leaves this device; the server only stores ciphertext.
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import * as Crypto from "expo-crypto";

import { storage } from "@/src/utils/storage";

nacl.setPRNG((x: Uint8Array, n: number) => {
  const bytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i++) x[i] = bytes[i];
});

const keyName = (uid: string) => `e2ee_sk_${uid}`;

function utf8Encode(str: string): Uint8Array {
  const s = encodeURIComponent(str);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "%") {
      out.push(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else out.push(s.charCodeAt(i));
  }
  return new Uint8Array(out);
}

function utf8Decode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += "%" + b[i].toString(16).padStart(2, "0");
  return decodeURIComponent(s);
}

let cached: { uid: string; pk: string; sk: Uint8Array } | null = null;

/** Load this device's key pair for the user, creating one if needed. Returns the public key (base64). */
export async function loadOrCreateKeys(uid: string): Promise<string> {
  if (cached?.uid === uid) return cached.pk;
  const stored = await storage.secureGet(keyName(uid), null as string | null);
  let kp: nacl.BoxKeyPair;
  if (stored) {
    kp = nacl.box.keyPair.fromSecretKey(naclUtil.decodeBase64(stored));
  } else {
    kp = nacl.box.keyPair();
    await storage.secureSet(keyName(uid), naclUtil.encodeBase64(kp.secretKey));
  }
  cached = { uid, pk: naclUtil.encodeBase64(kp.publicKey), sk: kp.secretKey };
  return cached.pk;
}

export function clearKeyCache() {
  cached = null;
}

export function myPublicKey() {
  return cached?.pk ?? null;
}

export function encrypt(text: string, theirPublicKey: string) {
  if (!cached) throw new Error("Keys not loaded");
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(utf8Encode(text), nonce, naclUtil.decodeBase64(theirPublicKey), cached.sk);
  return {
    ciphertext: naclUtil.encodeBase64(box),
    nonce: naclUtil.encodeBase64(nonce),
    sender_public_key: cached.pk,
    recipient_public_key: theirPublicKey,
  };
}

/** Decrypt a message. Returns null if this device cannot read it (e.g. sent to an older key). */
export function decrypt(
  msg: { ciphertext: string; nonce: string; sender_public_key: string; recipient_public_key: string },
  iAmSender: boolean,
): string | null {
  if (!cached) return null;
  const mine = iAmSender ? msg.sender_public_key : msg.recipient_public_key;
  if (mine !== cached.pk) return null;
  const other = iAmSender ? msg.recipient_public_key : msg.sender_public_key;
  try {
    const out = nacl.box.open(
      naclUtil.decodeBase64(msg.ciphertext),
      naclUtil.decodeBase64(msg.nonce),
      naclUtil.decodeBase64(other),
      cached.sk,
    );
    return out ? utf8Decode(out) : null;
  } catch {
    return null;
  }
}

/** Short safety number both people can compare to confirm the chat is private. */
export function safetyNumber(a: string, b: string) {
  const [x, y] = [a, b].sort();
  const h = nacl.hash(utf8Encode(x + y));
  const digits = Array.from(h.slice(0, 12)).map((n) => String(n % 100).padStart(2, "0"));
  return digits.join("").match(/.{1,6}/g)!.join(" ");
}
