// Signal Protocol session layer for BYTE TALKS (built on @open-e2ee/signal-protocol-sdk).
// The protocol runs only on this device. The server relays public prekeys and stores ciphertext.
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { createSignalProtocolClient, isUntrustedIdentityError, ProtocolAddress } from "@open-e2ee/signal-protocol-sdk";

import { api, MessageT, setSignalDevice } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { Cache, FAILED, loadCache, saveCache } from "./cache";
import { makeRelay } from "./relay";
import { openStore } from "./store";

export const SIGNAL = "signal-v1";
export type SignalStatus = "idle" | "starting" | "ready" | "unavailable" | "error";

export class SignalError extends Error {
  code: string;
  identity?: unknown;
  constructor(code: string, message: string, identity?: unknown) {
    super(message);
    this.code = code;
    this.identity = identity;
  }
}

// The SDK logs protocol diagnostics with key and session metadata. Drop them so nothing sensitive reaches logs.
const quiet = { debug() {}, info() {}, warn() {}, error() {}, breadcrumb() {} };

let state: { uid: string | null; client: any; device: string | null; status: SignalStatus } = {
  uid: null,
  client: null,
  device: null,
  status: "idle",
};
let starting: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (p: Partial<typeof state>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

export function useSignalStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.status,
  );
}

export const myDevice = () => state.device;

// Every session operation runs one at a time: ratchet state must never be advanced concurrently.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const call = <T,>(method: string, path: string, body?: unknown) => api<T>(path, { method, body });

async function buildClient(uid: string) {
  const devKey = `signal_dev_${uid}`;
  let store: any;
  try {
    store = await openStore(uid);
  } catch {
    // e.g. Expo Go has no SQLCipher. Fail closed: no weaker fallback store, no legacy sending.
    set({ status: "unavailable" });
    return;
  }
  let dev = await storage.getItem(devKey, null as string | null);
  if (dev) {
    const st = await api<{ active: boolean }>(`/signal/device-status?device=${dev}`);
    if (!st.active) {
      // This device was replaced or revoked: its old protocol state must not be reused.
      await store.clearAllKeys();
      dev = null;
      await storage.removeItem(devKey);
    }
  }
  setSignalDevice(dev);
  const onDevice = (id: string) => {
    dev = id;
    setSignalDevice(id);
    storage.setItem(devKey, id);
  };
  const make = () =>
    createSignalProtocolClient({ identity: { userId: uid }, adapters: { storage: store, relay: makeRelay(call, Platform.OS, onDevice) }, logger: quiet } as any);
  let client: any = await make();
  if (!dev) {
    // Store already had an identity the server doesn't know about: start clean so the server and device agree.
    await client.stop().catch(() => {});
    await store.clearAllKeys();
    client = await make();
  }
  if (!dev) throw new Error("Secure device registration failed");
  set({ client, device: dev, status: "ready" });
}

export function startSignal(uid: string) {
  if (state.uid === uid && (state.status === "ready" || starting)) return starting ?? Promise.resolve();
  set({ uid, status: "starting", client: null, device: null });
  starting = serial(() => buildClient(uid))
    .catch(() => {
      if (state.uid === uid) set({ status: "error" });
    })
    .finally(() => {
      starting = null;
    });
  return starting;
}

export async function stopSignal() {
  const c = state.client;
  set({ uid: null, client: null, device: null, status: "idle" });
  setSignalDevice(null);
  if (c) await c.stop().catch(() => {});
}

async function ready() {
  if (starting) await starting;
  if (state.status !== "ready" || !state.client) {
    throw new SignalError(state.status === "unavailable" ? "UNAVAILABLE" : "NOT_READY", unavailableText(state.status));
  }
  return state.client;
}

export function unavailableText(s: SignalStatus) {
  if (s === "unavailable") return "Secure chat needs the installed BYTE TALKS app. It can't run in Expo Go. Nothing is sent with weaker encryption.";
  if (s === "error") return "Secure chat couldn't start on this device. Check your connection and reopen the app.";
  return "Setting up secure chat on this device…";
}

const addr = (uid: string) => ProtocolAddress.create(uid, 1);
const peerKey = (peer: string) => `signal_peer_${state.uid}_${peer}`;

/** Returns the peer's device id after making sure a real Signal session to that exact device exists. */
async function ensureSession(client: any, peer: string): Promise<string> {
  const info = await api<{ device: string | null }>(`/signal/identity/${peer}`);
  if (!info.device) throw new SignalError("NO_SECURE_DEVICE", "Your match hasn't set up secure chat yet.");
  const known = await storage.getItem(peerKey(peer), null as string | null);
  if (known === info.device && (await client.hasSession(addr(peer)))) return info.device;
  const r = await api<{ device: string; bundle: any }>(`/signal/bundle/${peer}`, { method: "POST" });
  if (await client.hasSession(addr(peer))) await client.deleteSession(addr(peer));
  try {
    await client.establishSession(addr(peer), r.bundle);
  } catch (e) {
    if (isUntrustedIdentityError(e)) throw new SignalError("IDENTITY_CHANGED", "Security key changed", (e as any).identity);
    throw e;
  }
  await storage.setItem(peerKey(peer), r.device);
  return r.device;
}

export async function hasSessionWith(peer: string) {
  if (state.status !== "ready") return false;
  return state.client.hasSession(addr(peer)).catch(() => false);
}

export function sendSignal(matchId: string, peer: string, text: string) {
  return serial(async () => {
    const client = await ready();
    const device = await ensureSession(client, peer);
    const ciphertext = await client.encryptMessage(addr(peer), text);
    const m = await api<MessageT>(`/matches/${matchId}/messages`, {
      method: "POST",
      body: { protocol: SIGNAL, ciphertext, recipient_device: device },
    });
    // Our own sent message can't be decrypted later (forward secrecy), so keep the plaintext locally.
    const cache = await loadCache(state.uid!, matchId);
    cache[m.id] = text;
    await saveCache(state.uid!, matchId, cache);
    return m;
  });
}

/** Decrypt new incoming Signal messages for this device, in server order. Returns the device-local plaintext map. */
export function readSignal(matchId: string, peer: string, msgs: MessageT[]): Promise<{ cache: Cache; identityChanged?: unknown }> {
  return serial(async () => {
    const uid = state.uid;
    if (!uid) return { cache: {} };
    const cache = await loadCache(uid, matchId);
    if (state.status !== "ready") return { cache };
    let changed = false;
    let identityChanged: unknown;
    for (const m of msgs) {
      if (m.protocol !== SIGNAL || m.sender_id !== peer || m.recipient_device !== state.device || m.id in cache) continue;
      try {
        cache[m.id] = await state.client.decryptMessage(addr(peer), m.ciphertext);
        await storage.setItem(peerKey(peer), m.sender_device ?? null);
      } catch (e) {
        if (isUntrustedIdentityError(e)) {
          identityChanged = (e as any).identity;
          break; // keep it pending until the user reviews the new key
        }
        cache[m.id] = FAILED; // tampered, replayed or undecryptable: never retried, never shown as text
      }
      changed = true;
      await saveCache(uid, matchId, cache); // persist after every message: the ratchet has already moved
    }
    if (changed) await saveCache(uid, matchId, cache);
    return { cache, identityChanged };
  });
}

export function acceptNewIdentity(peer: string, identity: unknown) {
  return serial(async () => {
    const client = await ready();
    await client.acceptIdentityRotation(peer, identity);
    await storage.removeItem(peerKey(peer));
  });
}

export async function safetyNumber(peer: string) {
  const client = await ready();
  return serial(() => client.verify(peer)) as Promise<{ numeric: string; trustState: string | null; confirmation: unknown }>;
}

export async function confirmSafetyNumber(confirmation: unknown) {
  const client = await ready();
  return serial(() => client.confirmSafetyNumber(confirmation));
}
