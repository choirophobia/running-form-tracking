import { parseCreateAnalysisInput, parsePaginationParams } from "@/lib/supabase/analyses";
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

  const pagination = parsePaginationParams(new URL(request.url).searchParams);
  if ("error" in pagination) {
    return Response.json({ error: pagination.error }, { status: 400 });
  }
  const { limit, offset } = pagination;

  // Fetch one extra row to know whether there's a next page, without a
  // separate count query.
  const { data, error } = await auth.client
    .from("analyses")
    .select()
    .order("recorded_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const hasMore = data.length > limit;
  return Response.json({
    analyses: hasMore ? data.slice(0, limit) : data,
    limit,
    offset,
    hasMore,
  });
}
