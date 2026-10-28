// Live delivery over one WebSocket per signed-in device. Events carry no message content:
// "message" (go fetch), "typing", "read", "opened". The token is sent in the first frame, never in the URL.
import { BASE, getApiToken } from "@/src/api";

export type LiveEvent = { type: "message" | "typing" | "read" | "opened" | "ready" | "sync"; match_id?: string; at?: string; media_id?: string };

const listeners = new Set<(e: LiveEvent) => void>();
let ws: WebSocket | null = null;
let wanted = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let ping: ReturnType<typeof setInterval> | null = null;
let connected = false;

export const isLive = () => connected;

function open() {
  const token = getApiToken();
  if (!wanted || !token) return;
  const url = BASE.replace(/^http/, "ws") + "/api/ws";
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ token }));
  sock.onmessage = (m) => {
    let e: LiveEvent;
    try {
      e = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (e.type === "ready") {
      connected = true;
      retry = 0;
    }
    listeners.forEach((l) => l(e));
  };
  sock.onclose = (ev) => {
    connected = false;
    if (ws === sock) ws = null;
    if (!wanted || ev.code === 4401) return; // revoked session: the API 401 handler signs the user out
    timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
  };
  sock.onerror = () => sock.close();
}

export function startLive() {
  if (wanted) return;
  wanted = true;
  open();
  // Keep-alive; the server re-checks the session on every frame.
  ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: "ping" })), 25000);
}

export function stopLive() {
  wanted = false;
  connected = false;
  if (timer) clearTimeout(timer);
  if (ping) clearInterval(ping);
  ws?.close();
  ws = null;
}

export function onLive(fn: (e: LiveEvent) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const lastTyping = new Map<string, number>(); // throttle per chat
export function sendTyping(matchId: string) {
  const t = Date.now();
  if (t - (lastTyping.get(matchId) ?? 0) < 2500 || ws?.readyState !== 1) return;
  lastTyping.set(matchId, t);
  ws.send(JSON.stringify({ type: "typing", match_id: matchId }));
}
