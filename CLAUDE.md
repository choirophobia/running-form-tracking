# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project status

Batch 1 (pose-detection PoC) and Batch 2 (fps detection + tiered gate) are done, both living in
`src/app/pose-poc/page.tsx` — see the section below. Everything past that (metrics, Supabase,
auth, history, recommendations) is not built yet. Read `running-form-saas-prd-v0.md` and
`running-brand-design-tokens.md` in full before extending this — they are the source of truth,
not this summary.

Recommended build order (from the PRD, Section 11):
1. Client-side pose extraction + skeleton overlay proof of concept — **done**
2. FPS detection with the tiered confidence gate — **done**
3. Metric computation functions, with unit tests against known reference angles
4. Supabase schema + API routes
5. Report UI using the design tokens
6. History sidebar
7. Recommendations engine with the curated citation/video table

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Start (prod): `npm run start`
- Lint: `npm run lint`

Scaffolded with `create-next-app` (App Router, TypeScript, Tailwind v4, ESLint). Next.js 16 —
its APIs/conventions may differ from training data; see `AGENTS.md` / `node_modules/next/dist/docs/`
before writing Next.js-specific code.

## Batch 1+2: pose detection + fps gate proof of concept

`src/app/pose-poc/page.tsx` — a standalone page (not the final app UI), still intentionally
unstyled (no design-tokens pass yet), no metric computation, no persistence. On file select it
runs the Batch 2 fps gate first; only videos that pass (or are explicitly continued past) reach
the Batch 1 pose overlay.

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

Once pose extraction + fps gating are validated against a real running video, this page's logic
becomes the basis for the real upload/analysis flow — don't build further batches on top of it
until that validation happens.

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

### Data model (Supabase Postgres, PRD Section 9, not yet built)

```
users
  id, email, created_at

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
