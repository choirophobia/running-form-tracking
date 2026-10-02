"use client";

import type { ReactNode } from "react";
import { TIER_LABEL, useRunningFormAnalysis } from "@/hooks/useRunningFormAnalysis";
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

export default function Home() {
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
    <main className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10">
      <header className="mb-10">
        <h1 className="font-display text-3xl uppercase tracking-wide text-ink sm:text-4xl">
          Running Form Tracker
        </h1>
        <p className="mt-2 max-w-prose text-sm text-stone">
          Upload a video of yourself running. Pose tracking and every metric below run entirely
          in your browser — nothing is uploaded anywhere.
        </p>
      </header>

      <Step number={1} title="Upload your video">
        {status.phase === "loading-model" && (
          <p className="text-sm text-stone">Loading pose model…</p>
        )}
        {status.phase === "error" && <p className="text-sm text-rust">{status.message}</p>}

        <label className="mt-2 inline-flex cursor-pointer items-center border border-line px-4 py-2 text-sm text-ink transition-colors hover:border-ink">
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
              className="mt-3 border border-ink px-3 py-1.5 text-sm text-ink transition-colors hover:bg-ink hover:text-paper"
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
            Press play — pose tracking runs live, and the report below updates whenever you pause
            or the video ends. Playback runs at half speed so tracking can keep up with fast
            movement; this doesn&apos;t affect the computed metrics.
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
        </Step>
      )}
    </main>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-10 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs text-stone">{String(number).padStart(2, "0")}</span>
        <h2 className="font-display text-xl uppercase tracking-wide text-ink">{title}</h2>
      </div>
      {children}
    </section>
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

      <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Cadence"
          value={metrics.cadence ? metrics.cadence.stepsPerMinute.toFixed(0) : null}
          unit="spm"
        />
        <MetricCard
          label="Vertical oscillation"
          value={
            metrics.verticalOscillation ? metrics.verticalOscillation.oscillationCm.toFixed(1) : null
          }
          unit="cm"
          note={
            metrics.verticalOscillation?.oscillationPercentLegLength != null
              ? `${metrics.verticalOscillation.oscillationPercentLegLength.toFixed(1)}% of leg length`
              : undefined
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
            metrics.overstride
              ? metrics.overstride.signed
                ? `${metrics.overstride.overstrideCm >= 0 ? "ahead of" : "behind"} center of mass${
                    metrics.overstride.overstridePercentLegLength != null
                      ? ` · ${metrics.overstride.overstridePercentLegLength.toFixed(1)}% of leg length`
                      : ""
                  }`
                : "undirected — no clear travel direction"
              : undefined
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
        />
        <MetricCard
          label="Arm swing symmetry"
          value={metrics.armSwingSymmetry ? metrics.armSwingSymmetry.symmetryScore.toFixed(0) : null}
          unit="%"
        />
        <MetricCard
          label="Landing form"
          value={metrics.landingForm ? metrics.landingForm.pattern : null}
          note={metrics.landingForm ? `${metrics.landingForm.confidence} confidence` : undefined}
        />
        <MetricCard
          label="Ground contact time"
          value={
            metrics.groundContactTime ? metrics.groundContactTime.groundContactMs.toFixed(0) : null
          }
          unit="ms"
          note={
            metrics.groundContactTime ? `${metrics.groundContactTime.confidence} confidence` : undefined
          }
        />
        <MetricCard
          label="Flight time"
          value={metrics.flightTime ? metrics.flightTime.flightMs.toFixed(0) : null}
          unit="ms"
          note={metrics.flightTime ? `${metrics.flightTime.confidence} confidence` : undefined}
        />
      </div>

      <p className="mt-6 max-w-prose text-xs text-stone">
        This is a proof of concept. These numbers have not been validated against lab equipment —
        treat them as a rough signal, not a diagnosis.
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  note,
  accent,
}: {
  label: string;
  value: string | null;
  unit?: string;
  note?: string;
  accent?: "field" | "rust";
}) {
  return (
    <div className="bg-paper p-4">
      <p className="text-xs text-stone">{label}</p>
      {value ? (
        <p
          className={`mt-1 font-display text-3xl leading-none ${
            accent === "field" ? "text-field" : accent === "rust" ? "text-rust" : "text-ink"
          }`}
        >
          {value}
          {unit && <span className="ml-1 font-sans text-base text-stone">{unit}</span>}
        </p>
      ) : (
        <p className="mt-1 font-mono text-sm text-stone">not enough data</p>
      )}
      {note && <p className="mt-1 text-xs text-stone">{note}</p>}
    </div>
  );
}
