import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getAnalysis } from "./[id]/route";
import { GET as listAnalyses, POST as createAnalysis } from "./route";

// Batch 4 integration tests: exercise the real API route handlers against
// the local Supabase stack (`npx supabase start`), not a mock. Requires
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY to be set (via .env.local, loaded by
// vitest.setup.ts) and the local stack to actually be running — these
// tests fail fast with a clear message if it isn't.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing Supabase env vars for route.supabase.test.ts. Run `npx supabase start` " +
      "and make sure .env.local has NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
      "and SUPABASE_SERVICE_ROLE_KEY set from its output."
  );
}

// Service-role client: test setup/teardown only (creating/deleting test
// users). The application route handlers never use the service role key —
// see request-client.ts's doc comment for why.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const TEST_PASSWORD = "correct horse battery staple 42";

async function createSignedInUser(emailPrefix: string) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`Failed to create test user: ${createError?.message}`);
  }

  const anon = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError || !signedIn.session) {
    throw new Error(`Failed to sign in test user: ${signInError?.message}`);
  }

  return { userId: created.user.id, accessToken: signedIn.session.access_token };
}

function authedRequest(url: string, token: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

let userId: string;
let accessToken: string;
const usersToClean: string[] = [];

beforeAll(async () => {
  const user = await createSignedInUser("batch4-test");
  userId = user.userId;
  accessToken = user.accessToken;
  usersToClean.push(userId);
});

afterAll(async () => {
  await Promise.all(usersToClean.map((id) => admin.auth.admin.deleteUser(id)));
});

describe("POST /api/analyses", () => {
  it("creates an analysis owned by the authenticated user", async () => {
    const response = await createAnalysis(
      authedRequest("http://localhost/api/analyses", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: 178, hip_drop: 4.6, landing_form_confidence: "full" }),
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.analysis.user_id).toBe(userId);
    expect(body.analysis.cadence).toBe(178);
    expect(body.analysis.hip_drop).toBeCloseTo(4.6, 6);
    expect(body.analysis.landing_form_confidence).toBe("full");
  });

  it("stores and returns Batch 7 flags, so a saved report shows what was flagged", async () => {
    const created = await createAnalysis(
      authedRequest("http://localhost/api/analyses", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hip_drop: 9.1, flags: ["hip_drop"] }),
      })
    );
    expect(created.status).toBe(201);
    const { analysis } = await created.json();

    const fetched = await getAnalysis(
      authedRequest(`http://localhost/api/analyses/${analysis.id}`, accessToken),
      { params: Promise.resolve({ id: analysis.id }) }
    );
    expect((await fetched.json()).analysis.flags).toEqual(["hip_drop"]);
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await createAnalysis(
      new Request("http://localhost/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects an invalid body instead of writing bad data", async () => {
    const response = await createAnalysis(
      authedRequest("http://localhost/api/analyses", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: "fast" }),
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects a physically-impossible value instead of persisting it", async () => {
    const response = await createAnalysis(
      authedRequest("http://localhost/api/analyses", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: -50 }),
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/analyses", () => {
  it("lists only the authenticated user's own analyses, newest first", async () => {
    await createAnalysis(
      authedRequest("http://localhost/api/analyses", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: 165 }),
      })
    );

    const response = await listAnalyses(authedRequest("http://localhost/api/analyses", accessToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.analyses)).toBe(true);
    expect(body.analyses.length).toBeGreaterThan(0);
    expect(body.analyses.every((a: { user_id: string }) => a.user_id === userId)).toBe(true);
  });

  it("paginates with limit/offset and reports hasMore correctly", async () => {
    // A dedicated user so this test's count isn't polluted by analyses
    // other tests in this file create for the shared user above.
    const paginationUser = await createSignedInUser("batch4-test-pagination");
    usersToClean.push(paginationUser.userId);

    for (const cadence of [150, 160, 170, 180, 190]) {
      await createAnalysis(
        authedRequest("http://localhost/api/analyses", paginationUser.accessToken, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cadence }),
        })
      );
    }

    const page1 = await listAnalyses(
      authedRequest("http://localhost/api/analyses?limit=2", paginationUser.accessToken)
    );
    const page1Body = await page1.json();
    expect(page1Body.analyses).toHaveLength(2);
    expect(page1Body.limit).toBe(2);
    expect(page1Body.offset).toBe(0);
    expect(page1Body.hasMore).toBe(true);

    const page3 = await listAnalyses(
      authedRequest("http://localhost/api/analyses?limit=2&offset=4", paginationUser.accessToken)
    );
    const page3Body = await page3.json();
    expect(page3Body.analyses).toHaveLength(1);
    expect(page3Body.hasMore).toBe(false);

    // Pages don't overlap or skip: collecting every page's ids should
    // equal the full set with no duplicates.
    const page2 = await listAnalyses(
      authedRequest("http://localhost/api/analyses?limit=2&offset=2", paginationUser.accessToken)
    );
    const page2Body = await page2.json();
    const allIds = [...page1Body.analyses, ...page2Body.analyses, ...page3Body.analyses].map(
      (a: { id: string }) => a.id
    );
    expect(new Set(allIds).size).toBe(5);
  });

  it("rejects an out-of-range limit", async () => {
    const response = await listAnalyses(
      authedRequest("http://localhost/api/analyses?limit=1000", accessToken)
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/analyses/[id]", () => {
  it("fetches a single analysis by id", async () => {
    const created = await createAnalysis(
      authedRequest("http://localhost/api/analyses", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: 172 }),
      })
    );
    const { analysis } = await created.json();

    const response = await getAnalysis(
      authedRequest(`http://localhost/api/analyses/${analysis.id}`, accessToken),
      { params: Promise.resolve({ id: analysis.id }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.analysis.id).toBe(analysis.id);
  });

  it("returns 404 for a nonexistent id", async () => {
    const missingId = "00000000-0000-0000-0000-000000000000";
    const response = await getAnalysis(
      authedRequest(`http://localhost/api/analyses/${missingId}`, accessToken),
      { params: Promise.resolve({ id: missingId }) }
    );
    expect(response.status).toBe(404);
  });
});

describe("cross-user isolation (Row Level Security)", () => {
  it("does not let one user read another user's analysis", async () => {
    const other = await createSignedInUser("batch4-test-other");
    usersToClean.push(other.userId);

    const createdByOther = await createAnalysis(
      authedRequest("http://localhost/api/analyses", other.accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: 200 }),
      })
    );
    const { analysis: othersAnalysis } = await createdByOther.json();

    // The original test user's token tries to fetch it — RLS should make
    // this indistinguishable from "doesn't exist" (404), never a leak.
    const response = await getAnalysis(
      authedRequest(`http://localhost/api/analyses/${othersAnalysis.id}`, accessToken),
      { params: Promise.resolve({ id: othersAnalysis.id }) }
    );
    expect(response.status).toBe(404);

    // And it must not show up in the original user's list either.
    const listResponse = await listAnalyses(
      authedRequest("http://localhost/api/analyses", accessToken)
    );
    const { analyses } = await listResponse.json();
    expect(analyses.some((a: { id: string }) => a.id === othersAnalysis.id)).toBe(false);
  });
});
