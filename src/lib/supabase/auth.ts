import { createClient, type Session } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "./config";

// Batch 6: email + password auth, proxied through Next API routes
// (src/app/api/auth/*) instead of called from the browser. The browser
// never talks to Supabase directly: NEXT_PUBLIC_SUPABASE_URL points at a
// local Supabase (127.0.0.1:54321), which a visitor arriving through a
// Cloudflare tunnel can't reach — only this Next server can. Same anon key
// as request-client.ts; the service-role key is never used here.

/** The minimal session shape handed back to the browser. */
export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds, straight from Supabase. */
  expiresAt: number;
  user: { id: string; email: string };
}

export interface Credentials {
  email: string;
  password: string;
}

// Matches Supabase's own default minimum (auth.password.min_length).
export const MIN_PASSWORD_LENGTH = 6;

export function parseCredentials(body: unknown): Credentials | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return { error: "Enter a valid email address." };
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { email: email.trim().toLowerCase(), password };
}

/**
 * Turns Supabase's raw auth error messages into the plain, coaching-tone
 * copy the design tokens' Voice section asks for — never a raw exception
 * string in the UI. Unknown messages fall back to a generic line (the raw
 * one is logged server-side by the caller).
 */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match.";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "There's already an account with that email. Sign in instead.";
  }
  if (m.includes("password")) return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (m.includes("refresh token")) return "Your session expired. Sign in again.";
  return "Something went wrong signing you in. Try again in a moment.";
}

export function toSessionPayload(session: Session): SessionPayload {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    user: { id: session.user.id, email: session.user.email ?? "" },
  };
}

export function createAnonAuthClient() {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Shared JSON-body parsing for the three auth routes. */
export async function readJsonBody(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
}
