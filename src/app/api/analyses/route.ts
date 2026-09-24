import { parseCreateAnalysisInput } from "@/lib/supabase/analyses";
import { requireAuthenticatedClient } from "@/lib/supabase/request-client";

// Batch 4: POST saves one computed analysis for the caller; GET lists the
// caller's own analyses (newest first) — the future history sidebar's data
// source. Both require a Supabase session (Authorization: Bearer <token>);
// see request-client.ts for why there's no manual "WHERE user_id = ..."
// here — Row Level Security already enforces that.

export async function POST(request: Request) {
  const auth = await requireAuthenticatedClient(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseCreateAnalysisInput(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // user_id is set from the authenticated session, never trusted from the
  // request body — parseCreateAnalysisInput doesn't even accept that field.
  const { data, error } = await auth.client
    .from("analyses")
    .insert({ ...parsed, user_id: auth.userId })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ analysis: data }, { status: 201 });
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedClient(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.client
    .from("analyses")
    .select()
    .order("recorded_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ analyses: data });
}
