"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import * as api from "./api";

type AuthCtx = {
  user: api.User | null;
  token: string | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, nickname: string) => Promise<void>;
  signOut: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const KEY = "offermind_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<api.User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (!saved) {
      setReady(true);
      return;
    }
    setToken(saved);
    api
      .me(saved)
      .then(setUser)
      .catch(() => {
        window.localStorage.removeItem(KEY);
        setToken(null);
      })
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    window.localStorage.setItem(KEY, res.access_token);
    setToken(res.access_token);
    setUser(await api.me(res.access_token));
  }, []);

  const signUp = useCallback(async (email: string, password: string, nickname: string) => {
    await api.register(email, password, nickname);
    const res = await api.login(email, password);
    window.localStorage.setItem(KEY, res.access_token);
    setToken(res.access_token);
    setUser(await api.me(res.access_token));
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, token, ready, signIn, signUp, signOut }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内部使用");
  return ctx;
}
