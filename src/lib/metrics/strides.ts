import { landmark, POSE_LANDMARK, type PoseFrame } from "./pose-landmarks";

export interface FootstrikeEvent {
  frameIndex: number;
  timestampMs: number;
  side: "left" | "right";
}

const DEFAULT_MIN_STRIKE_SEPARATION_MS = 300; // ~200 strides/min per leg ceiling
const DEFAULT_SMOOTHING_WINDOW = 3; // frames
const DEFAULT_PROMINENCE_RATIO = 0.3; // fraction of the signal's own range

/** Simple centered moving-average smoothing to reduce per-frame landmark
 * jitter before peak detection. windowSize is in samples (frames), not ms. */
function smooth(values: number[], windowSize: number): number[] {
  if (windowSize <= 1) return values.slice();
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += values[j];
    return sum / (end - start);
  });
}

/**
 * Indices of local maxima in `values`, at least `minSeparation` samples
 * apart and above `prominenceRatio` of the signal's own min-max range
 * (filters out flat-signal noise from being detected as a real peak).
 *
 * This is a simple, PoC-grade peak finder tuned for clean, roughly
 * periodic biomechanical signals — not a general-purpose signal-processing
 * peak detector.
 */
export function findPeaks(
  values: number[],
  minSeparation: number,
  prominenceRatio: number = DEFAULT_PROMINENCE_RATIO
): number[] {
  if (values.length < 3) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return [];

  const threshold = min + range * prominenceRatio;

  const candidates: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= threshold && values[i] > values[i - 1] && values[i] >= values[i + 1]) {
      candidates.push(i);
    }
  }

  // Greedily keep the tallest peak within each minSeparation window,
  // discarding lower peaks too close to an already-kept one.
  const byHeightDesc = [...candidates].sort((a, b) => values[b] - values[a]);
  const kept: number[] = [];
  for (const index of byHeightDesc) {
    if (!kept.some((k) => Math.abs(k - index) < minSeparation)) {
      kept.push(index);
    }
  }
  return kept.sort((a, b) => a - b);
}

function averageFrameIntervalMs(frames: PoseFrame[]): number {
  if (frames.length < 2) return 0;
  const totalMs = frames[frames.length - 1].timestampMs - frames[0].timestampMs;
  return totalMs / (frames.length - 1);
}

export interface DetectFootstrikesOptions {
  smoothingWindow?: number;
  minSeparationMs?: number;
  prominenceRatio?: number;
}

/**
 * Detects footstrike events for one foot: local maxima of that ankle's
 * height *relative to the hip midpoint* (not raw ankle height — this
 * stays robust to the subject or camera drifting vertically in frame
 * over the clip). Under the Y-down assumption (see pose-landmarks.ts),
 * "ankle relative height is at a local maximum" means the foot is at its
 * lowest point relative to the hips — i.e. on the ground.
 */
export function detectFootstrikes(
  frames: PoseFrame[],
  side: "left" | "right",
  options: DetectFootstrikesOptions = {}
): FootstrikeEvent[] {
  if (frames.length < 3) return [];

  const ankleIndex = side === "left" ? POSE_LANDMARK.LEFT_ANKLE : POSE_LANDMARK.RIGHT_ANKLE;

  const relativeHeight = frames.map((f) => {
    const hipMidY =
      (landmark(f, POSE_LANDMARK.LEFT_HIP).y + landmark(f, POSE_LANDMARK.RIGHT_HIP).y) / 2;
    return landmark(f, ankleIndex).y - hipMidY;
  });

  const smoothed = smooth(relativeHeight, options.smoothingWindow ?? DEFAULT_SMOOTHING_WINDOW);

  const avgIntervalMs = averageFrameIntervalMs(frames);
  const minSeparationMs = options.minSeparationMs ?? DEFAULT_MIN_STRIKE_SEPARATION_MS;
  const minSeparationFrames =
    avgIntervalMs > 0 ? Math.max(1, Math.round(minSeparationMs / avgIntervalMs)) : 1;

  const peakIndices = findPeaks(smoothed, minSeparationFrames, options.prominenceRatio);

  return peakIndices.map((frameIndex) => ({
    frameIndex,
    timestampMs: frames[frameIndex].timestampMs,
    side,
  }));
}

/** Footstrikes for both feet, combined and sorted chronologically — the
 * event stream that cadence and per-strike metrics are computed from. */
export function detectAllFootstrikes(
  frames: PoseFrame[],
  options: DetectFootstrikesOptions = {}
): FootstrikeEvent[] {
  const left = detectFootstrikes(frames, "left", options);
  const right = detectFootstrikes(frames, "right", options);
  return [...left, ...right].sort((a, b) => a.timestampMs - b.timestampMs);
}
