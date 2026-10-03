"use client";

import { useState } from "react";
import { HistorySidebar } from "@/components/history/HistorySidebar";
import { SavedReport } from "@/components/history/SavedReport";
import { MetricCard, MetricGroup, PctOfLegLength, Step } from "@/components/report";
import { useHistory } from "@/hooks/useHistory";
import { TIER_LABEL, useRunningFormAnalysis } from "@/hooks/useRunningFormAnalysis";
import { useSession, type UseSessionResult } from "@/hooks/useSession";
import { toAnalysisInput } from "@/lib/history/to-analysis-input";
import type { MetricsResult } from "@/lib/metrics";

// Batch 5: the real report UI, styled per running-brand-design-tokens.md.
// Runs the same pipeline as the pose-poc dev page (via
// useRunningFormAnalysis) but without that page's dev-only test-threshold
// toggle, and with design-system layout/typography instead of raw markup.
//
// Deliberately has no "hero number": PRD Section 7's hero (the composite
// efficiency score) has no weighting formula yet (Section 12, open
// decision) — showing one would mean inventing a number, not computing
// one. The metric grid shows every metric at equal visual weight instead.
// Recommendations (PRD Section 7, Batch 7) also aren't built — there's
// nothing to flag metrics against yet.
//
// Batch 6 adds PRD Section 8's history: a left sidebar (sign-in, then the
// user's saved runs), a "Save to history" control under the live report,
// and a saved-run view in the main panel. The live analysis stays mounted
// (just hidden) while a saved run is open, so going back to it doesn't
// lose the current video or its computed metrics.

export default function Home() {
  const auth = useSession();
  const history = useHistory(auth.session, auth.authedFetch);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Signing out (or into another account) must not leave a previous
  // account's saved run open — derive it from the current list instead of
  // storing the row itself.
  const selected = history.analyses.find((a) => a.id === selectedId) ?? null;

  const {
    status,
    videoRef,
    canvasRef,
    videoUrl,
    fpsGate,
    metrics,
    handleFileSelect,
    handleContinueWithoutLandingForm,
    handleLoadedMetadata,
    handlePlay,
    handlePause,
  } = useRunningFormAnalysis();

  return (
    <div className="md:flex">
      <HistorySidebar
        auth={auth}
        history={history}
        selectedId={selected?.id ?? null}
        onSelect={(id) => {
          videoRef.current?.pause();
          setSelectedId(id);
        }}
        onNewAnalysis={() => setSelectedId(null)}
      />

      {selected && (
        <main className="w-full max-w-3xl min-w-0 px-6 py-10 sm:px-10">
          <SavedReport analysis={selected} />
        </main>
      )}

      <main hidden={selected !== null} className="w-full max-w-3xl min-w-0 px-6 py-10 sm:px-10">
        <header className="mb-10">
          <h1 className="font-display text-3xl uppercase tracking-wide text-ink sm:text-4xl">
            Running Form Tracker
          </h1>
          <p className="mt-2 max-w-prose text-sm text-stone">
            Upload a video of yourself running. Pose tracking and every metric below run entirely
            in your browser — your video never leaves it. Signed in, you can save the computed
            numbers to your history.
          </p>
        </header>

        <Step number={1} title="Upload your video">
          {status.phase === "loading-model" && (
            <p className="text-sm text-stone">Loading pose model…</p>
          )}
          {status.phase === "error" && <p className="text-sm text-rust">{status.message}</p>}

          <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center border border-line px-4 py-2 text-sm text-ink transition-colors hover:border-ink">
            <input
              type="file"
              accept="video/*"
              className="hidden"
              disabled={status.phase === "loading-model"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
            Choose a video
          </label>

          {fpsGate.phase === "checking" && (
            <p className="mt-3 text-sm text-stone">Checking video frame rate…</p>
          )}
          {fpsGate.phase === "error" && <p className="mt-3 text-sm text-rust">{fpsGate.message}</p>}
          {fpsGate.phase === "blocked" && (
            <div className="mt-3 max-w-md border border-line p-4">
              <p className="text-sm text-ink">
                This video is{" "}
                <span className="font-mono">{fpsGate.result.fps.toFixed(1)}fps</span>, below the
                60fps needed for landing form detection. Slow-mo capture is needed for that metric
                specifically — the rest of the analysis does not need it.
              </p>
              <button
                onClick={handleContinueWithoutLandingForm}
                className="mt-3 inline-flex min-h-11 items-center border border-ink px-4 text-sm text-ink transition-colors hover:bg-ink hover:text-paper"
              >
                Continue without landing form
              </button>
            </div>
          )}
          {fpsGate.phase === "resolved" && (
            <p className="mt-3 text-sm">
              <span className={fpsGate.result.tier === "full" ? "text-field" : "text-rust"}>
                {fpsGate.result.fps.toFixed(1)}fps — {TIER_LABEL[fpsGate.result.tier]}
              </span>
              {!fpsGate.landingFormAvailable && (
                <span className="text-stone"> · landing form disabled</span>
              )}
            </p>
          )}
        </Step>

        {videoUrl && (
          <Step number={2} title="Play to analyze">
            <p className="mb-3 max-w-prose text-sm text-stone">
              Press play — pose tracking runs live, and the report below updates a couple of times a
              second as it goes, following along with your current run rather than waiting until you
              pause. Playback runs at half speed so tracking can keep up with fast movement; this
              doesn&apos;t affect the computed metrics.
            </p>
            <div className="relative w-full overflow-hidden border border-line">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                playsInline
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={handlePlay}
                onPause={handlePause}
                onEnded={handlePause}
                className="block w-full"
              />
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </div>
          </Step>
        )}

        {metrics && (
          <Step number={3} title="Report">
            <MetricGrid metrics={metrics.result} />
            <SaveRun
              auth={auth}
              metrics={metrics.result}
              videoFps={fpsGate.phase === "resolved" ? fpsGate.result.fps : null}
              videoUrl={videoUrl}
              playing={status.phase === "running"}
              onSaved={history.reload}
            />
          </Step>
        )}
      </main>
    </div>
  );
}

/**
 * Batch 6: saves the current report's headline numbers (never the video)
 * via `POST /api/analyses`. Disabled while the video is playing — the live
 * report is still changing then, and saving mid-run would store a partial
 * result. One save per loaded video: `savedFor` remembers which video URL
 * was saved, so pausing again (which recomputes) can't create duplicates.
 */
function SaveRun({
  auth,
  metrics,
  videoFps,
  videoUrl,
  playing,
  onSaved,
}: {
  auth: UseSessionResult;
  metrics: MetricsResult;
  videoFps: number | null;
  videoUrl: string | null;
  playing: boolean;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);

  if (!auth.session) {
    return (
      <p className="mt-6 text-sm text-stone">Sign in from the history panel to save this run.</p>
    );
  }
  if (videoUrl !== null && savedFor === videoUrl) {
    return <p className="mt-6 text-sm text-field">Saved to your history.</p>;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await auth.authedFetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toAnalysisInput(metrics, videoFps)),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        console.error("Saving analysis failed:", res.status, body.error);
        setError(
          res.status === 400
            ? "Some of these numbers look off, so this run wasn't saved. Try a clearer clip."
            : res.status === 401
              ? "Your session expired. Sign in again, then save."
              : "Couldn't save this run. Try again in a moment."
        );
        return;
      }
      setSavedFor(videoUrl);
      onSaved();
    } catch (err) {
      console.error("Saving analysis failed:", err);
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        onClick={handleSave}
        disabled={saving || playing}
        className="inline-flex min-h-11 items-center border border-ink px-4 text-sm text-ink transition-colors hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save to history"}
      </button>
      {playing && (
        <p className="mt-2 text-xs text-stone">Pause or finish the video to save its final numbers.</p>
      )}
      {error && <p className="mt-2 text-sm text-rust">{error}</p>}
    </div>
  );
}

function deriveDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.1;
  return [min - pad, max + pad];
}

/**
 * A minimal dot strip plot — one dot per stride/sample along a single
 * axis, so a metric's session-wide *consistency* is visible at a glance
 * instead of only the averaged headline number a card already shows.
 * Deliberately not a charting-library widget: this project has no chart
 * dependency anywhere else, and three small plots don't justify adding
 * one. Flat, hairline-only, no color beyond ink — same visual language as
 * the rest of the report, not a separate "chart" aesthetic.
 *
 * Dots are staggered across 3 fixed vertical lanes by sample index purely
 * so overlapping values stay visible as distinct dots rather than
 * merging into one — the lane has no other meaning (not time, not order).
 */
function StripPlot({
  values,
  unit,
  decimals = 1,
  domain,
}: {
  values: number[];
  unit: string;
  decimals?: number;
  /** Fixed [min, max] for the axis — omit to derive one from the data
   * itself (with a little padding) when there's no natural fixed range. */
  domain?: [number, number];
}) {
  // A strip only says something about spread with more than one point; a
  // single dot would just silently repeat the headline value.
  if (values.length < 2) return null;

  const [lo, hi] = domain ?? deriveDomain(values);
  const span = hi - lo || 1;
  const laneTopPx = [2, 8, 14];

  return (
    <div className="mt-2">
      <div className="relative h-5 border-t border-line">
        {values.map((v, i) => {
          const clamped = Math.min(hi, Math.max(lo, v));
          return (
            <span
              key={i}
              className="absolute size-1.5 -translate-x-1/2 rounded-full bg-ink/50"
              style={{ left: `${((clamped - lo) / span) * 100}%`, top: laneTopPx[i % 3] }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-stone">
        <span>
          {lo.toFixed(decimals)}
          {unit}
        </span>
        <span>
          {hi.toFixed(decimals)}
          {unit}
        </span>
      </div>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: MetricsResult }) {
  // The one motion moment the design tokens call for: the report revealing
  // itself when analysis completes. This component only ever mounts once
  // metrics exist, so the animation plays exactly on that reveal — no
  // hover animations, nothing animates on the upload/analyze steps above.
  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <p className="mb-4 font-mono text-xs text-stone">
        Camera angle detected: {metrics.cameraAngle}
      </p>

      {/* Grouped by what the metric is actually measuring (timing /
          alignment & impact / symmetry) rather than one flat 8-up grid —
          plain sentence-case labels, not the tracked-out ALL-CAPS eyebrows
          the tokens doc rules out. Each group's column count matches its
          own card count exactly (3, 2x2, or a single capped-width card) so
          there's never an empty trailing grid cell showing bare bg-line. */}
      <MetricGroup label="Timing" columnsClassName="sm:grid-cols-3">
        <MetricCard
          label="Cadence"
          value={metrics.cadence ? metrics.cadence.stepsPerMinute.toFixed(0) : null}
          unit="spm"
          strip={
            metrics.cadence && (
              <StripPlot values={metrics.cadence.perStrideStepsPerMinute} unit=" spm" decimals={0} />
            )
          }
        />
        <MetricCard
          label="Ground contact time"
          value={
            metrics.groundContactTime ? metrics.groundContactTime.groundContactMs.toFixed(0) : null
          }
          unit="ms"
          note={
            metrics.groundContactTime
              ? `${metrics.groundContactTime.confidence} confidence`
              : undefined
          }
        />
        <MetricCard
          label="Flight time"
          value={metrics.flightTime ? metrics.flightTime.flightMs.toFixed(0) : null}
          unit="ms"
          note={metrics.flightTime ? `${metrics.flightTime.confidence} confidence` : undefined}
        />
      </MetricGroup>

      <MetricGroup label="Alignment & impact" columnsClassName="sm:grid-cols-2">
        <MetricCard
          label="Vertical oscillation"
          value={
            metrics.verticalOscillation ? metrics.verticalOscillation.oscillationCm.toFixed(1) : null
          }
          unit="cm"
          note={
            metrics.verticalOscillation?.oscillationPercentLegLength != null ? (
              <>
                <PctOfLegLength percent={metrics.verticalOscillation.oscillationPercentLegLength} />{" "}
                of leg length
              </>
            ) : undefined
          }
        />
        <MetricCard
          label="Overstride"
          value={metrics.overstride ? Math.abs(metrics.overstride.overstrideCm).toFixed(1) : null}
          unit="cm"
          accent={
            metrics.overstride?.signed && metrics.overstride.overstrideCm > 0 ? "rust" : undefined
          }
          note={
            metrics.overstride ? (
              metrics.overstride.signed ? (
                <>
                  {metrics.overstride.overstrideCm >= 0 ? "ahead of" : "behind"} center of mass
                  {metrics.overstride.overstridePercentLegLength != null && (
                    <>
                      {" "}
                      ·{" "}
                      <PctOfLegLength percent={metrics.overstride.overstridePercentLegLength} /> of
                      leg length
                    </>
                  )}
                </>
              ) : (
                "undirected — no clear travel direction"
              )
            ) : undefined
          }
        />
        <MetricCard
          label="Hip drop"
          value={metrics.hipDrop ? metrics.hipDrop.hipDropDegrees.toFixed(1) : null}
          unit="°"
          note={
            !metrics.hipDrop && metrics.cameraAngle === "side"
              ? "needs a front/rear camera angle, not side"
              : undefined
          }
          strip={metrics.hipDrop && <StripPlot values={metrics.hipDrop.samples} unit="°" decimals={1} />}
        />
        <MetricCard
          label="Landing form"
          value={metrics.landingForm ? metrics.landingForm.pattern : null}
          note={metrics.landingForm ? `${metrics.landingForm.confidence} confidence` : undefined}
        />
      </MetricGroup>

      <MetricGroup label="Symmetry">
        <MetricCard
          label="Arm swing symmetry"
          value={metrics.armSwingSymmetry ? metrics.armSwingSymmetry.symmetryScore.toFixed(0) : null}
          unit="%"
          strip={
            metrics.armSwingSymmetry && (
              <StripPlot
                values={metrics.armSwingSymmetry.perStrideSymmetryScores}
                unit="%"
                decimals={0}
                domain={[0, 100]}
              />
            )
          }
        />
      </MetricGroup>

      <p className="mt-6 max-w-prose text-xs text-stone">
        This is a proof of concept. These numbers have not been validated against lab equipment —
        treat them as a rough signal, not a diagnosis.
      </p>
    </div>
  );
}
