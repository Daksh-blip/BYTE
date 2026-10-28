import { router } from "expo-router";

import { uploadForm, LocalFile } from "@/src/utils/upload";

export const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

let token: string | null = null;
let mediaToken: string | null = null;
let redirecting = false;
let onUnauthorized: (() => void) | null = null;
export const setApiToken = (t: string | null) => {
  token = t;
  if (!t) mediaToken = null;
};
export const getApiToken = () => token;
export const setMediaToken = (t: string | null) => {
  mediaToken = t;
};
let signalDevice: string | null = null;
/** This device's Signal device record; sent so the server can bind relay calls to the right device. */
export const setSignalDevice = (d: string | null) => {
  signalDevice = d;
};
/** Called when a request that carried a session token gets 401 (session revoked, e.g. password changed elsewhere). */
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function errorMessage(data: any): string {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, "");
  return "Something went wrong. Please try again.";
}

async function parse(res: Response | any, sentToken: string | null = null) {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    // Only react if the token that failed is still the current one (a newer login may have replaced it).
    if (res.status === 401 && sentToken && sentToken === token) onUnauthorized?.();
    if (res.status === 403 && data?.detail === "ACCOUNT_RESTRICTED" && !redirecting) {
      redirecting = true;
      setTimeout(() => {
        try {
          router.replace("/restricted");
        } catch {
          // navigator not ready yet; the index route redirects restricted users on next load
        }
        redirecting = false;
      }, 0);
    }
    throw new ApiError(errorMessage(data), res.status);
  }
  return data;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  const sent = token;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(sent ? { Authorization: `Bearer ${sent}` } : {}),
        ...(signalDevice ? { "X-Signal-Device": signalDevice } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("You're offline. Check your connection and try again.", 0);
  }
  return parse(res, sent);
}

export async function uploadPhoto(file: LocalFile) {
  const sent = token;
  const res = await uploadForm(`${BASE}/api/me/photos`, {
    headers: sent ? { Authorization: `Bearer ${sent}` } : {},
    files: { file },
  });
  return parse(res, sent);
}

export function photoSource(url?: string | null) {
  if (!url) return undefined;
  if (url.startsWith("/api")) {
    // The URL carries only a short-lived, photo-only media token; the session token goes in a header (native).
    return { uri: `${BASE}${url}?token=${mediaToken ?? ""}`, headers: { Authorization: `Bearer ${token ?? ""}` } };
  }
  return { uri: url };
}

export type PhotoT = { id: string; url: string };
export type Profile = {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  bio: string;
  job: string;
  city: string;
  interests: string[];
  photos: PhotoT[];
  photo_verified: boolean;
  public_key: string | null;
  intention: string | null;
  pronouns: string;
  languages: string[];
  prompts: { question: string; answer: string }[];
  is_demo: boolean;
  compatibility?: { score: number; reasons: string[]; shared_interests: string[] };
  superlike?: boolean;
  note?: string;
};
export type Me = Profile & {
  email: string;
  dob: string | null;
  interested_in: string[];
  onboarded: boolean;
  paused: boolean;
  age_min: number;
  age_max: number;
  verified: boolean;
  role: "user" | "admin";
  status: "active" | "warned" | "suspended" | "banned";
  status_reason: string;
  suspended_until: string | null;
};
export type MatchT = {
  id: string;
  user: Profile;
  created_at: string;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread: number;
};
export type MessageT = {
  id: string;
  sender_id: string;
  protocol: "nacl-box-v1" | "signal-v1" | "system";
  created_at: string;
  ciphertext?: string;
  // legacy nacl-box-v1
  nonce?: string;
  sender_public_key?: string;
  recipient_public_key?: string;
  // signal-v1 routing (set by the server)
  sender_device?: string;
  recipient_device?: string;
  // system events
  kind?: string;
};
