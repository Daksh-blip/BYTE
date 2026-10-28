import { storage } from "@/src/utils/storage";

/** Daily like / super-like allowances, counted on this device (Premium gating is client-side by design). */
export const LIMITS = { free: { like: 25, superlike: 1 }, premium: { like: Infinity, superlike: 5 } };

const key = (kind: string) => `daily_${kind}_${new Date().toISOString().slice(0, 10)}`;

export async function usedToday(kind: "like" | "superlike") {
  return (await storage.getItem(key(kind), 0)) ?? 0;
}

export async function recordUse(kind: "like" | "superlike") {
  await storage.setItem(key(kind), (await usedToday(kind)) + 1);
}
