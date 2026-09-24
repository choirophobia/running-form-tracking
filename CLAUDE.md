# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project status

Batch 1 (pose-detection PoC), Batch 2 (fps detection + tiered gate), and Batch 3 (metric
computation functions) are done and wired together in one PoC page, `src/app/pose-poc/page.tsx`.
Batch 4 (Supabase schema + API routes) is also done — schema + backend only, **not wired into
the pose-poc page**: computed metrics don't get saved anywhere yet, there's no sign-up/sign-in UI,
and history/report UI (Batches 5-6) don't exist. Read `running-form-saas-prd-v0.md` and
`running-brand-design-tokens.md` in full before extending this — they are the source of truth,
not this summary.

Recommended build order (from the PRD, Section 11):
1. Client-side pose extraction + skeleton overlay proof of concept — **done**
2. FPS detection with the tiered confidence gate — **done**
3. Metric computation functions, with unit tests against known reference angles — **done**,
   wired into the pose-poc page so computed metrics are visible against real footage
4. Supabase schema + API routes — **done** (schema + `/api/analyses` routes only; not wired
   into any UI yet — see the Batch 4 section below)
5. Report UI using the design tokens
6. History sidebar
7. Recommendations engine with the curated citation/video table

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Start (prod): `npm run start`
- Lint: `npm run lint`
- Run all tests: `npm test`
- Watch tests: `npm run test:watch`
- Run one test file: `npx vitest run src/lib/metrics/metrics.test.ts`
- Start local Supabase (Postgres/Auth/Storage via Docker): `npx supabase start`
- Stop it: `npx supabase stop`
- Check its status / reprint connection details: `npx supabase status`
- Reapply migrations from scratch: `npx supabase db reset`

Scaffolded with `create-next-app` (App Router, TypeScript, Tailwind v4, ESLint). Next.js 16 —
its APIs/conventions may differ from training data; see `AGENTS.md` / `node_modules/next/dist/docs/`
before writing Next.js-specific code. Tests use Vitest, config in `vitest.config.mts` (the `.mts`
extension is deliberate — a plain `.ts` config loads as CommonJS and warns, since this project
has no top-level `"type": "module"`); it loads `.env.local` itself via `vitest.setup.ts` since
(unlike Next) Vitest doesn't do that automatically.

`npm test` includes `src/app/api/analyses/route.supabase.test.ts`, which hits the **real** local
Supabase instance — it throws immediately with a clear message if `npx supabase start` hasn't
been run / `.env.local` isn't populated. Run `npx supabase start` before `npm test` if you've
stopped it.

## Batch 1+2+3: pose detection + fps gate + metrics proof of concept

`src/app/pose-poc/page.tsx` — a standalone page (not the final app UI), still intentionally
unstyled (no design-tokens pass yet), no persistence. On file select it runs the Batch 2 fps gate
first; only videos that pass (or are explicitly continued past) reach the Batch 1 pose overlay,
which in turn feeds the Batch 3 metrics (see below).

**Batch 1 — pose overlay.** Upload a local video, it plays in a `<video>` element, and a
`<canvas>` overlay draws landmarks/connectors per frame. The animation loop
(`startPoseLoop`/`cancelScheduledFrame` in that file) lives at module scope, not inside the
component — keep it there: it's imperative ref-driven code that intentionally calls
`performance.now()` outside render, which trips React Compiler's purity lint if nested inside
the component body. Prefers `requestVideoFrameCallback` (fires once per actual decoded frame)
over a plain `requestAnimationFrame` loop, falling back to rAF where unsupported.

Uses `@mediapipe/tasks-vision` (WASM, runs fully in-browser — no server round-trip), loading
the model from Google's hosted CDN (`storage.googleapis.com/mediapipe-models`) at runtime, not
bundled locally.

**Batch 2 — fps gate.** `src/lib/fps-detection.ts` implements PRD Section 5: `detectFps(file)`
reads the container's encoded frame rate via `mediainfo.js`, falling back to empirical frame
counting (via `requestVideoFrameCallback` on a hidden video element) if metadata is missing,
malformed, or outside ~15–480fps. `classifyFpsTier(fps)` sorts the result into the tiered gate
(full ≥120fps / reduced 60–119fps / blocked <60fps). The pose-poc page wires this in as an
`FpsGateState` that blocks the video from loading at all on a "blocked" result, offering a
"continue without landing form" button that proceeds with `landingFormAvailable: false`.

`mediainfo.js` is loaded from jsdelivr at runtime, **not** imported as an npm value import — its
package build (via the `module`/`import` export conditions) resolves to emscripten glue that
does `new URL('MediaInfoModule.wasm', import.meta.url)`, which Turbopack statically resolves as
a bundled asset and fails to find, and which — separately — 404s even at the CDN, because the
wasm binary is published only at `dist/MediaInfoModule.wasm`, not next to the `esm-bundle`/`esm`
JS that references it via `import.meta.url`. The fix that actually works: dynamically `import()`
the ESM bundle from a *non-literal* URL variable (so no bundler statically resolves it) and pass
an explicit `locateFile` pointing at the correct `dist/` path. Verified end-to-end against
generated 30fps/150fps test clips before relying on it — don't drop the `locateFile` override or
revert to a static `import "mediainfo.js"` without re-checking both failure modes.

Once pose extraction, fps gating, and metrics are validated against a real running video, this
page's logic becomes the basis for the real upload/analysis flow — don't build further batches
on top of it until that validation happens.

## Batch 3: metric computation functions

`src/lib/metrics/` — pure functions per PRD Section 6, importable via the barrel
`src/lib/metrics/index.ts`. The functions themselves are framework-independent (take a
`PoseFrame[]`, return a result), but they **are** wired into the pose-poc page: `onFrame` in that
page's animation loop pushes one `PoseFrame` per detected frame into a ref-held buffer (keyed by
`video.currentTime * 1000`, not wall-clock time), and `computeMetrics(frames, fpsTier)` reruns
over everything collected so far whenever playback pauses/ends, or via a manual "Recompute
metrics" button. Results render in a `MetricsPanel` below the video, one row per metric, showing
"not enough data" for any `null` result rather than a misleading number.

- `geometry.ts` — generic `Vec3` math (`angleAtVertex`, `distance`, `midpoint`, `average`, …), no
  pose domain knowledge. Unit-tested against known reference angles (30/60/90/120° cases,
  3-4-5 triangle distance) — this is literally the "known reference angles" the PRD build note
  asks for.
- `pose-landmarks.ts` — `POSE_LANDMARK` index constants (BlazePose's 33-point topology, same
  indices `PoseLandmarker.POSE_CONNECTIONS` uses for the Batch 1 overlay) and the `PoseFrame`
  type each metric function consumes: `{ timestampMs, worldLandmarks }`, where `worldLandmarks`
  is `PoseLandmarkerResult.worldLandmarks[0]` (real-world meters, **not** the normalized [0,1]
  image landmarks Batch 1 draws with).
  **Unverified assumption, flagged in that file's comments**: world-landmark +Y is assumed to
  increase *downward* (matching MediaPipe's normalized-landmark convention). Every "higher/
  lower" comparison across this module depends on that sign. It hasn't been checked against a
  real captured session yet — do that before trusting these numbers on real footage, and if
  vertical oscillation / hip drop / landing form look inverted, this is the first thing to flip.
- `strides.ts` — footstrike detection, which cadence/overstride/hip-drop/landing-form all depend
  on: `detectFootstrikes(frames, side)` finds local maxima of that ankle's height *relative to
  the hip midpoint* (not raw ankle height, so it's robust to the subject/camera drifting
  vertically in frame). `findPeaks` is a small, deliberately simple peak finder tuned for clean,
  roughly-periodic biomechanical signals — not a general DSP peak detector.
- `metrics.ts` — the six PRD-scoped functions (`computeCadence`, `computeVerticalOscillation`,
  `computeOverstride`, `computeHipDrop`, `computeArmSwingSymmetry`, `computeLandingForm`) plus
  `computeMetrics(frames, fpsTier)` which runs all six. Each returns `null` — not a misleading
  zero — when there isn't enough signal (too few frames/footstrikes) to compute a value;
  `computeLandingForm` also returns `null` when `fpsTier === "blocked"`, gating on the Batch 2
  fps tier per PRD Section 5/6 (confidence is `"full"`/`"reduced"` mirroring that tier
  otherwise). `computeHipDrop`'s doc comment repeats the PRD's own caveat that it needs
  front/rear-angle video to be meaningful — this module has no way to detect camera angle, so
  that constraint has to be enforced elsewhere (capture guidance in a future batch), not here.

Every metric function is unit-tested (`*.test.ts` next to its source) against synthetic
`PoseFrame` sequences built to have an exactly-derivable expected value — e.g. overstride and
hip-drop tests hold the relevant landmarks at a *frame-invariant* offset so the expected result
is exact regardless of which frame the peak-finder happens to pick, while cadence/vertical-
oscillation tests use a generous tolerance since those inherently depend on discrete frame-grid
timing. The automated tests are still synthetic-only; the pose-poc page has been exercised
manually in-browser against real running footage (plausible-looking numbers, nothing formally
recorded/regression-tested) — treat the computation logic as algorithmically-verified and
informally spot-checked, not empirically validated against a labeled reference dataset.

**Explicitly out of scope so far** (don't add speculatively): the composite efficiency score
(PRD Section 7's "one hero number") — its weighting formula is still an open decision per PRD
Section 12; the design-tokens styling pass (Batch 5). (Persistence is no longer out of scope —
see Batch 4 below — but isn't wired to this page yet.)

## Batch 4: Supabase schema + API routes

Backend only — **nothing in the UI calls any of this yet**. Runs against a **local** Supabase
instance via Docker (`npx supabase start`), not a hosted project; that's a deliberate choice for
this stage (see the AskUserQuestion decision in project history) — switching to a hosted project
later just means changing `.env.local`, nothing in the code.

- `supabase/migrations/20260101000000_analyses_schema.sql` — the schema from PRD Section 9's
  sketch: `profiles` (a public companion to Supabase's built-in `auth.users`, auto-created by a
  trigger on signup) and `analyses` (one row per report: fps, all six Batch 3 metrics, flags,
  nullable `score` for the not-yet-built composite efficiency score). **Row Level Security is on
  for both tables and is load-bearing, not optional** — Supabase tables are reachable directly
  from the browser via the anon key, so RLS is the only thing stopping one user from reading or
  writing another user's rows. Don't add a table here without also adding its RLS policy.
- `src/lib/supabase/request-client.ts` — `requireAuthenticatedClient(request)`, used by every
  route handler: builds a Supabase client using the **anon key plus the caller's own JWT**
  (forwarded from the `Authorization: Bearer <token>` header), never the service-role key. This
  means every query through it is subject to RLS exactly as if the browser had called Supabase
  directly — route handlers never manually filter `WHERE user_id = ...`; RLS already guarantees
  that. The service-role key (in `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`) is used **only** in
  test setup/teardown (creating/deleting test users), never in application code — keep it that
  way; wiring it into a route handler would silently bypass RLS for that route.
- `src/lib/supabase/analyses.ts` — `parseCreateAnalysisInput`, hand-rolled request-body
  validation (no schema-validation library pulled in for one small fixed shape). Every field is
  optional/nullable, matching the Batch 3 metric functions' `null` ("not enough data") results.
- `src/app/api/analyses/route.ts` (`POST` create, `GET` list-mine) and
  `src/app/api/analyses/[id]/route.ts` (`GET` one) — plain Web `Request`/`Response`, not
  `NextResponse` (no need for its extras here). `user_id` on create is always the authenticated
  caller's id, never trusted from the request body. A wrong-owner id 404s the same as a
  nonexistent one — RLS makes those indistinguishable by design, so there's no "exists but isn't
  yours" leak.

**Two kinds of tests, don't confuse them:**
- `src/lib/supabase/analyses.test.ts` — pure, synthetic, no live service needed (same style as
  Batches 1-3).
- `src/app/api/analyses/route.supabase.test.ts` — integration tests against the **real** local
  Supabase instance: creates real throwaway auth users (via the admin/service-role client, test-
  only), signs in, calls the actual route handler functions with real `Request` objects and real
  bearer tokens, and — importantly — includes a cross-user isolation test that verifies RLS
  actually stops user A from reading user B's analysis (404, not a data leak). This is the test
  that would have caught it if RLS were misconfigured or a route bypassed it; don't remove it as
  "redundant" with the unit tests.

Also manually smoke-tested with real `curl` requests against the running dev server (not just
the test suite) before considering this done — same verify-before-declaring-done discipline as
Batch 2's mediainfo.js CDN bug.

**Explicitly out of scope so far**: any UI (sign-up/sign-in page, saving a pose-poc session,
history sidebar); video upload to Storage (`video_storage_path` column exists, nothing writes to
it); the composite `score` column (same open decision as Batch 3).

## Product & architectural constraints (do not violate)

- **Zero infrastructure cost is a hard constraint.** All pose inference must run client-side.
  The backend only ever receives small JSON payloads (computed landmarks/metrics), never raw
  video, unless a user explicitly opts to keep the source clip in Supabase Storage.
- **Never claim "running economy" or "muscle activation."** Both are lab-only physiological
  terms (metabolic cart / EMG) that this product cannot measure. Use the PRD's renamed
  alternatives instead: a "biomechanical efficiency score" (correlated with economy in the
  literature, explicitly labeled as such) and hip flexion angle/range as a kinematic proxy
  (never framed as muscle activity). See PRD Section 6 for the full metric-by-metric scoping.
- **No pace/speed in min/km** unless the user manually supplies GPS pace alongside the video —
  there is no camera-only scale reference to derive it from.
- **Recommendations must cite real, verifiable research** (author/year). If no citation exists
  at adequate confidence, the entry must say "limited evidence" explicitly rather than fabricate
  a source.
- v0 is upload-based analysis only — no real-time/live camera capture, no run-type segmentation
  (one continuous history regardless of easy run / tempo / race).

## Architecture (target stack, per PRD Section 4)

| Layer | Choice | Why |
|---|---|---|
| Pose extraction | MediaPipe Pose Landmarker, client-side (WASM/JS) | Zero server compute |
| Frontend | Next.js | Matches Vercel deploy target |
| Hosting | Vercel (free tier) | Zero cost |
| Backend/API | Next.js API routes on Vercel | No separate server needed |
| Database + Auth + Storage | Supabase (free tier) | Managed Postgres, auth, object storage in one service |

The browser does all pose extraction and metric computation; the API layer only receives
computed landmark/metric JSON. This split is what keeps compute cost at zero regardless of
usage volume — don't move computation server-side without revisiting this constraint.

**Current dev setup runs Supabase locally via Docker** (`npx supabase start`), not the hosted
free-tier project the PRD describes — no hosted project exists yet. Nothing in the application
code is local-only (env vars are the only thing that would change to point at a hosted project),
but don't assume a hosted project exists when reasoning about deployment.

### FPS validation (PRD Section 5, done — see Batch 1+2 section above)

Runs client-side, before upload starts:
1. Primary: read encoded frame rate from container metadata via `mediainfo.js` (WASM).
2. Fallback (if metadata is missing/malformed/implausible, i.e. outside ~15–480fps):
   empirically count frames from the first ~2s via `requestVideoFrameCallback()`.

Tiered gate, not hard pass/fail:
- ≥120fps → full analysis, landing form at full confidence
- 60–119fps → full analysis, landing form shown with a "reduced confidence" label
- <60fps → upload blocked by default (explain why), with a "continue without landing form"
  option that disables only that metric

### Data model (Supabase Postgres, PRD Section 9, done — see Batch 4 section above)

Implemented in `supabase/migrations/20260101000000_analyses_schema.sql` — that migration file is
the source of truth for exact column types/constraints, not this sketch.

```
profiles (public companion to Supabase's built-in auth.users)
  id (= auth.users.id), email, created_at

analyses
  id, user_id (FK), recorded_at, video_fps, video_storage_path (nullable),
  score, cadence, vertical_oscillation, overstride, hip_drop, arm_swing_symmetry,
  landing_form (nullable), landing_form_confidence (enum: full/reduced/unavailable),
  flags (array of metric names), created_at
```

### Curated recommendations table (not yet built)

The exercise/citation/video table backing the recommendations engine should stay in one
maintained table (static JSON is the current lean choice — see PRD Section 12 open decisions)
so dead links or new citations can be swapped without a code change. Don't hardcode citations
per-metric inline in components.

## Design system

Full spec: `running-brand-design-tokens.md`. This is shared with the "Volt and Fast" rebuild,
so both products must read as one identity — treat it as the single source of truth for the
frontend build, not a separate visual pass. Not applied yet to the Batch 1 PoC page (see above).

Key rules to hold to when building real UI:
- Only two accent colors (`--rust`, `--field`), never both in the same component — rust means
  "pay attention" (flags/warnings), field means "on track" (good form/valid range).
- Three-typeface system with strict roles: condensed grotesk for display numbers/headlines only,
  plain grotesk for body/UI, monospace for numeric data labels only. Don't use the display face
  for body copy or vice versa.
- Left-aligned layouts, flat surfaces with hairline borders only — no drop shadows, no
  rounded-card sameness, no tracked-out ALL-CAPS eyebrow labels, no arrow (→) on buttons/links.
- One hero number per screen; everything else stays quiet.
- Voice is plain and coaching, not corporate SaaS copy — e.g. "Overstriding on your left foot,"
  not "Overstride event detected: LEFT." Errors explain what happened and what to do next, never
  a raw exception string.
