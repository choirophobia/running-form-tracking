import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  DrawingUtils,
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { classifyFpsTier, detectFps, type FpsDetectionResult } from "@/lib/fps-detection";
import {
  computeMetrics,
  computeStrideDiagnostics,
  type MetricsResult,
  type PoseFrame,
  type StrideDiagnostic,
} from "@/lib/metrics";

// Shared by every page that runs the Batch 1+2+3 pipeline (pose detection,
// fps gate, metric computation) — originally lived inline in the pose-poc
// dev page; extracted so the real report UI (Batch 5) doesn't duplicate
// the animation-loop/fps-gate state machine, which is genuinely tricky
// (see the module-scope note below) and would be a real bug risk to
// maintain in two places.

export type Status =
  | { phase: "loading-model" }
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "error"; message: string };

export type FpsGateState =
  | { phase: "empty" }
  | { phase: "checking" }
  | { phase: "blocked"; result: FpsDetectionResult }
  | { phase: "resolved"; result: FpsDetectionResult; landingFormAvailable: boolean }
  | { phase: "error"; message: string };

export const TIER_LABEL: Record<FpsDetectionResult["tier"], string> = {
  full: "Full confidence",
  reduced: "Reduced confidence",
  blocked: "Blocked",
};

// The pose animation loop lives outside any component (module scope) on
// purpose: it's imperative, non-render code (a rAF/requestVideoFrameCallback
// loop that calls the impure performance.now() by design) driven entirely
// off refs, not React state — keeping it out of a component body avoids
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
      color: "#B5502E", // --rust
    });
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: "#F2EFE6", // --paper
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

      // Collect one PoseFrame per detected frame, keyed by the video's own
      // playback position (not wall-clock time, which would be thrown off
      // by processing lag) — this is what computeMetrics() is run against
      // once playback pauses/ends.
      // Both landmark sets, not just world: world landmarks re-center to
      // the hip midpoint every frame (useless for cross-frame hip-position
      // tracking), so vertical oscillation and direction-of-travel need
      // the normalized set too — see pose-landmarks.ts's PoseFrame doc
      // comment.
      const worldLandmarks = result.worldLandmarks[0];
      const normalizedLandmarks = result.landmarks[0];
      if (worldLandmarks) {
        refs.framesRef.current.push({
          timestampMs: video.currentTime * 1000,
          worldLandmarks,
          normalizedLandmarks,
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

export interface AnalysisMetrics {
  result: MetricsResult;
  frameCount: number;
  /** Debug/audit data — one row per detected stride with the raw numbers
   * behind cadence and landing form, not gated by fps tier. Not a
   * product-facing metric; see computeStrideDiagnostics's doc comment. */
  strideDiagnostics: StrideDiagnostic[];
}

export interface UseRunningFormAnalysisResult {
  status: Status;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoUrl: string | null;
  fpsGate: FpsGateState;
  metrics: AnalysisMetrics | null;
  /** Dev-only test knob: lets a caller exercise the reduced/blocked tiers
   * with sub-60fps footage. The real gate always uses the real 60/120
   * thresholds regardless of this — see fps-detection.ts. A page that
   * isn't a dev tool should simply not render a control for it. */
  testLowerThreshold: boolean;
  setTestLowerThreshold: (value: boolean) => void;
  testReducedConfidenceFps: number;
  handleFileSelect: (file: File) => Promise<void>;
  handleContinueWithoutLandingForm: () => void;
  handleLoadedMetadata: () => void;
  handlePlay: () => void;
  handlePause: () => void;
  /** Recomputes over every frame collected so far (across all play/pause
   * cycles for the current video, not just the latest one) — exposed so a
   * caller can offer a manual "recompute" action; pause/end already
   * trigger this automatically. */
  recomputeMetrics: () => void;
}

const TEST_REDUCED_CONFIDENCE_FPS = 40;

// Pose detection runs synchronously once per actual decoded video frame
// (via requestVideoFrameCallback) before the loop asks for the next one —
// but the video itself keeps advancing in real time regardless of how long
// that detection call takes. If inference is slower than the real-time gap
// between frames (plausible with the `full` model, especially during fast
// motion like running), frames get silently skipped: the overlay visibly
// lags the real movement, and footstrike detection loses samples too, not
// just the visuals. Playing the video back slower gives detection more
// real wall-clock time per video frame to keep up, without changing what
// video.currentTime *means* — PoseFrame timestamps stay video-content-
// relative either way, so metric timing math is unaffected by this.
const ANALYSIS_PLAYBACK_RATE = 0.5;

export function useRunningFormAnalysis(): UseRunningFormAnalysisResult {
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
  const [metrics, setMetrics] = useState<AnalysisMetrics | null>(null);

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
            // "full" over "lite": meaningfully better landmark accuracy,
            // most noticeable on small/fast-moving points like heel and
            // toe — "lite" was visibly misaligned with the shoe, which fed
            // directly into landing-form misclassification and probably
            // some of the cadence over-counting too (see
            // computeStrideDiagnostics' doc comment). Moderate speed cost
            // vs. lite; still real-time on most hardware. "heavy" would be
            // more accurate still but risks not staying real-time.
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
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
        // Full technical detail goes to the console for debugging — never
        // shown as the primary message (see running-brand-design-tokens.md's
        // Voice section: "never a raw exception string").
        console.error("Failed to load pose model:", err);
        setStatus({
          phase: "error",
          message:
            "Couldn't load the pose-tracking model. Check your connection and try reloading the page.",
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

  async function handleFileSelect(file: File) {
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

      // Test-only override (see testLowerThreshold above) — the real
      // product gate never reclassifies like this.
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
      console.error("Fps detection failed:", err);
      setFpsGate({
        phase: "error",
        message: "Couldn't read this video's frame rate. Try a different file.",
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
    // Set before playback can start (not in handlePlay) so there's no
    // brief moment of full-speed playback before this takes effect.
    video.playbackRate = ANALYSIS_PLAYBACK_RATE;
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

  function recomputeMetrics() {
    if (fpsGate.phase !== "resolved" || framesRef.current.length === 0) return;
    setMetrics({
      result: computeMetrics(framesRef.current, fpsGate.result.tier),
      frameCount: framesRef.current.length,
      strideDiagnostics: computeStrideDiagnostics(framesRef.current),
    });
  }

  return {
    status,
    videoRef,
    canvasRef,
    videoUrl,
    fpsGate,
    metrics,
    testLowerThreshold,
    setTestLowerThreshold,
    testReducedConfidenceFps: TEST_REDUCED_CONFIDENCE_FPS,
    handleFileSelect,
    handleContinueWithoutLandingForm,
    handleLoadedMetadata,
    handlePlay,
    handlePause,
    recomputeMetrics,
  };
}
