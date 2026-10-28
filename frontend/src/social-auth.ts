import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";

import { api, Me } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

type AuthResult = { token: string; user: Me };

const AUTH_URL = "https://auth.emergentagent.com/";

export function sessionIdFrom(url: string | null | undefined): string | null {
  const m = url?.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const sent = new Set<string>(); // a session_id is one-time: never exchange it twice

/** Swap the one-time Google session_id for this app's own session token. Returns null if it was already used. */
export async function exchangeGoogle(sessionId: string): Promise<AuthResult | null> {
  if (sent.has(sessionId)) return null;
  sent.add(sessionId);
  return api<AuthResult>("/auth/google", { method: "POST", body: { session_id: sessionId } });
}

/** Web: removes only session_id from the address bar, after a successful exchange. */
export function cleanWebUrl() {
  if (Platform.OS !== "web") return;
  const u = new URL(window.location.href);
  u.searchParams.delete("session_id");
  const hash = u.hash.replace(/^#/, "").split("&").filter((p) => p && !p.startsWith("session_id=")).join("&");
  u.hash = hash ? `#${hash}` : "";
  window.history.replaceState(window.history.state, "", u.toString());
}

/** Starts Google sign-in. On web the page navigates away (returns null); on mobile returns the result or null if cancelled. */
export async function googleSignIn(): Promise<AuthResult | null> {
  if (Platform.OS === "web") {
    window.location.href = `${AUTH_URL}?redirect=${encodeURIComponent(window.location.origin + "/")}`;
    return null;
  }
  const redirect = Linking.createURL("");
  let fromLink: string | null = null;
  const sub = Linking.addEventListener("url", ({ url }) => {
    if (sessionIdFrom(url)) fromLink = url;
  });
  try {
    const res = await WebBrowser.openAuthSessionAsync(`${AUTH_URL}?redirect=${encodeURIComponent(redirect)}`, redirect);
    const url = (res.type === "success" ? res.url : null) ?? fromLink ?? (await Linking.getInitialURL());
    const id = sessionIdFrom(url);
    return id ? exchangeGoogle(id) : null;
  } finally {
    sub.remove();
  }
}

export const appleAvailable = () => (Platform.OS === "ios" ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false));

/** iOS only. Returns null when the user cancels. */
export async function appleSignIn(): Promise<AuthResult | null> {
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!cred.identityToken) throw new Error("Apple didn't return a sign-in token. Please try again.");
    const name = cred.fullName?.givenName ?? ""; // Apple shares the name on the first sign-in only
    return await api<AuthResult>("/auth/apple", { method: "POST", body: { identity_token: cred.identityToken, name } });
  } catch (e: any) {
    if (e?.code === "ERR_REQUEST_CANCELED") return null;
    throw e;
  }
}
