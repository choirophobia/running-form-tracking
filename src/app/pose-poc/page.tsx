"use client";

import { TIER_LABEL, useRunningFormAnalysis } from "@/hooks/useRunningFormAnalysis";
import type { MetricsResult, StrideDiagnostic } from "@/lib/metrics";

// Batch 1+2+3 proof-of-concept only: a standalone dev harness for the
// pipeline (fps gate, pose overlay, metric computation) that the real
// report UI at "/" now also uses via useRunningFormAnalysis — kept
// deliberately unstyled (no design-tokens pass) since it's a debug tool,
// not the product. See CLAUDE.md.

const TIER_COLOR: Record<string, string> = {
  full: "#3C4A2E", // --field
  reduced: "#B5502E", // --rust
  blocked: "#B5502E", // --rust
};

export default function PosePocPage() {
  const {
    status,
    videoRef,
    canvasRef,
    videoUrl,
    fpsGate,
    metrics,
    testLowerThreshold,
    setTestLowerThreshold,
    testReducedConfidenceFps,
    handleFileSelect,
    handleContinueWithoutLandingForm,
    handleLoadedMetadata,
    handlePlay,
    handlePause,
    recomputeMetrics,
  } = useRunningFormAnalysis();

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>
        Pose landmarker proof of concept
      </h1>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Batch 1+2+3 — upload a test video to check fps detection, the tiered
        confidence gate, pose detection/skeleton overlay, and the computed
        running-form metrics, before anything else gets built.
      </p>

      {status.phase === "loading-model" && <p>Loading pose model…</p>}
      {status.phase === "error" && (
        <p style={{ color: "#B5502E" }}>{status.message}</p>
      )}

      <label
        style={{
          display: "block",
          marginBottom: 12,
          fontSize: 13,
          color: "#666",
        }}
      >
        <input
          type="checkbox"
          checked={testLowerThreshold}
          onChange={(e) => setTestLowerThreshold(e.target.checked)}
          style={{ marginRight: 6 }}
        />
        Dev test only: lower the reduced-confidence threshold to{" "}
        {testReducedConfidenceFps}fps (real gate uses 60fps — this just
        lets you exercise the reduced/blocked tiers with sub-60fps footage).
        Toggle before selecting a file.
      </label>

      <input
        type="file"
        accept="video/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
        }}
        disabled={status.phase === "loading-model"}
        style={{ marginBottom: 16, display: "block" }}
      />

      {fpsGate.phase === "checking" && <p>Checking video frame rate…</p>}

      {fpsGate.phase === "error" && (
        <p style={{ color: "#B5502E" }}>{fpsGate.message}</p>
      )}

      {fpsGate.phase === "blocked" && (
        <div
          style={{
            border: "1px solid #DAD5C6",
            padding: 16,
            marginBottom: 16,
            maxWidth: 500,
          }}
        >
          <p style={{ margin: 0, marginBottom: 8 }}>
            This video is{" "}
            <strong>{fpsGate.result.fps.toFixed(1)}fps</strong> (detected via{" "}
            {fpsGate.result.method === "metadata"
              ? "container metadata"
              : "frame counting"}
            ), below the{" "}
            {testLowerThreshold ? testReducedConfidenceFps : 60}fps needed
            for landing form detection. Slow-mo capture is needed for that
            metric specifically — the rest of the analysis does not need it.
          </p>
          <button onClick={handleContinueWithoutLandingForm}>
            Continue without landing form
          </button>
        </div>
      )}

      {fpsGate.phase === "resolved" && (
        <p style={{ marginBottom: 16 }}>
          <span style={{ color: TIER_COLOR[fpsGate.result.tier] }}>
            {fpsGate.result.fps.toFixed(1)}fps — {TIER_LABEL[fpsGate.result.tier]}
          </span>{" "}
          <span style={{ color: "#666" }}>
            (via {fpsGate.result.method === "metadata" ? "metadata" : "frame counting"}
            {!fpsGate.landingFormAvailable && " — landing form disabled"})
          </span>
        </p>
      )}

      {videoUrl && (
        <p style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
          Playback runs at half speed (video.playbackRate = 0.5) so detection can keep up with
          fast motion — see ANALYSIS_PLAYBACK_RATE in useRunningFormAnalysis.ts. Doesn&apos;t
          affect computed metrics; video.currentTime still means the same thing.
        </p>
      )}

      {videoUrl && (
        <div style={{ position: "relative", width: "fit-content" }}>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handlePause}
            style={{ display: "block", maxWidth: "100%" }}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
        </div>
      )}

      {videoUrl && (
        <div style={{ marginTop: 16 }}>
          <button onClick={recomputeMetrics} style={{ marginBottom: 12 }}>
            Recompute metrics from frames collected so far
          </button>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            Metrics recompute automatically whenever you pause or the video
            ends, over every frame collected across all play/pause cycles so
            far (not just the most recent one).
          </p>

          {metrics && <MetricsPanel metrics={metrics.result} frameCount={metrics.frameCount} />}
          {metrics && <StrideDiagnosticsTable rows={metrics.strideDiagnostics} />}
        </div>
      )}
    </main>
  );
}

function StrideDiagnosticsTable({ rows }: { rows: StrideDiagnostic[] }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>
        Debug: detected strides ({rows.length})
      </h3>
      <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
        One row per detected footstrike, both feet, in order. Use the interval-from-previous
        column to check cadence isn&apos;t over-counting (an implausibly short gap means a spurious
        detection, not a real fast step). Landing form pattern here is the raw heel/toe
        classification, not gated by fps tier like the real metric above — compare it against
        what the frame at that timestamp actually shows.
      </p>
      <div style={{ overflowX: "auto", border: "1px solid #DAD5C6" }}>
        <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12, width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #DAD5C6", textAlign: "left" }}>
              {[
                "#",
                "side",
                "t (ms)",
                "Δ prev (ms)",
                "ground contact (ms)",
                "heel.y",
                "toe.y",
                "heel-toe Δ (m)",
                "pattern",
              ].map((h) => (
                <th key={h} style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.side}-${row.frameIndex}`} style={{ borderBottom: "1px solid #DAD5C6" }}>
                <td style={{ padding: "4px 8px" }}>{i + 1}</td>
                <td style={{ padding: "4px 8px" }}>{row.side}</td>
                <td style={{ padding: "4px 8px" }}>{row.timestampMs.toFixed(0)}</td>
                <td style={{ padding: "4px 8px" }}>
                  {row.intervalFromPreviousMs !== null ? row.intervalFromPreviousMs.toFixed(0) : "—"}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {row.groundContactMs !== null ? row.groundContactMs.toFixed(0) : "—"}
                </td>
                <td style={{ padding: "4px 8px" }}>{row.heelY !== null ? row.heelY.toFixed(4) : "—"}</td>
                <td style={{ padding: "4px 8px" }}>{row.toeY !== null ? row.toeY.toFixed(4) : "—"}</td>
                <td style={{ padding: "4px 8px" }}>
                  {row.heelToeDeltaM !== null ? row.heelToeDeltaM.toFixed(4) : "—"}
                </td>
                <td style={{ padding: "4px 8px" }}>{row.landingFormPattern ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricsPanel({ metrics, frameCount }: { metrics: MetricsResult; frameCount: number }) {
  return (
    <div style={{ border: "1px solid #DAD5C6", padding: 16, maxWidth: 500 }}>
      <p style={{ margin: 0, marginBottom: 4, fontFamily: "monospace", fontSize: 12, color: "#666" }}>
        {frameCount} frames with a detected pose collected
      </p>
      <p style={{ margin: 0, marginBottom: 12, fontFamily: "monospace", fontSize: 12, color: "#666" }}>
        Camera angle detected: {metrics.cameraAngle}
      </p>
      <MetricRow
        label="Cadence"
        value={metrics.cadence ? `${metrics.cadence.stepsPerMinute.toFixed(0)} spm` : null}
      />
      <MetricRow
        label="Vertical oscillation"
        value={
          metrics.verticalOscillation
            ? `${metrics.verticalOscillation.oscillationCm.toFixed(1)} cm` +
              (metrics.verticalOscillation.oscillationPercentLegLength !== null
                ? ` (${metrics.verticalOscillation.oscillationPercentLegLength.toFixed(1)}% of leg length)`
                : "")
            : null
        }
      />
      <MetricRow
        label="Overstride"
        value={
          metrics.overstride
            ? (metrics.overstride.signed
                ? `${Math.abs(metrics.overstride.overstrideCm).toFixed(1)} cm ${
                    metrics.overstride.overstrideCm >= 0 ? "ahead of" : "behind"
                  } center of mass`
                : `${metrics.overstride.overstrideCm.toFixed(1)} cm (undirected — no clear travel direction)`) +
              (metrics.overstride.overstridePercentLegLength !== null
                ? ` — ${metrics.overstride.overstridePercentLegLength.toFixed(1)}% of leg length`
                : "")
            : null
        }
      />
      <MetricRow
        label="Hip drop"
        value={
          metrics.hipDrop
            ? `${metrics.hipDrop.hipDropDegrees.toFixed(1)}°`
            : metrics.cameraAngle === "side"
              ? "not available — needs a front/rear camera angle, not side"
              : null
        }
      />
      <MetricRow
        label="Arm swing symmetry"
        value={
          metrics.armSwingSymmetry ? `${metrics.armSwingSymmetry.symmetryScore.toFixed(0)}%` : null
        }
      />
      <MetricRow
        label="Landing form"
        value={
          metrics.landingForm
            ? `${metrics.landingForm.pattern} (${metrics.landingForm.confidence} confidence)`
            : null
        }
      />
      <MetricRow
        label="Ground contact time"
        value={
          metrics.groundContactTime
            ? `${metrics.groundContactTime.groundContactMs.toFixed(0)} ms (${metrics.groundContactTime.confidence} confidence)`
            : null
        }
      />
      <MetricRow
        label="Flight time"
        value={
          metrics.flightTime
            ? `${metrics.flightTime.flightMs.toFixed(0)} ms (${metrics.flightTime.confidence} confidence)`
            : null
        }
      />
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid #DAD5C6",
        fontSize: 14,
      }}
    >
      <span style={{ color: "#666" }}>{label}</span>
      <span style={{ fontFamily: "monospace" }}>{value ?? "not enough data"}</span>
    </div>
  );
}
