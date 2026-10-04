import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { GET as listAnalyses, POST as createAnalysis } from "../analyses/route";
import { POST as refresh } from "./refresh/route";
import { POST as signIn } from "./sign-in/route";
import { POST as signUp } from "./sign-up/route";

// Batch 6 integration tests: the real /api/auth/* route handlers against
// the local Supabase stack (`npx supabase start`), same setup as
// src/app/api/analyses/route.supabase.test.ts. Walks the path a real user
// takes: sign up → sign in → refresh → save a run (with the Batch 6
// columns) → see it in their history.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing Supabase env vars for auth.supabase.test.ts. Run `npx supabase start` and " +
      "populate .env.local (see route.supabase.test.ts for the full list)."
  );
}

// Service-role client: teardown only (deleting the test user).
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const usersToClean: string[] = [];

afterAll(async () => {
  await Promise.all(usersToClean.map((id) => admin.auth.admin.deleteUser(id)));
});

function jsonRequest(path: string, body: unknown, token?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const email = `batch6-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
const password = "correct horse battery staple 42";

describe("/api/auth/* end to end", () => {
  it("signs up, signs in, refreshes, saves a run, and lists it", async () => {
    const signUpRes = await signUp(jsonRequest("/api/auth/sign-up", { email, password }));
    expect(signUpRes.status).toBe(201);
    const { session: created } = await signUpRes.json();
    expect(created.user.email).toBe(email);
    expect(typeof created.accessToken).toBe("string");
    usersToClean.push(created.user.id);

    const signInRes = await signIn(jsonRequest("/api/auth/sign-in", { email, password }));
    expect(signInRes.status).toBe(200);
    const { session } = await signInRes.json();
    expect(session.user.id).toBe(created.user.id);

    const refreshRes = await refresh(
      jsonRequest("/api/auth/refresh", { refreshToken: session.refreshToken })
    );
    expect(refreshRes.status).toBe(200);
    const { session: refreshed } = await refreshRes.json();
    expect(refreshed.user.id).toBe(created.user.id);

    const saveRes = await createAnalysis(
      jsonRequest(
        "/api/analyses",
        { cadence: 176, ground_contact_time: 245, flight_time: 105, landing_form_confidence: "full" },
        refreshed.accessToken
      )
    );
    expect(saveRes.status).toBe(201);

    const listRes = await listAnalyses(
      new Request("http://localhost/api/analyses", {
        headers: { Authorization: `Bearer ${refreshed.accessToken}` },
      })
    );
    const { analyses } = await listRes.json();
    expect(analyses).toHaveLength(1);
    expect(analyses[0]).toMatchObject({ cadence: 176, ground_contact_time: 245, flight_time: 105 });
  });

  it("refuses a second sign-up with the same email, in plain language", async () => {
    const res = await signUp(jsonRequest("/api/auth/sign-up", { email, password }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).error).toBe(
      "There's already an account with that email. Sign in instead."
    );
  });

  it("rejects a wrong password without leaking the raw Supabase error", async () => {
    const res = await signIn(jsonRequest("/api/auth/sign-in", { email, password: "wrong-password" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That email and password don't match.");
  });

  it("validates input before calling Supabase", async () => {
    const res = await signIn(jsonRequest("/api/auth/sign-in", { email: "nope", password }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Enter a valid email address.");
  });

  it("rejects a bogus refresh token", async () => {
    const res = await refresh(jsonRequest("/api/auth/refresh", { refreshToken: "not-a-token" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Your session expired. Sign in again.");
  });
});
