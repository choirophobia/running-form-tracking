# Running form analysis SaaS — PRD v0

## 1. Problem & goal

Individual runners have no accessible way to check their running form against published biomechanics research. Lab-grade motion capture (Vicon, EMG) is expensive and inaccessible; social-media-style pose overlays exist but aren't grounded in real thresholds. This product gives runners a self-check tool: upload a video, get metrics backed by research, get a trend over time, get a research-cited (never invented) suggestion for what to work on.

**Constraint:** must run at zero infrastructure cost. All inference happens client-side; the backend only stores small JSON payloads.

## 2. Target user (v0)

Individual runners, self-serve, not tied to a coach or clinic. No run-type segmentation — one continuous history regardless of easy run, tempo, race, etc.

## 3. Scope

**In scope (v0):**
- Upload-based analysis only (no real-time/live camera)
- Web app (Next.js), not a native app or Google Apps Script
- Single-camera 2D video input
- Session history with progress tracking
- Research-cited exercise recommendations

**Explicitly out of scope (v0):**
- Real-time/live capture
- Run-type-specific comparison (generalized history only)
- Any claim of measuring "running economy" (physiological, lab-only term) or "muscle activation" (requires EMG) — see Section 6 for the renamed/scoped alternatives
- Pace/speed in min/km, unless the user manually supplies GPS pace alongside the video (no camera-only scale reference exists)

## 4. Architecture

| Layer | Choice | Why |
|---|---|---|
| Pose extraction | MediaPipe Pose Landmarker, client-side (WASM/JS) | Zero server compute; validated against Vicon in published research (joint angle error <5°) |
| Frontend | Next.js | Free-tier friendly, matches the Vercel deploy target |
| Hosting | Vercel (free tier) | Zero cost |
| Backend/API | Next.js API routes on Vercel | No separate server needed |
| Database + Auth + Storage | Supabase (free tier) | Managed Postgres, auth, and object storage in one free service |

The browser does all pose extraction and metric computation. The API layer only receives the computed landmark/metric JSON (not raw video, unless the user opts to keep the source clip in Storage) — this is what keeps compute cost at zero regardless of usage volume.

## 5. FPS validation — technical approach

**Goal:** catch a video that's too slow for landing-form detection *before* it goes through the full pipeline, without blocking users who only need the other four metrics.

**Detection method (in order of preference):**
1. **Primary: container metadata read.** Use `mediainfo.js` (WASM build) to parse the video file's header and read the encoded frame rate directly, entirely client-side. Fast (reads only the header, not the full file), zero server cost.
2. **Fallback: empirical frame counting.** If metadata is missing, malformed, or reports an implausible value (e.g. some phone exports mis-report fps), decode the first ~2 seconds using `requestVideoFrameCallback()` and count actual frame timestamps. Slower, but catches cases metadata gets wrong.

Run the fallback automatically whenever the metadata read fails or returns a value outside a sane range (e.g. <15fps or >480fps) — don't require the user to trigger it manually.

**Tiered gate (not a hard pass/fail):**

| Detected fps | Behavior |
|---|---|
| ≥120fps | Full analysis, landing form included at full confidence |
| 60–119fps | Full analysis; landing form metric shown with a "reduced confidence" label instead of hidden |
| <60fps | Upload blocked by default with a message explaining slow-mo is needed for landing form, plus a "continue without landing form" option that disables only that metric and proceeds with the rest |

This runs **before upload starts** (metadata read needs only the file locally, not a network round-trip) so the user gets the message instantly rather than after waiting for an upload.

## 6. Metrics — scope and confidence labeling

| Metric | Status | Notes |
|---|---|---|
| Cadence | Full confidence | Direct from stride timing |
| Vertical oscillation | Full confidence | Hip landmark bounce |
| Overstride | Full confidence | Foot-strike position vs. center of mass |
| Hip drop | Full confidence | Requires front/rear-angle video |
| Arm swing symmetry | Full confidence | Shoulder/elbow angle tracking |
| Landing form | Confidence-gated | Full at ≥120fps, reduced-confidence at 60–119fps, unavailable below 60fps |
| Pace | Optional, user-supplied | No camera-only scale reference exists; accept optional GPS pace input, or restrict to a future treadmill mode where speed is already known |
| "Running economy" | **Never claimed** | Physiological, lab-only metric (metabolic cart). Product instead surfaces a biomechanical efficiency score correlated with economy in the literature — labeled as such, never as economy itself |
| "Hip flexor active/not" | **Never claimed as muscle activity** | Requires EMG. Product instead shows hip flexion angle/range during swing phase as a kinematic proxy, explicitly not framed as muscle activation |

## 7. Report output

- Source video frame with pose overlay (skeleton drawn via canvas, using the same landmarks used for metrics — no separate rendering pipeline)
- One hero number: efficiency score (composite, weighted against published thresholds)
- Metric grid: all 5 full-confidence metrics + landing form (with confidence label) shown together, never a subset
- **Recommendations section**, one entry per flagged metric:
  - Exercise/drill name
  - One-line rationale
  - A real citation (author/year) — if no citation exists at adequate confidence, the entry must say "limited evidence" explicitly rather than fabricate one
  - A linked video reference, pulled from a maintained, curated table (not hardcoded per-metric) so dead links can be swapped without a code change
- Fixed disclaimer directly below recommendations: this is a suggestion only, not medical advice; consult a coach, physiotherapist, or doctor before starting new exercises, especially with pain or an existing injury

## 8. History & progress

- Left sidebar (Claude Desktop-style history pattern): reverse-chronological list of past analyses
- Each entry: date as the primary label, score as a quiet secondary line beneath it
- Selecting an entry loads that full report in the main panel
- Progress delta: current score vs. immediately preceding session, shown as a signed point difference next to the hero score
- No run-type segmentation — one continuous history

## 9. Data model (Supabase Postgres, sketch)

```
users
  id, email, created_at

analyses
  id, user_id (FK), recorded_at, video_fps, video_storage_path (nullable),
  score, cadence, vertical_oscillation, overstride, hip_drop, arm_swing_symmetry,
  landing_form (nullable), landing_form_confidence (enum: full/reduced/unavailable),
  flags (array of metric names), created_at
```

## 10. Design system

Follow `running-brand-design-tokens.md` (colors, type pairing, layout principles) already established — this is the single source of truth for the frontend build, not a separate visual pass.

## 11. Build note for Claude Code

Recommended build order: (1) client-side pose extraction + skeleton overlay proof of concept, (2) fps detection with the tiered gate, (3) metric computation functions with unit tests against known reference angles, (4) Supabase schema + API routes, (5) report UI using the design tokens, (6) history sidebar, (7) recommendations engine with the curated citation/video table.

## 12. Open decisions

- Exact efficiency-score weighting formula across the 5 metrics — needs a first pass before build, likely simple weighted average to start, refined later
- Where the curated video/citation table lives (a Supabase table vs. a static JSON file) — static JSON is simpler for v0 and avoids an extra DB round-trip
