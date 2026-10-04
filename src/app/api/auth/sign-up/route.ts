import {
  createAnonAuthClient,
  friendlyAuthError,
  parseCredentials,
  readJsonBody,
  toSessionPayload,
} from "@/lib/supabase/auth";

// Batch 6: creates an account and returns a session straight away. Local
// Supabase has email confirmation off (supabase/config.toml,
// [auth.email] enable_confirmations = false), so signUp returns a session
// immediately; if a hosted project turns confirmation on, `session` is null
// and this returns a clear message instead of a half-signed-in state.

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const credentials = parseCredentials(body);
  if ("error" in credentials) return Response.json(credentials, { status: 400 });

  const { data, error } = await createAnonAuthClient().auth.signUp(credentials);
  if (error) {
    console.error("Sign-up failed:", error.message);
    return Response.json({ error: friendlyAuthError(error.message) }, { status: error.status ?? 400 });
  }
  if (!data.session) {
    // Supabase returns a user with no identities (and no session) when the
    // email is already taken and confirmations are on — or when a new
    // account just needs confirming. Either way there's no session to hand
    // back.
    return Response.json(
      { error: "Check your email to confirm your account, then sign in." },
      { status: 409 }
    );
  }

  return Response.json({ session: toSessionPayload(data.session) }, { status: 201 });
}
