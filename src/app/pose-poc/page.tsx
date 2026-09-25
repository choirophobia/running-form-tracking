"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  DrawingUtils,
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { classifyFpsTier, detectFps, type FpsDetectionResult } from "@/lib/fps-detection";
import { computeMetrics, type MetricsResult, type PoseFrame } from "@/lib/metrics";

// Dev-only test knob, not part of the real product gate: lets this PoC page
// be exercised end-to-end with sub-60fps footage (the "reduced confidence"
// tier is otherwise only reachable with 60-119fps video). The real gate
// (PRD Section 5) always uses classifyFpsTier's default 60/120 thresholds —
// see fps-detection.ts.
const TEST_REDUCED_CONFIDENCE_FPS = 40;

// Batch 1+2+3 proof-of-concept only: validates client-side MediaPipe pose
// extraction + skeleton overlay, gated by the Batch 2 fps tiered-confidence
// check, with Batch 3's metric computation wired in for display. No
// persistence, no design-tokens pass yet — see CLAUDE.md.

type Status =
  | { phase: "loading-model" }
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "error"; message: string };

type FpsGateState =
  | { phase: "empty" }
  | { phase: "checking" }
  | { phase: "blocked"; result: FpsDetectionResult }
  | { phase: "resolved"; result: FpsDetectionResult; landingFormAvailable: boolean }
  | { phase: "error"; message: string };

const TIER_LABEL: Record<FpsDetectionResult["tier"], string> = {
  full: "Full confidence",
  reduced: "Reduced confidence",
  blocked: "Blocked",
};

const TIER_COLOR: Record<FpsDetectionResult["tier"], string> = {
  full: "#3C4A2E", // --field
  reduced: "#B5502E", // --rust
  blocked: "#B5502E", // --rust
};

// The pose animation loop lives outside the component (module scope) on
// purpose: it's imperative, non-render code (a rAF/requestVideoFrameCallback
// loop that calls the impure performance.now() by design) driven entirely
// off refs, not React state — keeping it out of the component body avoids
// React Compiler's render-purity analysis treating it as render logic.

interface LoopRefs {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  landmarkerRef: RefObject<PoseLandmarker | null>;
  rafRef: RefObject<number | null>;
  vfcRef: RefObject<number | null>;
  lastVideoTimeRef: RefObject<number>;
  framesRef: RefObject<PoseFrame[]>;
}

function cancelScheduledFrame(refs: LoopRefs) {
  const video = refs.videoRef.current;
  if (refs.rafRef.current !== null) {
    cancelAnimationFrame(refs.rafRef.current);
    refs.rafRef.current = null;
  }
  if (refs.vfcRef.current !== null && video && "cancelVideoFrameCallback" in video) {
    video.cancelVideoFrameCallback(refs.vfcRef.current);
    refs.vfcRef.current = null;
  }
}

function drawResult(canvas: HTMLCanvasElement, result: PoseLandmarkerResult) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const drawingUtils = new DrawingUtils(ctx);
  for (const landmarks of result.landmarks) {
    drawingUtils.drawLandmarks(landmarks, {
      radius: 3,
      color: "#B5502E",
    });
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: "#F2EFE6",
      lineWidth: 2,
    });
  }
  ctx.restore();
}

// Prefer requestVideoFrameCallback: it fires exactly once per decoded video
// frame (not once per display refresh), so detection stays in lockstep with
// the actual frame rate instead of re-running on frames that haven't
// changed yet — meaningfully faster and smoother than a plain
// requestAnimationFrame loop.
function startPoseLoop(refs: LoopRefs) {
  function onFrame() {
    const video = refs.videoRef.current;
    const canvas = refs.canvasRef.current;
    const landmarker = refs.landmarkerRef.current;
    if (!video || !canvas || !landmarker) return;
    if (video.paused || video.ended) return;

    if (video.currentTime !== refs.lastVideoTimeRef.current) {
      refs.lastVideoTimeRef.current = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      drawResult(canvas, result);

      // Batch 3 wiring: collect one PoseFrame per detected frame, keyed by
      // the video's own playback position (not wall-clock time, which
      // would be thrown off by processing lag) — this is what
      // computeMetrics() below is run against once playback pauses/ends.
      const worldLandmarks = result.worldLandmarks[0];
      if (worldLandmarks) {
        refs.framesRef.current.push({
          timestampMs: video.currentTime * 1000,
          worldLandmarks,
        });
      }
    }

    scheduleNext();
  }

  function scheduleNext() {
    const video = refs.videoRef.current;
    if (!video) return;
    if ("requestVideoFrameCallback" in video) {
      refs.vfcRef.current = video.requestVideoFrameCallback(onFrame);
    } else {
      refs.rafRef.current = requestAnimationFrame(onFrame);
    }
  }

  scheduleNext();
}

export default function PosePocPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const vfcRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const framesRef = useRef<PoseFrame[]>([]);

  const pendingFileRef = useRef<File | null>(null);

  // Refs are already stable across renders — this memo just gives us one
  // stable object to depend on instead of seven separate ref values.
  const loopRefs = useMemo<LoopRefs>(
    () => ({ videoRef, canvasRef, landmarkerRef, rafRef, vfcRef, lastVideoTimeRef, framesRef }),
    [videoRef, canvasRef, landmarkerRef, rafRef, vfcRef, lastVideoTimeRef, framesRef]
  );

  const [status, setStatus] = useState<Status>({ phase: "loading-model" });
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fpsGate, setFpsGate] = useState<FpsGateState>({ phase: "empty" });
  const [testLowerThreshold, setTestLowerThreshold] = useState(false);
  const [metrics, setMetrics] = useState<{ result: MetricsResult; frameCount: number } | null>(
    null
  );

  // Load the pose landmarker model once, client-side (WASM), on mount.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus({ phase: "idle" });
      } catch (err) {
        if (cancelled) return;
        setStatus({
          phase: "error",
          message:
            err instanceof Error
              ? `Failed to load pose model: ${err.message}`
              : "Failed to load pose model.",
        });
      }
    }

    init();
    return () => {
      cancelled = true;
      cancelScheduledFrame(loopRefs);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [loopRefs]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    lastVideoTimeRef.current = -1;
    framesRef.current = [];
    setMetrics(null);
    pendingFileRef.current = file;
    setFpsGate({ phase: "checking" });

    // Runs before the video ever enters the pose pipeline (PRD Section 5) —
    // client-side only, so this resolves instantly without an upload step.
    try {
      const rawResult = await detectFps(file);
      if (pendingFileRef.current !== file) return; // superseded by a newer selection

      // Test-only override (see TEST_REDUCED_CONFIDENCE_FPS above) — the
      // real product gate never reclassifies like this.
      const result: FpsDetectionResult = testLowerThreshold
        ? { ...rawResult, tier: classifyFpsTier(rawResult.fps, TEST_REDUCED_CONFIDENCE_FPS) }
        : rawResult;

      if (result.tier === "blocked") {
        setFpsGate({ phase: "blocked", result });
      } else {
        setFpsGate({ phase: "resolved", result, landingFormAvailable: true });
        setVideoUrl(URL.createObjectURL(file));
      }
    } catch (err) {
      if (pendingFileRef.current !== file) return;
      setFpsGate({
        phase: "error",
        message:
          err instanceof Error
            ? `Fps detection failed: ${err.message}`
            : "Fps detection failed.",
      });
    }
  }

  function handleContinueWithoutLandingForm() {
    const file = pendingFileRef.current;
    if (!file || fpsGate.phase !== "blocked") return;
    setFpsGate({ phase: "resolved", result: fpsGate.result, landingFormAvailable: false });
    setVideoUrl(URL.createObjectURL(file));
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  function handlePlay() {
    if (status.phase === "error" || status.phase === "loading-model") return;
    setStatus({ phase: "running" });
    startPoseLoop(loopRefs);
  }

  function handlePause() {
    cancelScheduledFrame(loopRefs);
    setStatus((s) => (s.phase === "error" ? s : { phase: "idle" }));
    recomputeMetrics();
  }

  // Recomputes over every frame collected so far (across all play/pause
  // cycles for the current video, not just the latest one) — pause partway
  // through and you still get metrics for what's been watched.
  function recomputeMetrics() {
    if (fpsGate.phase !== "resolved" || framesRef.current.length === 0) return;
    setMetrics({
      result: computeMetrics(framesRef.current, fpsGate.result.tier),
      frameCount: framesRef.current.length,
    });
  }

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
        {TEST_REDUCED_CONFIDENCE_FPS}fps (real gate uses 60fps — this just
        lets you exercise the reduced/blocked tiers with sub-60fps footage).
        Toggle before selecting a file.
      </label>

      <input
        type="file"
        accept="video/*"
        onChange={handleFileChange}
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
            {testLowerThreshold ? TEST_REDUCED_CONFIDENCE_FPS : 60}fps needed
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
        </div>
      )}
    </main>
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
            ? `${metrics.verticalOscillation.oscillationCm.toFixed(1)} cm`
            : null
        }
      />
      <MetricRow
        label="Overstride"
        value={
          metrics.overstride
            ? metrics.overstride.signed
              ? `${Math.abs(metrics.overstride.overstrideCm).toFixed(1)} cm ${
                  metrics.overstride.overstrideCm >= 0 ? "ahead of" : "behind"
                } center of mass`
              : `${metrics.overstride.overstrideCm.toFixed(1)} cm (undirected — no clear travel direction)`
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
