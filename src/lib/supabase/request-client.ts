import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "./config";

/**
 * Builds a Supabase client authenticated as the caller of an API route:
 * the anon key plus the caller's own access token, forwarded as the
 * Authorization header — NOT the service role key. Every query through
 * this client is subject to Row Level Security exactly as if the browser
 * had called Supabase directly, so route handlers never need to manually
 * filter "WHERE user_id = ...": RLS already guarantees a caller can only
 * see/write their own rows (see the migration in supabase/migrations/).
 *
 * Returns null if the request has no Bearer token at all.
 */
function createRequestClient(request: Request): SupabaseClient | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

export interface AuthenticatedRequest {
  client: SupabaseClient;
  userId: string;
}

/**
 * Validates the request's Authorization header and returns an
 * RLS-scoped Supabase client plus the caller's user id, or a 401 Response
 * ready to return directly — so every route handler can do:
 *
 *   const auth = await requireAuthenticatedClient(request);
 *   if (auth instanceof Response) return auth;
 */
export async function requireAuthenticatedClient(
  request: Request
): Promise<AuthenticatedRequest | Response> {
  const client = createRequestClient(request);
  if (!client) {
    return Response.json(
      { error: "Missing or invalid Authorization header (expected a Bearer token)." },
      { status: 401 }
    );
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return Response.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  return { client, userId: data.user.id };
}
