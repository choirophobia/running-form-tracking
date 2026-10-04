# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project status

Batches 1-6 are done (pose detection, fps gate, metric computation, Supabase schema + API,
report UI, history sidebar — see their sections below). `src/app/page.tsx` is the real product
page at `/`, styled per `running-brand-design-tokens.md`, now with email + password sign-in,
"Save to history", and a left history sidebar (Batch 6). Still missing: the efficiency score and
progress delta (PRD Section 12 open decision) and recommendations (Batch 7). Read `running-form-saas-prd-v0.md` and
`running-brand-design-tokens.md` in full before extending this — they are the source of truth,
not this summary.

Recommended build order (from the PRD, Section 11):
1. Client-side pose extraction + skeleton overlay proof of concept — **done**
2. FPS detection with the tiered confidence gate — **done**
3. Metric computation functions, with unit tests against known reference angles — **done**,
   wired into `/` (and the pose-poc dev page) so computed metrics are visible against real footage
4. Supabase schema + API routes — **done** (schema + `/api/analyses` routes only; not wired
   into any UI yet — see the Batch 4 section below)
5. Report UI using the design tokens — **done** (see the Batch 5 section below) — no hero
   efficiency score (PRD Section 12 open decision) and no recommendations (Batch 7) yet
6. History sidebar — **done** (see the Batch 6 section below) — cadence stands in for the
   not-yet-defined score; no progress delta yet
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

## Batch 1+2+3: pose detection + fps gate + metrics pipeline

`src/hooks/useRunningFormAnalysis.ts` is the shared pipeline — fps gate, pose detection/overlay,
metric computation — used by **both** `src/app/page.tsx` (the real report UI, Batch 5) and
`src/app/pose-poc/page.tsx` (a standalone dev harness for the same pipeline, deliberately
unstyled, kept around for quick end-to-end testing without the real UI's styling getting in the
way). This used to live inline in the pose-poc page only; extracted once a second consumer
(Batch 5) needed the same logic, so a bug fix only has to happen once. If you're touching fps
gating, pose overlay, or metric collection, this file — not either page — is almost certainly
where the change belongs.

**Batch 1 — pose overlay.** A video plays in a `<video>` element, and a `<canvas>` overlay draws
landmarks/connectors per frame. The animation loop (`startPoseLoop`/`cancelScheduledFrame` in the
hook file) lives at module scope, not inside the hook — keep it there: it's imperative ref-driven
code that intentionally calls `performance.now()` outside render, which trips React Compiler's
purity lint if nested inside a component/hook body. Prefers `requestVideoFrameCallback` (fires
once per actual decoded frame) over a plain `requestAnimationFrame` loop, falling back to rAF
where unsupported.

Detection is **synchronous** inside that per-frame callback — it blocks until
`detectForVideo` returns before scheduling the next frame — but the `<video>` element's own
playback keeps advancing in real time regardless of how long that takes. If inference is slower
than the real-time gap between frames (plausible with the `full` model switch above, especially
during fast motion), frames get silently skipped: the overlay visibly lags the real movement,
and footstrike detection loses samples too, not just the visuals — this was a second real,
user-reported symptom of the same model-speed tradeoff, not a separate bug. Fixed in
`handleLoadedMetadata` by setting `video.playbackRate = ANALYSIS_PLAYBACK_RATE` (0.5) before
playback can start, giving detection roughly 2x the real wall-clock time per actual video frame.
`video.currentTime` still means the same thing regardless of playback rate, so `PoseFrame`
timestamps (and everything timing-based built on them) are unaffected — this is purely a
"give detection enough wall-clock time" fix, not a change to what's measured. Both `/` and
`/pose-poc` tell the user playback is intentionally slowed, so it doesn't read as a glitch.

Uses `@mediapipe/tasks-vision` (WASM, runs fully in-browser — no server round-trip), loading
the model from Google's hosted CDN (`storage.googleapis.com/mediapipe-models`) at runtime, not
bundled locally. Uses the **`full`** model variant, not `lite` — `lite` was visibly
misaligned with the shoe on real footage (a user-reported observation, not a guess), which fed
directly into landing-form misclassification and probably some of the cadence over-counting too
(see `computeStrideDiagnostics`' doc comment in metrics.ts). `full` costs download size (~9.4MB
vs. ~5.8MB, one-time/cached) and some inference speed vs. `lite`, but is meaningfully more
accurate, especially on small/fast-moving points like heel and toe. `heavy` would be more
accurate still but risks not staying real-time — deliberately not used.

Model-load and fps-detection failures show a clean, friendly message (see
`running-brand-design-tokens.md`'s Voice section: "never a raw exception string") — the raw
technical error goes to `console.error` instead. This was a real bug caught by actually running
the report page in a browser (a headless one, via a throwaway Playwright script — no GPU
available there, so the pose model's GPU delegate reliably fails to initialize, which is exactly
what first surfaced the raw-exception-string leak), not something found by reading the code.

**Batch 2 — fps gate.** `src/lib/fps-detection.ts` implements PRD Section 5: `detectFps(file)`
reads the container's encoded frame rate via `mediainfo.js`, falling back to empirical frame
counting (via `requestVideoFrameCallback` on a hidden video element) if metadata is missing,
malformed, or outside ~15–480fps. `classifyFpsTier(fps)` sorts the result into the tiered gate
(full ≥120fps / reduced 60–119fps / blocked <60fps). The hook wires this in as an `FpsGateState`
that blocks the video from loading at all on a "blocked" result, offering a "continue without
landing form" button that proceeds with `landingFormAvailable: false`.

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
- `camera-angle.ts` — infers capture angle **from the pose data itself**, since nothing upstream
  asks the user for it. `inferCameraAngle(frames)` returns `"side" | "front-or-rear"` by checking
  how much the two hip landmarks separate in the camera's horizontal axis relative to torso
  height (a side-on shot collapses that separation toward zero — the anatomical left-right axis
  points into the screen, not across it). Defaults to `"front-or-rear"` (i.e. doesn't suppress
  hip drop) when there's too little data to tell — a false negative here is worse than an
  occasional imprecise number. `inferDirectionOfTravelAxis` + `inferTravelSign` separately infer
  which horizontal axis (and which way) the runner is translating along, from the hip midpoint's
  range of motion — used to sign overstride (see below), independent of the side/front-or-rear
  classification.
- `metrics.ts` — the six PRD-scoped functions (`computeCadence`, `computeVerticalOscillation`,
  `computeOverstride`, `computeHipDrop`, `computeArmSwingSymmetry`, `computeLandingForm`), plus
  two metrics added later that are **not** in the PRD's original list — `computeGroundContactTime`
  and `computeFlightTime` (see below) — and `computeMetrics(frames, fpsTier)` which runs all
  eight. Each returns `null` — not a misleading zero — when there isn't enough signal (too few
  frames/footstrikes) to compute a value; `computeLandingForm` also returns `null` when
  `fpsTier === "blocked"`, gating on the Batch 2 fps tier per PRD Section 5/6 (confidence is
  `"full"`/`"reduced"` mirroring that tier otherwise). The two added metrics aren't in the
  Supabase schema (`supabase/migrations/`) or the `analyses` API yet — see the Batch 4 section
  below — since nothing currently saves computed metrics from this page at all.
  - `computeHipDrop(frames, cameraAngle?)` now actually enforces the PRD's own caveat that it
    needs front/rear-angle video, instead of just documenting it: it calls `inferCameraAngle`
    (or accepts an explicit override) and returns `null` for a side-on shot, rather than the
    plausible-looking-but-meaningless number it used to silently produce. This was a real gap,
    not a hypothetical one — caught from testing against actual side-view footage.
  - `computeOverstride` reports a **signed** value (`OverstrideResult.signed: boolean`) when
    `inferDirectionOfTravelAxis` finds a clear direction of travel — positive means the foot
    landed ahead of the center of mass in that direction (the standard meaning of
    "overstriding"), negative means behind. Falls back to the old undirected horizontal-plane
    magnitude (always ≥ 0, `signed: false`) when no dominant direction is found (e.g. running in
    place, or a front/rear shot where "direction of travel across the frame" isn't meaningful).
  - `computeMetrics`'s result now includes a top-level `cameraAngle` field — computed once and
    reused for `hipDrop`'s gating, and surfaced so a caller (the pose-poc page's `MetricsPanel`)
    can explain *why* hip drop is unavailable, distinct from generic "not enough data".
  - Every per-strike/per-frame sample in `computeOverstride`, `computeHipDrop`,
    `computeLandingForm`, and `computeArmSwingSymmetry` is now filtered by MediaPipe's own
    landmark `visibility` score (see `pose-landmarks.ts`'s `isVisible`/`allVisible`,
    `PoseLandmark.visibility`) — a sample is skipped, not trusted, when the landmarks it needs
    are below `MIN_LANDMARK_VISIBILITY` (0.5). This matters most on a side-on shot, where the
    trailing/far-side limb is frequently partly hidden behind the body for stretches of the
    clip. `computeArmSwingSymmetry` filters each arm independently (`leftSampleCount` /
    `rightSampleCount` in its result) — one arm being occluded never corrupts the other's range
    of motion. A landmark with no `visibility` field at all (true of most synthetic test
    fixtures) is treated as fully trusted, so this is purely additive: it only ever excludes
    data, never invents it.
  - `computeOverstride` and `computeVerticalOscillation` now also report a leg-length-normalized
    percentage (`overstridePercentLegLength`, `oscillationPercentLegLength`) alongside the raw cm
    value, via a private `estimateLegLengthMeters` helper (max observed hip-to-ankle distance
    across the clip — a bent knee always *shortens* that distance, so the max is the closest
    proxy for true leg length at full extension). Motivated by looking at a competitor
    (ochy.io/Ochy): raw cm makes a taller runner's numbers look "bigger" for identical relative
    form; normalizing against the runner's own leg length (already sitting in the tracked
    landmarks — no new capture step) is the more comparable number. Null when no hip/ankle pair
    was ever visible enough to sample; the raw cm value is unaffected either way.
  - `computeGroundContactTime` and `computeFlightTime` (new) — also motivated by the Ochy
    research: time from footstrike to toe-off, and from toe-off to the next footstrike (either
    foot), the airborne phase distinguishing running from walking. Built on `strides.ts`'s new
    `detectStrides`/`detectAllStrides`, which extend footstrike detection with a **toe-off**
    event: the first point after a footstrike where the ankle-relative-height signal drops below
    a fraction (`DEFAULT_TOE_OFF_DROP_RATIO`, 0.3) of the way toward that stride's swing-phase
    trough — a simple threshold-crossing heuristic, not a biomechanically precise contact-force
    detector. Both new metrics are gated by the Batch 2 fps tier exactly like `computeLandingForm`
    (null when blocked, confidence `"full"`/`"reduced"` mirroring the tier) since accurate
    foot-contact timing needs the same frame-rate headroom as catching the strike-instant frame
    does — this pairing (fps sensitivity + a `confidence` field) is why they reuse
    `LandingFormConfidence` rather than inventing a parallel type.
  - `computeStrideDiagnostics` (new) — **not** a product metric, a debug/audit tool: one row per
    detected stride (both feet, chronological) with the raw numbers behind cadence (each strike's
    gap from the previous one in the combined stream — exactly what `computeCadence` averages)
    and landing form (raw heel/toe delta and classification, **not** fps-tier-gated like
    `computeLandingForm` — shows the underlying geometry regardless). Added after a user reported
    a cadence that looked too high and a landing-form frame that looked misclassified; wired into
    `useRunningFormAnalysis`'s `metrics.strideDiagnostics` and rendered as a table on the
    pose-poc page only (`StrideDiagnosticsTable`) — **not** on the real `/` report page, matching
    the existing pose-poc-is-the-debug-tool / `/` -is-the-product split. Built specifically so a
    human can cross-check a detected strike's timestamp and classification against what that
    instant in the source video actually shows, rather than guessing at a fix blind. Leading
    hypothesis for over-counted cadence: `detectAllFootstrikes` enforces a minimum separation
    *within* each foot's own signal but not *across* feet in the merged stream, so a noisy/
    spurious detection on one foot landing close to a real detection on the other foot drags the
    averaged interval down (and so the computed cadence up) — the diagnostic table's
    interval-from-previous column is exactly what would expose that. Not yet confirmed against
    real data; don't assume this is the fix without checking the table first.

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
Section 12. (Persistence and the design-tokens styling pass are no longer out of scope — see the
Batch 4 and Batch 5 sections below — but persistence isn't wired to any UI yet.)

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
  Numeric fields are also bounds-checked against physically-plausible ranges (`NUMBER_FIELD_BOUNDS`
  — e.g. cadence 1-400 spm, hip_drop 0-90°) so obviously-corrupt values get rejected with a 400
  instead of silently persisted; `score` is deliberately left unbounded since its scale isn't
  decided yet (PRD Section 12). Also exports `parsePaginationParams` (see below).
- `src/app/api/analyses/route.ts` (`POST` create, `GET` list-mine) and
  `src/app/api/analyses/[id]/route.ts` (`GET` one) — plain Web `Request`/`Response`, not
  `NextResponse` (no need for its extras here). `user_id` on create is always the authenticated
  caller's id, never trusted from the request body. A wrong-owner id 404s the same as a
  nonexistent one — RLS makes those indistinguishable by design, so there's no "exists but isn't
  yours" leak. `GET` (list) takes `?limit=&offset=` (default limit 20, max 100 — the query had no
  limit at all originally, fine while every user has a handful of rows, not once someone has a
  real history) and returns `{ analyses, limit, offset, hasMore }`; fetches `limit + 1` rows to
  compute `hasMore` without a separate count query.

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

**Explicitly out of scope so far**: wiring this into any UI (the Batch 5 report page doesn't call
it — sign-up/sign-in page, saving an analysis, history sidebar are all still missing); video
upload to Storage (`video_storage_path` column exists, nothing writes to it); the composite
`score` column (same open decision as Batch 3).

## Batch 5: report UI

`src/app/page.tsx` is now the real product page at `/` — not a placeholder, this replaces
`create-next-app`'s default homepage entirely. Uses `useRunningFormAnalysis` (see the Batch 1+2+3
section above) for the pipeline; this file is purely presentation, styled per
`running-brand-design-tokens.md`.

- **No hero number.** The design tokens call for "one hero number per screen" (the efficiency
  score, PRD Section 7) — not built here on purpose: its weighting formula is still an open
  decision (PRD Section 12), and showing *a* number would mean inventing one, not computing one.
  The metric grid shows all eight metrics (the original six plus the two Ochy-inspired additions)
  at equal visual weight instead. Don't add a hero number without that formula being decided
  first.
- **No recommendations section.** PRD Section 7's recommendations (one entry per flagged metric,
  with citations) are Batch 7 — there's no flagging logic yet to know which metric to flag, so
  there's nothing to show.
- **Typography**: `src/app/layout.tsx` loads three `next/font/google` fonts matching the design
  tokens' three-typeface system — Oswald (`--font-display`, condensed/high-contrast, for big
  numbers and section titles only), Inter (`--font-sans`, body/UI), JetBrains Mono
  (`--font-mono`, numeric readouts only). Each metric's primary value uses the display face at a
  consistent size — the tokens doc names "cadence" as an example of what gets display-face
  treatment, so this isn't a stretch of "big numbers... used for... section titles only"; "one
  hero number" is a size-hierarchy rule (nothing is blown up bigger than the rest), not a
  typeface restriction.
- **Colors**: `src/app/globals.css` defines the full token palette as CSS variables plus a
  Tailwind v4 `@theme inline` block (`bg-paper`, `text-ink`, `border-line`, `text-rust`,
  `text-field`, etc.) — one committed light aesthetic, no dark-mode variant, since the tokens doc
  doesn't define one. Rust is used only for the one state with an actual documented reason to
  flag it (overstride landing ahead of center of mass — the Voice section's own example sentence,
  "Overstriding on your left foot," is about exactly this) and for the fps-blocked/reduced tier
  colors already established in Batch 2. Metric values with no validated "good/bad" threshold
  stay neutral ink — don't invent accent-color judgments for metrics without a PRD-approved
  threshold backing them.
- **Motion**: limited to the one moment the tokens call for — the report revealing itself when
  metrics finish computing (a `fade-in` keyframe in `globals.css`, applied only to `MetricGrid`,
  which only ever mounts once metrics exist). Nothing animates on the upload/analyze steps.
- **Numbered steps** (`Step` component): used because upload → analyze → report is genuinely
  sequential, matching the tokens' "numbered steps only where the content is genuinely
  sequential" rule — not used decoratively elsewhere.

Verified in a real (headless, via a throwaway Playwright script) browser, not just `npm run
build` — computed fonts/colors read back correctly (`getComputedStyle`), and this pass is what
caught the raw-exception-string bug described in the Batch 1+2+3 section above. Screenshot
reviewed, not just asserted.

## Post-Batch-5 fix: vertical oscillation was always 0 (world vs. normalized landmarks)

`computeVerticalOscillation` always returned ~0cm on real footage. Root cause (confirmed via
MediaPipe's own docs, not guessed): **world landmarks re-center their coordinate origin to the hip
midpoint on every single frame.** That makes world landmarks excellent for same-frame/relative
measurements (limb lengths, joint angles, one landmark vs. another) but structurally unable to
track how a joint's *own* position changes *across* frames — the hip's own world-Y is always ~0 by
construction, so a function reading `hip.y` over time can never see bounce. This isn't a
peak-detection bug; it's the wrong coordinate space for the measurement.

The same bug silently broke `inferDirectionOfTravelAxis`/`inferTravelSign` (signed overstride) —
their unit tests passed because synthetic fixtures artificially moved the hip over time, which
isn't how real MediaPipe world-landmark output behaves.

**Fix**: `PoseFrame` (`pose-landmarks.ts`) gained an optional `normalizedLandmarks` field —
`PoseLandmarkerResult.landmarks[0]`, genuine absolute image-plane x/y (not recentered), fed
alongside `worldLandmarks` from `useRunningFormAnalysis.ts`'s detection loop. `z` on normalized
landmarks is still hip-relative depth, same as world — never treat it as absolute. A new
`tryNormalizedLandmark()` accessor returns `null` rather than throwing when it's absent (older/
synthetic frames can omit it).

- `computeVerticalOscillation` (`metrics.ts`) now tracks normalized hip-mid Y across frames instead
  of world hip Y. Since normalized units are dimensionless (not meters), a new
  `estimateLegLengthNormalized2D` helper measures the same leg-length reference distance in
  normalized 2D (x/y only, z excluded) as `estimateLegLengthMeters` does in world meters; the ratio
  between the two gives a real "meters per normalized unit" calibration factor. Returns `null` (not
  a number derived from nothing) when frames lack normalized data or leg length can't be estimated
  in both spaces.
- `inferDirectionOfTravelAxis`/`inferTravelSign` (`camera-angle.ts`) now read normalized hip-mid X
  instead of world hip X/Z. `TravelAxis` shrank from `"x" | "z"` to just `"x"` — world-z's old role
  (a second candidate axis) has no normalized equivalent, since normalized Y is already vertical
  oscillation's signal and normalized Z is still hip-relative depth. The old `MIN_DOMINANT_AXIS_RATIO`
  (x-range vs. z-range) is replaced by a body-scale-relative threshold: hip-mid x range must exceed
  ~3x the average normalized hip width to count as real travel rather than sway/jitter, so the
  threshold self-scales with how zoomed-in the shot is. `inferTravelSign` dropped its `axis`
  parameter (only one axis exists now). `computeOverstride`'s magnitude calculation is unchanged —
  it's a same-frame world-landmark measurement, unaffected by this issue; only the *sign* source
  changed.
- `inferCameraAngle`, `computeHipDrop`, `computeCadence`/footstrike detection, `estimateLegLengthMeters`,
  `computeArmSwingSymmetry`, `computeGroundContactTime`/`computeFlightTime`, `computeLandingForm` are
  all same-frame/relative measurements and were **not** affected by this bug — confirmed by auditing
  every metric function against the world-landmark-origin-reset behavior before touching any code.

Verified via Vitest (118 tests passing, including new fixtures for `tryNormalizedLandmark`, the
rewritten `inferDirectionOfTravelAxis`/`inferTravelSign`, and vertical-oscillation calibration) plus
`npm run lint` and `npm run build`.

## Per-stride strip plots (UI, on top of the metrics above)

`src/app/page.tsx`'s report cards for Cadence, Hip drop, and Arm swing symmetry each show a small
dot-per-stride strip plot (`StripPlot` component) below the headline number, so session-wide
*consistency* is visible at a glance instead of only the averaged value. Deliberately not a
charting-library widget — this project has no chart dependency anywhere, and three small plots
don't justify adding one; it's plain SVG-free CSS (absolutely-positioned dots on a hairline axis,
3-lane vertical stagger so overlapping values stay visible as distinct dots, mono-font axis
labels per the type system's numeric-readout rule).

This required extending three `metrics.ts` functions to expose per-sample arrays, not just
aggregates — `computeCadence.perStrideStepsPerMinute`, `computeHipDrop.samples`,
`computeArmSwingSymmetry.perStrideSymmetryScores`. The arm-swing one is a genuinely new
computation, not just exposing an already-computed array: the headline `symmetryScore` is
deliberately a whole-clip aggregate (see that function's doc comment — arm swing symmetry is
about overall balance, not one cycle), so per-stride scores are computed independently by
windowing the same left/right elbow-angle-range calculation into each combined
footstrike-to-footstrike interval (the same segmentation `computeVerticalOscillation` uses), skipping
any window with fewer than 2 visible samples for either arm.

## Cadence over-counting fix (cross-foot false-positive footstrikes)

A user reported an implausible ~250spm cadence reading (even elite distance-running cadence
rarely exceeds the low 200s). Root cause, confirmed with a synthetic reproduction before touching
any code (`strides.test.ts`'s "does not let a spurious close cross-foot detection collapse the
merged interval" test — written first, verified it failed against the old code, then fixed):
`detectFootstrikes`'s `minSeparationMs` (300ms, "~200 strides/min per leg ceiling") only
constrains peaks *within one foot's own signal*. A spurious secondary peak — pose-tracking jitter
producing a second, smaller-but-still-prominence-qualifying bump well away from that foot's own
real strikes — could survive that per-foot check yet land almost exactly when the *other* foot
had a genuine strike. `detectAllFootstrikes`/`detectAllStrides` then just merged-and-sorted both
feet with no further check, so that pairing collapsed into a near-zero-ms gap in the combined
stream. `computeCadence` averages every gap in that stream — a handful of near-zero gaps pulls
the average interval down and the reported steps/min up, exactly the inflation reported.

Fix: both `detectAllFootstrikes` and `detectAllStrides` now pass their merged, sorted stream
through a new shared `mergeCrossFootFiltered` helper that drops any event landing less than half
of `minSeparationMs` after the previously *kept* event, regardless of which foot it came from.
Half is physically motivated, not an arbitrary extra constant: if one leg's own fastest plausible
turnover is `minSeparationMs` apart, the fastest the *two* legs could ever alternate (perfectly
out of phase) is half that. `detectAllStrides` needed the identical fix — it has the same
merge-without-cross-foot-check shape, and a collapsed gap there would have corrupted
`computeGroundContactTime`/`computeFlightTime` and the stride-diagnostics debug table the same
way. `detectFootstrikes`/`detectStrides` (the single-foot functions) are unchanged — the bug was
only ever in how the two feet's streams get combined.

Verified via Vitest (122 tests passing, including the new regression test) plus `npm run lint` and
`npm run build`. Not yet re-verified against the user's actual footage — ask them to re-check the
report (or the `/pose-poc` stride-diagnostics table, which will now also no longer show
near-zero `Δ prev (ms)` rows) once they re-test.

## Live metrics during playback (not just on pause/end)

`useRunningFormAnalysis.ts` originally only called `computeMetrics` from `handlePause`/on `ended` —
the report stayed static while a video was actually playing. Now the module-scope pose loop
(`onFrame`, see that section's own module-scope-vs-component-body note above) also triggers a
recompute during playback, throttled to once every `LIVE_METRICS_UPDATE_INTERVAL_MS` (500ms, not
every detected frame) — a full recompute re-scans the *entire* frame buffer (footstrike
peak-detection isn't incremental), and `detectForVideo` already runs once per decoded frame as the
tight part of this loop; stacking a full metrics recompute on every one of those calls too would
add real competing CPU work. Twice a second reads as "live" to someone watching the numbers
without doing that.

Mechanism, since `onFrame` is intentionally outside the component (same purity reasoning as the
rest of that loop) and can't just call a function closed over the render that started playback —
that closure would go stale the moment `fpsGate` or `setMetrics` changed identity:
`recomputeMetricsRef` (a `LoopRefs` member) is kept pointing at the *current* render's
`recomputeMetrics` via a no-dependency-array `useEffect` (runs after every render — the standard
"latest ref" pattern), and `onFrame` calls `refs.recomputeMetricsRef.current()` instead of a
captured function. `lastLiveUpdateAtRef` tracks the wall-clock (`performance.now()`) gate and
resets to 0 on a new file selection.

No change to `recomputeMetrics` itself or to what gets computed — same function, same
`fpsGate.phase !== "resolved"` guard, same "not enough data yet" null-handling the UI already
renders correctly; it's purely called more often now. `/` and `/pose-poc`'s copy both updated to
describe this.

## Batch 6: history sidebar (+ the sign-in and saving it depends on)

PRD Section 8. History needed two things that didn't exist yet, so they were built first:

- **Auth is proxied, not browser-direct.** `src/app/api/auth/{sign-up,sign-in,refresh}/route.ts`
  (helpers in `src/lib/supabase/auth.ts`) wrap Supabase email + password auth with the anon key.
  The browser never talks to Supabase itself: `NEXT_PUBLIC_SUPABASE_URL` is a local
  `127.0.0.1:54321`, unreachable for anyone visiting through a Cloudflare tunnel — only the Next
  server can reach it. Supabase's raw auth errors are mapped to plain copy (`friendlyAuthError`).
  Local email confirmation is off (`supabase/config.toml`), so sign-up returns a session at once;
  with confirmation on, sign-up returns a "check your email" 409 instead of a half-signed-in state.
- `src/hooks/useSession.ts` — session in `localStorage` (every access try/caught), refreshed
  ~60s before expiry and retried once on a 401 via `authedFetch`. `src/hooks/useHistory.ts` —
  pages `GET /api/analyses` (refetches on user change, not on token refresh).
- **Saving**: `src/lib/history/to-analysis-input.ts` maps a `MetricsResult` to the
  `POST /api/analyses` body (null stays null; no `score`; empty `flags` — no flagging logic until
  Batch 7). `SaveRun` in `page.tsx` is disabled while the video plays (the live report is still
  changing) and saves once per loaded video. Only headline numbers persist — no video, strip
  plots, camera angle, or leg-length %, and the saved view says so.
- **Migration** `20261003000000_analyses_contact_flight_time.sql` adds `ground_contact_time` and
  `flight_time` (ms, nullable, bounded 0-2000 in `analyses.ts`) so saved reports keep all 8 metrics.
- **UI**: `src/components/history/HistorySidebar.tsx` (sign-in form when signed out; otherwise
  "New analysis" + newest-first list: date in mono as the label, cadence as the quiet second
  line — the PRD's score doesn't exist yet) and `SavedReport.tsx`. Shared cards moved from
  `page.tsx` to `src/components/report.tsx` (a page file can't export helpers). The live analysis
  stays mounted but `hidden` while a saved run is open, so switching back keeps the video. A saved
  positive overstride gets no rust flag: whether it was signed isn't stored.
- **Not built, on purpose**: progress delta (needs the score) and the score itself.

Tests: `src/app/api/auth/auth.supabase.test.ts` (real local Supabase: sign up → sign in → refresh
→ save with the new columns → list; duplicate email; wrong password; bad refresh token) and
`to-analysis-input.test.ts`. Also walked through in real Chrome (sign-up, list, saved view,
back to live, reload persistence, mobile width, sign-out, wrong password). The "Save to history"
click itself wasn't exercised in-browser — it needs footage with a real person in it.

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
frontend build, not a separate visual pass. Applied to `/` (Batch 5, see that section above) —
**not** applied to `/pose-poc`, which stays deliberately unstyled as a dev harness.

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

### Local divergence: dark theme + `--energy` accent (not in the shared tokens doc)

A "revamp the UI for the sport's nuance" request went through two iterations — both **app-local**,
confirmed with the user, not edited into `running-brand-design-tokens.md` (the separate Volt and
Fast product also depends on that doc; this keeps that product's identity from silently changing
without its own team's sign-off). If the two products' identities get reconciled later, this
section is what to fold back in (or drop, if the shared decision differs).

**Round 1 (superseded)**: added `--energy: #5c6b00`, a deepened chartreuse, as the default
headline-number color, keeping the light paper/ink base otherwise unchanged. Follow-up feedback
("the background still the same like creamy-theme... we need a strong, sport-defined UI") made
clear this didn't go far enough — kept here only as history, not the current state.

**Round 2 (current)**: a full dark-theme flip of `globals.css`'s `:root` values. Variable NAMES
are unchanged (`--ink` is still "primary text," `--paper` is still "background") so every
`bg-paper`/`text-ink`/etc. class across the codebase kept working with a zero-touch rename — only
the hex VALUES inverted. Read each name as its role, not its literal English meaning.

| Token | Old (light) | New (dark) | Why |
|---|---|---|---|
| `--ink` (text) | `#12130f` | `#f2efe6` | was near-black text, now near-white |
| `--paper` (background) | `#f2efe6` | `#15140f` | was cream, now near-black (warm-tinted, not cold blue-black — keeps the earthy family) |
| `--stone` (muted text) | `#b8b2a1` | unchanged | already clears 8.71:1 against the new dark background, no change needed |
| `--rust` (warning accent) | `#b5502e` | `#ff7a4d` | the original was tuned as dark text on light paper — ~3.65:1 against the new dark background, brightened to 7.15:1 |
| `--field` (good/on-track accent) | `#3c4a2e` | `#8fbf5a` | the original computed to ~1.9:1 against the new dark background — would have been functionally invisible; brightened to 8.58:1 |
| `--energy` (headline-number accent) | `#5c6b00` | `#d4ff4f` | this is the *original* neon-lime pitch from Round 1, rejected then for failing contrast on light paper (~1:1) — on a dark background the same bright color clears 16:1. No new color needed, just the surface it was always right for |
| `--line` (hairline borders) | `#dad5c6` | `#2a281f` | deliberately LOW contrast (~1.25:1) against the new background, matching the light theme's own ~1.28:1 line-vs-paper subtlety — hairlines read as felt, not read, so this intentionally does NOT follow the 4.5:1 text-contrast rule the other rows do |

Every ratio above was computed with a WCAG relative-luminance script before use, not eyeballed —
see `globals.css`'s own comment block for the same table inline with the code.

Also added `color-scheme: dark` on `body` so native widgets (the `<video>` control bar, the hidden
file-input's OS picker, scrollbars) render their dark variant instead of a jarring light default.

**Known side effect, not a bug**: `/pose-poc` is documented elsewhere in this file as deliberately
unstyled — but it was always implicitly inheriting its base background/text color from this same
global `body` rule (its own inline styles only set text/border colors, never the page background),
so it now renders dark too. Verified it's still fully legible (checked via screenshot) — if it
ever isn't, that page's own hardcoded inline hex colors are the thing to fix, not this token file.

Typography (Oswald/Inter/JetBrains Mono), layout, and motion are unchanged in both rounds — the
user picked a dark flip of the existing identity over two bigger alternatives a design-system
search also surfaced (a saturated red/gold "stadium" direction, and swapping to Barlow Condensed)
— both still available as a reference if asked for again, but don't revisit unprompted.
