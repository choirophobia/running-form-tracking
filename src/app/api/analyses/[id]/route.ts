import { requireAuthenticatedClient } from "@/lib/supabase/request-client";

// Batch 4: fetch a single analysis by id. RLS means this naturally 404s
// (via .maybeSingle() returning null) for an id that exists but belongs to
// someone else, the same as for an id that doesn't exist at all — no
// separate "is this mine" check needed, and no leak of "that id exists but
// isn't yours" either.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthenticatedClient(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const { data, error } = await auth.client.from("analyses").select().eq("id", id).maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json({ analysis: data });
}
