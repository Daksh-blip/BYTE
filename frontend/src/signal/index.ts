// Signal Protocol session layer for BYTE TALKS (built on @open-e2ee/signal-protocol-sdk).
// The protocol runs only on this device. The server relays public prekeys and stores ciphertext.
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { createSignalProtocolClient, isUntrustedIdentityError, ProtocolAddress } from "@open-e2ee/signal-protocol-sdk";
import * as Crypto from "expo-crypto";

import { api, MessageT, setSignalDevice } from "@/src/api";
import { onLive } from "@/src/live";
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

let state: { uid: string | null; client: any; device: string | null; status: SignalStatus; linked: "active" | "pending" | null; code: string | null } = {
  uid: null,
  client: null,
  device: null,
  status: "idle",
  linked: null,
  code: null,
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

/** Link state of this device: "pending" until an already-linked device approves it with `code`. */
export function useLinkState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.linked,
  );
}
export const linkCode = () => state.code;

async function refreshLink() {
  if (!state.device) return;
  const st = await api<{ active: boolean; pending: boolean }>(`/signal/device-status?device=${state.device}`);
  set({ linked: st.active ? "active" : st.pending ? "pending" : null, code: st.active ? null : state.code });
  if (st.active) pullSync().catch(() => {});
}
export const recheckLink = () => refreshLink().catch(() => {});

// History from a linked device arrives as an encrypted transfer; a pending device polls for approval.
onLive((e) => {
  if (e.type === "sync" || e.type === "ready") recheckLink();
});
setInterval(() => {
  if (state.linked === "pending") recheckLink();
}, 5000);

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
  // Stable random address for this install: "<uid>.<16 hex>". A new one means a fresh protocol store.
  const localKey = `signal_local_${uid}`;
  let local = await storage.getItem(localKey, null as string | null);
  if (!local) {
    local = Array.from(Crypto.getRandomBytes(8), (b) => b.toString(16).padStart(2, "0")).join("");
    await store.clearAllKeys();
    dev = null;
    await storage.removeItem(devKey);
    await storage.setItem(localKey, local);
  }
  const sigUid = `${uid}.${local}`;
  let linked: "active" | "pending" | null = null;
  let code: string | null = await storage.getItem(`signal_code_${uid}`, null as string | null);
  if (dev) {
    const st = await api<{ active: boolean; pending: boolean }>(`/signal/device-status?device=${dev}`);
    linked = st.active ? "active" : st.pending ? "pending" : null;
    if (!linked) {
      // This device was replaced or revoked: its old protocol state must not be reused.
      await store.clearAllKeys();
      dev = null;
      await storage.removeItem(devKey);
    }
  }
  setSignalDevice(dev);
  const onDevice = (id: string, status: string, c: string | null) => {
    dev = id;
    linked = status === "active" ? "active" : "pending";
    code = c;
    setSignalDevice(id);
    storage.setItem(devKey, id);
    storage.setItem(`signal_code_${uid}`, c);
  };
  const make = () =>
    createSignalProtocolClient({ identity: { userId: sigUid }, adapters: { storage: store, relay: makeRelay(call, Platform.OS, sigUid, onDevice) }, logger: quiet } as any);
  let client: any = await make();
  if (!dev) {
    // Store already had an identity the server doesn't know about: start clean so the server and device agree.
    await client.stop().catch(() => {});
    await store.clearAllKeys();
    client = await make();
  }
  if (!dev) throw new Error("Secure device registration failed");
  set({ client, device: dev, status: "ready", linked, code: linked === "pending" ? code : null });
  if (linked === "active") pullSync().catch(() => {});
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

const addr = (sig: string) => ProtocolAddress.create(sig, 1);
type Dev = { device: string; sig_uid: string };

/** Make sure a real Signal session exists to every active device of `peer` and to my own other devices. */
async function ensureSessions(client: any, peer: string): Promise<Dev[]> {
  const theirs = (await api<{ devices: Dev[] }>(`/signal/identity/${peer}`)).devices;
  if (!theirs.length) throw new SignalError("NO_SECURE_DEVICE", "Your match hasn't set up secure chat yet.");
  const mine = (await api<{ devices: Dev[] }>(`/signal/identity/${state.uid}`)).devices.filter((d) => d.device !== state.device);
  const targets = [...theirs.map((d) => ({ ...d, user: peer })), ...mine.map((d) => ({ ...d, user: state.uid! }))];
  for (const t of targets) {
    if (await client.hasSession(addr(t.sig_uid))) continue;
    const r = await api<{ device: string; bundle: any }>(`/signal/bundle/${t.user}?device=${t.device}`, { method: "POST" });
    try {
      await client.establishSession(addr(t.sig_uid), r.bundle);
    } catch (e) {
      if (isUntrustedIdentityError(e)) throw new SignalError("IDENTITY_CHANGED", "Security key changed", { sig: t.sig_uid, identity: (e as any).identity });
      throw e;
    }
  }
  return targets;
}

export async function hasSessionWith(peer: string) {
  if (state.status !== "ready") return false;
  const devs = (await api<{ devices: Dev[] }>(`/signal/identity/${peer}`).catch(() => ({ devices: [] as Dev[] }))).devices;
  for (const d of devs) if (await state.client.hasSession(addr(d.sig_uid)).catch(() => false)) return true;
  return false;
}

/** Number of secure devices the peer has, so the UI can say "Leo added a device". */
export async function peerDeviceCount(peer: string) {
  return (await api<{ devices: Dev[] }>(`/signal/identity/${peer}`)).devices.length;
}

export function sendSignal(matchId: string, peer: string, text: string) {
  return serial(async () => {
    const client = await ready();
    if (state.linked !== "active") throw new SignalError("NOT_LINKED", "Approve this device from one of your linked devices first.");
    for (let attempt = 0; ; attempt++) {
      const targets = await ensureSessions(client, peer);
      const ciphertexts: Record<string, string> = {};
      for (const t of targets) ciphertexts[t.device] = await client.encryptMessage(addr(t.sig_uid), text);
      try {
        const m = await api<MessageT>(`/matches/${matchId}/messages`, { method: "POST", body: { protocol: SIGNAL, ciphertexts } });
        // Our own sent message can't be decrypted later (forward secrecy), so keep the plaintext locally.
        const cache = await loadCache(state.uid!, matchId);
        cache[m.id] = text;
        await saveCache(state.uid!, matchId, cache);
        return m;
      } catch (e: any) {
        if (e?.message !== "DEVICE_SET_CHANGED" || attempt > 0) throw e; // a device was added/removed: refresh once
      }
    }
  });
}

/** Decrypt new Signal messages addressed to this device, in server order. Returns the device-local plaintext map. */
export function readSignal(matchId: string, _peer: string, msgs: MessageT[]): Promise<{ cache: Cache; identityChanged?: unknown }> {
  return serial(async () => {
    const uid = state.uid;
    if (!uid) return { cache: {} };
    const cache = await loadCache(uid, matchId);
    if (state.status !== "ready") return { cache };
    let identityChanged: unknown;
    for (const m of msgs) {
      if (m.protocol !== SIGNAL || !m.ciphertext || !m.sender_sig || m.id in cache) continue;
      try {
        cache[m.id] = await state.client.decryptMessage(addr(m.sender_sig), m.ciphertext);
      } catch (e) {
        if (isUntrustedIdentityError(e)) {
          identityChanged = { sig: m.sender_sig, identity: (e as any).identity };
          break; // keep it pending until the user reviews the new key
        }
        cache[m.id] = FAILED; // tampered, replayed or undecryptable: never retried, never shown as text
      }
      await saveCache(uid, matchId, cache); // persist after every message: the ratchet has already moved
    }
    return { cache, identityChanged };
  });
}

// ---- device linking: approval by code + Signal-encrypted history transfer to the new device
export function approveDevice(deviceId: string, code: string) {
  return serial(async () => {
    const client = await ready();
    const r = await api<{ sig_uid: string }>(`/signal/devices/${deviceId}/approve`, { method: "POST", body: { code } });
    const b = await api<{ bundle: any }>(`/signal/bundle/${state.uid}?device=${deviceId}`, { method: "POST" });
    if (!(await client.hasSession(addr(r.sig_uid)))) await client.establishSession(addr(r.sig_uid), b.bundle);
    const matches = await api<{ id: string }[]>("/matches");
    for (const mt of matches) {
      const cache = await loadCache(state.uid!, mt.id);
      const entries = Object.fromEntries(Object.entries(cache).filter(([, v]) => v !== FAILED));
      if (!Object.keys(entries).length) continue;
      const ciphertext = await client.encryptMessage(addr(r.sig_uid), JSON.stringify({ t: "sync", match: mt.id, entries }));
      await api("/signal/sync", { method: "POST", body: { device: deviceId, ciphertext } });
    }
  });
}

export function pullSync() {
  return serial(async () => {
    if (state.status !== "ready" || state.linked !== "active") return;
    const items = await api<{ from_sig: string; ciphertext: string }[]>("/signal/sync");
    for (const it of items) {
      try {
        const p = JSON.parse(await state.client.decryptMessage(addr(it.from_sig), it.ciphertext));
        if (p?.t !== "sync" || typeof p.match !== "string") continue;
        const cache = await loadCache(state.uid!, p.match);
        for (const [k, v] of Object.entries(p.entries ?? {})) if (!(k in cache) && typeof v === "string") cache[k] = v;
        await saveCache(state.uid!, p.match, cache);
      } catch {
        // undecryptable transfer chunks are dropped; they were never readable by the server
      }
    }
  });
}

export async function takeoverDevices(password: string) {
  await api("/signal/takeover", { method: "POST", body: { password } });
  await refreshLink();
}

/** Replace a cached plaintext, e.g. drop a view-once photo's key after it was opened. */
export function updateCached(matchId: string, msgId: string, value: string) {
  return serial(async () => {
    if (!state.uid) return;
    const cache = await loadCache(state.uid, matchId);
    cache[msgId] = value;
    await saveCache(state.uid, matchId, cache);
  });
}

export function acceptNewIdentity(peer: string, identity: unknown) {
  return serial(async () => {
    const client = await ready();
    const x = identity as { sig: string; identity: unknown };
    await client.acceptIdentityRotation(x.sig, x.identity);
    if (await client.hasSession(addr(x.sig))) await client.deleteSession(addr(x.sig));
  });
}

export async function safetyNumber(peer: string) {
  const client = await ready();
  const devs = (await api<{ devices: Dev[] }>(`/signal/identity/${peer}`)).devices;
  if (!devs.length) throw new SignalError("NO_SECURE_DEVICE", "No secure device");
  return serial(() => client.verify(devs[0].sig_uid)) as Promise<{ numeric: string; trustState: string | null; confirmation: unknown }>;
}

export async function confirmSafetyNumber(confirmation: unknown) {
  const client = await ready();
  return serial(() => client.confirmSafetyNumber(confirmation));
}
