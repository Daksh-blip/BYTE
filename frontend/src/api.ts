import { uploadForm, LocalFile } from "@/src/utils/upload";

export const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

let token: string | null = null;
export const setApiToken = (t: string | null) => {
  token = t;
};
export const getApiToken = () => token;

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

async function parse(res: Response | any) {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(errorMessage(data), res.status);
  return data;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("You're offline. Check your connection and try again.", 0);
  }
  return parse(res);
}

export async function uploadPhoto(file: LocalFile) {
  const res = await uploadForm(`${BASE}/api/me/photos`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    files: { file },
  });
  return parse(res);
}

export function photoSource(url?: string | null) {
  if (!url) return undefined;
  if (url.startsWith("/api")) {
    return { uri: `${BASE}${url}?token=${token ?? ""}`, headers: { Authorization: `Bearer ${token ?? ""}` } };
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
  ciphertext: string;
  nonce: string;
  sender_public_key: string;
  recipient_public_key: string;
  created_at: string;
};
