# Running Form Tracker

A running-form analysis tool: upload a video of yourself running, and get real biomechanical
metrics (cadence, vertical oscillation, overstride, hip drop, arm swing symmetry, landing form)
computed from pose tracking — entirely in your browser, no video ever leaves your device unless
you explicitly choose to save it.

Full product spec: [`running-form-saas-prd-v0.md`](./running-form-saas-prd-v0.md).
Design system: [`running-brand-design-tokens.md`](./running-brand-design-tokens.md).
Guidance for AI coding agents working in this repo: [`CLAUDE.md`](./CLAUDE.md).

## What's actually built vs. what's still a spec

This is important context before you read anything else here: **this repo is a working proof of
concept, not a finished product.** Read this table before assuming a feature exists.

| # | Piece | Status |
|---|---|---|
| 1 | Client-side pose extraction + skeleton overlay | ✅ Built |
| 2 | FPS detection with a tiered confidence gate | ✅ Built |
| 3 | Metric computation — cadence, vertical oscillation, overstride, hip drop, arm swing symmetry, landing form, ground contact time, flight time (8 metrics) | ✅ Built, camera-angle-aware, leg-length-normalized |
| 4 | Database schema + API routes (Supabase) | ✅ Built, **not wired to any UI yet** |
| 5 | Real report UI, styled to the design system | ✅ Built — `/` |
| 6 | History sidebar (past sessions, progress over time) | ⬜ Not started |
| 7 | Recommendations engine (cited exercises per flagged metric) | ⬜ Not started |

`/` is the real, styled product page (upload → analyze → report). There's still no sign-up/login
flow and nothing persists anywhere yet — Batch 4's database exists and works, but the browser
page doesn't call it. `/pose-poc` is a separate, deliberately unstyled developer page running the
exact same pipeline, kept around for debugging: it adds a per-stride diagnostics table (raw
cadence intervals and landing-form geometry) that `/` intentionally doesn't show.

## Try it yourself

```bash
npm install
npx supabase start   # local Postgres/Auth/Storage via Docker — see "Local Supabase" below
npm run dev
```

Open `http://localhost:3000`, upload a video of yourself running, and let it play. (Prefer the raw
numbers and a per-stride debug table instead of the styled report? Use `http://localhost:3000/pose-poc` —
same pipeline, deliberately unstyled.)

What you'll see:
1. **FPS check** — reads the video's real frame rate before anything else runs, and gates
   accordingly: full confidence at ≥120fps, reduced confidence at 60-119fps, or blocked below
   60fps (with an option to continue anyway, minus the landing-form metric).
2. **Skeleton overlay** — MediaPipe's pose model tracks your joints live on top of the video.
   Playback runs at half speed so client-side detection has enough wall-clock time to keep up
   with fast motion without dropping frames — `video.currentTime` (and every metric built on it)
   is unaffected, this is purely a frame-budget fix.
3. **Computed metrics** — pause the video (or let it finish) and a report appears with all eight
   metrics: cadence, vertical oscillation, overstride, hip drop, arm swing symmetry, landing
   form, ground contact time, and flight time — each with a confidence label or an honest "not
   enough data" instead of a guessed number.

There's also a "Camera angle detected" line — the metrics module infers whether your video is
side-on or front/rear-facing from the pose data itself, and disables hip drop entirely on a
side-on shot rather than showing a meaningless number (hip drop genuinely can't be measured from
the side — the two hip landmarks nearly overlap when viewed edge-on). Overstride and vertical
oscillation are also reported as a percentage of your own estimated leg length, so the numbers
are comparable across runners of different heights, not just raw cm.

## Why it can be free to run

The entire pose-tracking pipeline — video decode, pose landmark extraction, every metric
calculation — runs in your browser via WebAssembly (MediaPipe). Nothing gets uploaded to compute
an analysis. The only thing a server ever sees, if this were fully wired up, is the small JSON
result (a few numbers), not the video. That's a deliberate architectural constraint, not an
accident: it's what keeps this runnable at zero infrastructure cost regardless of how many
people use it. See `running-form-saas-prd-v0.md` Section 4 for the full reasoning.

## Tech stack

| Layer | Choice |
|---|---|
| Pose extraction | [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker), client-side WASM |
| Frame-rate detection | [mediainfo.js](https://mediainfo.js.org/) (container metadata) with a frame-counting fallback |
| Frontend | [Next.js](https://nextjs.org) 16 (App Router), TypeScript |
| Database / Auth / Storage | [Supabase](https://supabase.com) (Postgres + Row Level Security) |
| Testing | [Vitest](https://vitest.dev) |
| Target hosting | Vercel (frontend + API routes) + Supabase, both free-tier |

Both MediaPipe and mediainfo.js are loaded from a CDN at runtime rather than bundled — see
`CLAUDE.md` for why (a real bug this caused, and how it was fixed and verified). Pose detection
uses MediaPipe's **`full`** model variant (not `lite`) for better accuracy on small/fast-moving
points like the heel and toe — `lite` was visibly misaligned with the shoe on real footage.

## Local development

### Prerequisites

- Node.js and npm
- [Docker](https://www.docker.com/) (for running Supabase locally)

### Install and run

```bash
npm install
npm run dev          # http://localhost:3000
```

### Local Supabase

The database/API layer (Batch 4) needs a Supabase instance. This project runs one **locally via
Docker** rather than against a hosted project — see `CLAUDE.md` for why.

```bash
npx supabase start   # first run pulls Docker images, can take a few minutes
```

This prints a local URL and API keys. Copy them into `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from the start output>
SUPABASE_SERVICE_ROLE_KEY=<service role key from the start output>
```

(`.env.local` is gitignored — these are also Supabase's standard local-dev demo keys, not real
secrets.) The schema migration applies automatically on first start.

```bash
npx supabase status  # reprint connection details / check it's running
npx supabase stop    # stop it
npx supabase db reset  # reapply migrations from scratch
```

### Tests

```bash
npm test              # run once
npm run test:watch    # watch mode
```

Most tests are pure unit tests against synthetic data (no external dependencies). The API route
tests (`src/app/api/analyses/route.supabase.test.ts`) hit the **real** local Supabase instance —
they'll fail immediately with a clear message if `npx supabase start` hasn't been run.

### Lint & build

```bash
npm run lint
npm run build
```

## Project structure

```
src/
  app/
    page.tsx              # Batch 5: the real, styled report UI at "/"
    pose-poc/              # unstyled developer page, same pipeline + a debug diagnostics table
    api/analyses/           # Batch 4: save/list/get analyses (not wired to any UI)
  hooks/
    useRunningFormAnalysis.ts  # shared pipeline (fps gate, pose loop, metrics) used by both pages
  lib/
    fps-detection.ts     # Batch 2: frame-rate detection + tiered gate
    metrics/              # Batch 3: pose-frame -> running-form metrics
      geometry.ts          # generic 3D vector/angle math
      pose-landmarks.ts    # MediaPipe landmark indices, types, world/normalized landmark handling
      strides.ts            # footstrike + toe-off detection (shared by several metrics)
      camera-angle.ts       # infers side vs. front/rear framing and direction of travel from pose data
      metrics.ts             # the eight metric-computation functions
    supabase/             # Batch 4: request auth, validation, pagination
supabase/
  migrations/            # database schema (profiles, analyses) + Row Level Security
running-form-saas-prd-v0.md          # full product spec — the source of truth
running-brand-design-tokens.md       # shared design system (colors, type, layout)
CLAUDE.md                             # detailed technical notes for AI coding agents
```

## Key constraints this project holds itself to

These come directly from the product spec (`running-form-saas-prd-v0.md`) and shape a lot of the
implementation decisions above:

- **Zero infrastructure cost.** All inference runs client-side; a server only ever sees computed
  numbers, never raw video, unless a user explicitly opts to keep the source clip.
- **Never claims lab-only metrics.** "Running economy" (needs a metabolic cart) and "muscle
  activation" (needs EMG) are never claimed — this product surfaces a labeled biomechanical
  efficiency score and kinematic proxies instead, explicitly not framed as those clinical
  measurements.
- **No fabricated pace.** No min/km pace is shown unless the user manually supplies GPS pace —
  there's no camera-only way to derive real-world speed from monocular video.
- **Recommendations must cite real research**, or explicitly say "limited evidence" — never a
  fabricated citation (relevant once the recommendations engine, Batch 7, is built).

## Status of this README

Written to reflect the codebase through Batch 5 (the real report UI at `/`) plus the
ground-contact-time/flight-time metrics, the `full` pose model switch, the playback-rate fix, and
the fix that made vertical oscillation and signed overstride actually work on real footage
(tracked via normalized rather than world landmarks — see `CLAUDE.md`). If you're reading this
much later and something here looks stale, `CLAUDE.md`'s "Project status" section and the git log
are more current than this file's prose.
