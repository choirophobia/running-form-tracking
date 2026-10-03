"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionPayload } from "@/lib/supabase/auth";

// Batch 6: the browser side of email + password auth. Every Supabase call
// goes through this app's own /api/auth/* routes (see
// src/lib/supabase/auth.ts for why the browser never talks to Supabase
// directly). The session lives in localStorage so a reload keeps you signed
// in; every read/write is wrapped because storage can be unavailable
// (private windows, blocked site data) — the app then just works signed-out
// per tab instead of crashing.

const STORAGE_KEY = "runningapp.session";
// Refresh a little before the access token actually expires, so a request
// never goes out with a token that dies mid-flight.
const REFRESH_MARGIN_SECONDS = 60;

function readStoredSession(): SessionPayload | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionPayload) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: SessionPayload | null) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — the in-memory session still works for this tab.
  }
}

async function postJson(path: string, body: unknown): Promise<{ session?: SessionPayload; error?: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    console.error(`${path} failed:`, err);
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export interface UseSessionResult {
  /** undefined until localStorage has been read on mount (avoids a
   * signed-out flash, and a server/client hydration mismatch). */
  session: SessionPayload | null | undefined;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => void;
  /** fetch() with the current access token attached, refreshing it first
   * when it's about to expire and retrying once on a 401. */
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export function useSession(): UseSessionResult {
  const [session, setSessionState] = useState<SessionPayload | null | undefined>(undefined);
  const sessionRef = useRef<SessionPayload | null>(null);
  // One in-flight refresh at a time, shared by concurrent requests.
  const refreshPromiseRef = useRef<Promise<SessionPayload | null> | null>(null);

  const setSession = useCallback((next: SessionPayload | null) => {
    sessionRef.current = next;
    writeStoredSession(next);
    setSessionState(next);
  }, []);

  useEffect(() => {
    const stored = readStoredSession();
    sessionRef.current = stored;
    // Reading localStorage has to wait until after mount (it doesn't exist
    // during server rendering) — this one-time sync is the intended use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionState(stored);
  }, []);

  const refresh = useCallback((): Promise<SessionPayload | null> => {
    const current = sessionRef.current;
    if (!current) return Promise.resolve(null);
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = postJson("/api/auth/refresh", {
        refreshToken: current.refreshToken,
      })
        .then(({ session: next }) => {
          setSession(next ?? null);
          return next ?? null;
        })
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }
    return refreshPromiseRef.current;
  }, [setSession]);

  const authedFetch = useCallback(
    async (input: string, init: RequestInit = {}) => {
      let current = sessionRef.current;
      if (current && current.expiresAt - Date.now() / 1000 < REFRESH_MARGIN_SECONDS) {
        current = await refresh();
      }
      const send = (token: string | undefined) =>
        fetch(input, {
          ...init,
          headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });

      const res = await send(current?.accessToken);
      if (res.status !== 401 || !current) return res;
      const refreshed = await refresh();
      return refreshed ? send(refreshed.accessToken) : res;
    },
    [refresh]
  );

  const authenticate = useCallback(
    async (path: string, email: string, password: string) => {
      const { session: next, error } = await postJson(path, { email, password });
      if (next) {
        setSession(next);
        return null;
      }
      return error ?? "Something went wrong. Try again in a moment.";
    },
    [setSession]
  );

  const signIn = useCallback(
    (email: string, password: string) => authenticate("/api/auth/sign-in", email, password),
    [authenticate]
  );
  const signUp = useCallback(
    (email: string, password: string) => authenticate("/api/auth/sign-up", email, password),
    [authenticate]
  );
  const signOut = useCallback(() => setSession(null), [setSession]);

  return { session, signIn, signUp, signOut, authedFetch };
}
