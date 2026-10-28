// Encrypted chat photos. The photo is encrypted on this device with a fresh random key (XChaCha20-Poly1305).
// Only ciphertext is uploaded; the key + nonce travel inside the Signal-encrypted message.
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { encoding, type Base64 } from "@open-e2ee/signal-protocol-sdk";

import { api, ApiError, BASE, getApiToken } from "@/src/api";

const PREFIX = "\u0001bt-photo:";
export type PhotoMsg = { t: "photo"; id: string; k: string; n: string; w: number; h: number; vo: boolean; opened?: boolean };

export const isPhoto = (s: string) => s.startsWith(PREFIX);
export const encodePhoto = (p: PhotoMsg) => PREFIX + JSON.stringify(p);
export function decodePhoto(s: string): PhotoMsg | null {
  try {
    const p = JSON.parse(s.slice(PREFIX.length));
    return p?.t === "photo" && typeof p.id === "string" ? p : null;
  } catch {
    return null;
  }
}

async function readBytes(uri: string) {
  const res = Platform.OS === "web" ? await fetch(uri) : await expoFetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}

/** Encrypt + upload. Returns the payload to send through Signal. */
export async function uploadEncryptedPhoto(matchId: string, asset: { uri: string; width: number; height: number }, viewOnce: boolean): Promise<PhotoMsg> {
  const plain = await readBytes(asset.uri);
  if (plain.length > 10 * 1024 * 1024) throw new ApiError("Photo must be under 10 MB", 400);
  const key = Crypto.getRandomBytes(32);
  const nonce = Crypto.getRandomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(plain);
  const doFetch = Platform.OS === "web" ? fetch : (expoFetch as unknown as typeof fetch);
  const res = await doFetch(`${BASE}/api/matches/${matchId}/media?view_once=${viewOnce}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getApiToken() ?? ""}`, "Content-Type": "application/octet-stream" },
    body: ct as any,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(typeof data?.detail === "string" ? data.detail : "Photo upload failed", res.status);
  return { t: "photo", id: data.id, k: encoding.bytesToBase64(key), n: encoding.bytesToBase64(nonce), w: asset.width, h: asset.height, vo: viewOnce };
}

/** Download + decrypt to a data URI kept only in memory. Auth/integrity failures throw. */
export async function openEncryptedPhoto(p: PhotoMsg): Promise<string> {
  const doFetch = Platform.OS === "web" ? fetch : (expoFetch as unknown as typeof fetch);
  const res = await doFetch(`${BASE}/api/media/${p.id}`, { headers: { Authorization: `Bearer ${getApiToken() ?? ""}` } });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new ApiError(typeof d?.detail === "string" ? d.detail : "Photo unavailable", res.status);
  }
  const ct = new Uint8Array(await res.arrayBuffer());
  const plain = xchacha20poly1305(encoding.base64ToBytes(p.k as Base64), encoding.base64ToBytes(p.n as Base64)).decrypt(ct);
  return `data:image/jpeg;base64,${encoding.bytesToBase64(plain)}`;
}

export const mediaStatus = (matchId: string) => api<Record<string, boolean>>(`/matches/${matchId}/media-status`);
