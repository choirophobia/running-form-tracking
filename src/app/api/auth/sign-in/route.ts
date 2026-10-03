import {
  createAnonAuthClient,
  friendlyAuthError,
  parseCredentials,
  readJsonBody,
  toSessionPayload,
} from "@/lib/supabase/auth";

// Batch 6: email + password sign-in, proxied so the browser never needs to
// reach Supabase directly (see src/lib/supabase/auth.ts).

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const credentials = parseCredentials(body);
  if ("error" in credentials) return Response.json(credentials, { status: 400 });

  const { data, error } = await createAnonAuthClient().auth.signInWithPassword(credentials);
  if (error || !data.session) {
    console.error("Sign-in failed:", error?.message);
    return Response.json(
      { error: friendlyAuthError(error?.message ?? "") },
      { status: error?.status ?? 401 }
    );
  }

  return Response.json({ session: toSessionPayload(data.session) });
}
