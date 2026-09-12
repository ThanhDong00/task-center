// Session state (issue #8): access token in memory only, refresh token in
// the httpOnly cookie. On load the session restores via refresh -> me.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiFetch, readJson } from "./api.ts";
import type { User } from "./api.ts";

export const API_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_API_URL ?? "http://localhost:3000/api";
export const NOTIF_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_NOTIF_URL ?? "http://localhost:3004";

interface Auth {
  user: User | null;
  token: string | null;
  ready: boolean;
  error: string | null;
  call: (path: string, init?: RequestInit) => Promise<Response>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const Ctx = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error("auth outside provider");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    apiFetch(API_URL, () => token, setToken, path, init) as Promise<Response>;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!r.ok) return;
        const b = (await readJson<{ accessToken?: string }>(r)) ?? {};
        if (typeof b.accessToken !== "string") return;
        setToken(b.accessToken);
        const me = await fetch(`${API_URL}/auth/me`, {
          credentials: "include",
          headers: { authorization: `Bearer ${b.accessToken}` },
        });
        if (me.ok) setUser((await readJson<User>(me)) as User);
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username: string, password: string) => {
    setError(null);
    const r = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      setError(r.status === 401 ? "wrong username or password" : "login failed");
      return false;
    }
    const b = (await readJson<{ accessToken: string; user: User }>(r))!;
    setToken(b.accessToken);
    setUser(b.user);
    return true;
  };

  const register = async (username: string, password: string) => {
    setError(null);
    const r = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      setError(r.status === 409 ? "that name is taken" : "register failed");
      return false;
    }
    return login(username, password);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  // Token set asynchronously after mount: rebuild `call` each render so it
  // always closes over the current token.
  return (
    <Ctx.Provider value={{ user, token, ready, error, call, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}
