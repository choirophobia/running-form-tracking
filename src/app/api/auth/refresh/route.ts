import {
  createAnonAuthClient,
  friendlyAuthError,
  readJsonBody,
  toSessionPayload,
} from "@/lib/supabase/auth";

// Batch 6: swaps a refresh token for a fresh session, so a signed-in user
// isn't bounced out when the (1-hour) access token expires.

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const refreshToken = (body as { refreshToken?: unknown } | null)?.refreshToken;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    return Response.json({ error: '"refreshToken" is required.' }, { status: 400 });
  }

  const { data, error } = await createAnonAuthClient().auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data.session) {
    console.error("Session refresh failed:", error?.message);
    return Response.json({ error: friendlyAuthError("refresh token") }, { status: 401 });
  }

  return Response.json({ session: toSessionPayload(data.session) });
}
