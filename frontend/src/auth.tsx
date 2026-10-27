import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, ApiError, Me, setApiToken } from "@/src/api";
import { clearKeyCache, loadOrCreateKeys } from "@/src/e2ee";
import { storage } from "@/src/utils/storage";

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
  const pk = await loadOrCreateKeys(user.id);
  if (pk !== user.public_key) {
    await api("/me/public-key", { method: "PUT", body: { public_key: pk } });
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      const t = await storage.secureGet(TOKEN_KEY, null as string | null);
      if (t) {
        setApiToken(t);
        try {
          const me = await api<Me>("/me");
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
    setUser(u);
    await ensureKeys(u).catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    setApiToken(null);
    clearKeyCache();
    setUser(null);
  }, []);

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
