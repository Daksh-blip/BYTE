import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Linking from "expo-linking";

import { api, ApiError, Me, setApiToken, setMediaToken, setUnauthorizedHandler } from "@/src/api";
import { setLoginNotice } from "@/src/auth-notice";
import { cleanWebUrl, exchangeGoogle, sessionIdFrom } from "@/src/social-auth";
import { clearKeyCache, loadLegacyKeys } from "@/src/e2ee";
import { clearCacheKeys } from "@/src/signal/cache";
import { startSignal, stopSignal } from "@/src/signal";
import { startLive, stopLive } from "@/src/live";
import { storage } from "@/src/utils/storage";

async function refreshMediaToken() {
  const r = await api<{ token: string }>("/me/media-token").catch(() => null);
  if (r) setMediaToken(r.token);
}

const TOKEN_KEY = "auth_token";

type AuthState = {
  loading: boolean;
  user: Me | null;
  signIn: (token: string, user: Me) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: Me) => void;
  refreshUser: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

async function ensureKeys(user: Me) {
  await loadLegacyKeys(user.id); // read-only, for old chats
  startSignal(user.id); // enrolls this device for Signal in the background
  startLive();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      // A Google sign-in redirect (web, or a cold-started app) carries a one-time session_id: handle it first.
      const url = Platform.OS === "web" ? window.location.href : await Linking.getInitialURL();
      const sid = sessionIdFrom(url);
      if (sid) {
        try {
          const r = await exchangeGoogle(sid);
          if (r) await storage.secureSet(TOKEN_KEY, r.token);
        } catch (e: any) {
          setLoginNotice({ message: e?.message || "Google sign-in didn't finish. Please try again.", tone: "error" });
        } finally {
          cleanWebUrl(); // the one-time id is useless after one attempt
        }
      }
      const t = await storage.secureGet(TOKEN_KEY, null as string | null);
      if (t) {
        setApiToken(t);
        try {
          const me = await api<Me>("/me");
          await refreshMediaToken();
          setUser(me);
          await ensureKeys(me).catch((err) => console.warn("E2EE key setup failed", err));
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            await storage.secureRemove(TOKEN_KEY);
            setApiToken(null);
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  const signIn = useCallback(async (token: string, u: Me) => {
    await storage.secureSet(TOKEN_KEY, token);
    setApiToken(token);
    await refreshMediaToken();
    setUser(u);
    await ensureKeys(u).catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    stopLive();
    await stopSignal();
    await storage.secureRemove(TOKEN_KEY);
    setApiToken(null);
    clearKeyCache();
    clearCacheKeys();
    setUser(null);
  }, []);

  // Session revoked server-side (password changed/reset on another device): wipe local credentials and go to login.
  useEffect(() => {
    let handling = false;
    setUnauthorizedHandler(() => {
      if (handling) return;
      handling = true;
      setApiToken(null); // stop any further requests with the revoked token right away
      // Set the notice first: the root AuthGuard sees it and sends the user to login (not Welcome).
      setLoginNotice({ message: "You were signed out because your password was changed. Please sign in again.", tone: "error" });
      signOut().finally(() => {
        handling = false;
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Re-check the session whenever the app returns to the foreground, and renew the photo token.
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        api<Me>("/me").then(setUser).catch(() => {});
        refreshMediaToken();
      }
    });
    const iv = setInterval(refreshMediaToken, 4 * 60 * 60 * 1000);
    return () => {
      sub.remove();
      clearInterval(iv);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshUser = useCallback(async () => {
    setUser(await api<Me>("/me"));
  }, []);

  return <Ctx.Provider value={{ loading, user, signIn, signOut, setUser, refreshUser }}>{loading ? null : children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
