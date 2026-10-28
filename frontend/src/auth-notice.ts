// One-shot, in-memory hand-off to the login screen (never in URLs, history or storage).
// Holds only a verified email + a notice. Never put passwords or reset codes here.
type Notice = { email?: string; message: string; tone: "success" | "error" };

let pending: Notice | null = null;

export function setLoginNotice(n: Notice) {
  pending = n;
}

export const hasLoginNotice = () => pending !== null;

export function takeLoginNotice(): Notice | null {
  const n = pending;
  pending = null;
  return n;
}
