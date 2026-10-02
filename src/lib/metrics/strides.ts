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

/** One foot's ankle height *relative to the hip midpoint* per frame — the
 * signal both footstrike and toe-off detection are built on. Shared so the
 * two stay in lockstep by construction. */
function ankleRelativeHeight(frames: PoseFrame[], side: "left" | "right"): number[] {
  const ankleIndex = side === "left" ? POSE_LANDMARK.LEFT_ANKLE : POSE_LANDMARK.RIGHT_ANKLE;
  return frames.map((f) => {
    const hipMidY =
      (landmark(f, POSE_LANDMARK.LEFT_HIP).y + landmark(f, POSE_LANDMARK.RIGHT_HIP).y) / 2;
    return landmark(f, ankleIndex).y - hipMidY;
  });
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

  const relativeHeight = ankleRelativeHeight(frames, side);
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

/**
 * Merges two already-chronological, single-foot event streams and drops
 * any event landing less than `minSeparationMs` after the previously
 * *kept* event, regardless of which foot either one came from.
 *
 * `detectFootstrikes`'s own `minSeparationMs` option only constrains
 * events *within* one foot's own signal — it can't prevent a spurious
 * detection on one foot (pose-tracking jitter producing a second,
 * smaller-but-still-prominent bump well away from that foot's own real
 * strikes) from landing implausibly close to a genuine detection on the
 * *other* foot once merged. Confirmed as a real failure mode, not a
 * hypothetical one: a synthetic case with such a bump collapses the
 * merged interval to ~0ms, which inflates computeCadence's average (a
 * handful of near-zero gaps drag the average interval down and the
 * reported steps/min up) — this is what produced an implausible ~250spm
 * reading on real footage.
 *
 * Callers pass half of their own per-foot `minSeparationMs` here — not an
 * arbitrary extra constant: if one leg's own fastest plausible turnover is
 * `minSeparationMs` apart, the fastest the *two* legs could ever alternate
 * (perfectly out of phase) is half that. Keeping "whichever event was
 * encountered first" per cluster is a simple, PoC-grade tie-break, not a
 * judgment about which side's detection is more trustworthy.
 */
function mergeCrossFootFiltered<T extends FootstrikeEvent>(
  left: T[],
  right: T[],
  minCombinedSeparationMs: number
): T[] {
  const merged = [...left, ...right].sort((a, b) => a.timestampMs - b.timestampMs);
  const kept: T[] = [];
  for (const event of merged) {
    const previous = kept[kept.length - 1];
    if (previous && event.timestampMs - previous.timestampMs < minCombinedSeparationMs) continue;
    kept.push(event);
  }
  return kept;
}

/** Footstrikes for both feet, combined and sorted chronologically — the
 * event stream that cadence and per-strike metrics are computed from. See
 * `mergeCrossFootFiltered` for why this isn't a plain merge+sort. */
export function detectAllFootstrikes(
  frames: PoseFrame[],
  options: DetectFootstrikesOptions = {}
): FootstrikeEvent[] {
  const left = detectFootstrikes(frames, "left", options);
  const right = detectFootstrikes(frames, "right", options);
  const minSeparationMs = options.minSeparationMs ?? DEFAULT_MIN_STRIKE_SEPARATION_MS;
  return mergeCrossFootFiltered(left, right, minSeparationMs / 2);
}

export interface StrideEvent extends FootstrikeEvent {
  /** Frame index where the foot lifts off following this footstrike — the
   * ground-contact-time/flight-time event pair. Null if it couldn't be
   * determined (e.g. the clip ends before a clear liftoff is visible). */
  toeOffFrameIndex: number | null;
  toeOffTimestampMs: number | null;
}

// Below this fraction of the way from the stance "plateau" down to the
// swing-phase trough, treat the foot as having lifted off. Scaled to each
// stride's own amplitude rather than a fixed absolute value, same spirit
// as findPeaks' prominenceRatio.
const DEFAULT_TOE_OFF_DROP_RATIO = 0.3;

/**
 * Finds the toe-off frame following one footstrike: scans forward from the
 * footstrike (searching only up to `searchEndIndex`, normally the next
 * footstrike on the same foot) for the first point the ankle-relative-
 * height signal drops below `dropRatio` of the way toward this window's
 * lowest point — a simple, PoC-grade heuristic for "the foot started
 * lifting off," not a biomechanically precise contact-force-based
 * detector.
 */
function findToeOffFrameIndex(
  relativeHeight: number[],
  footstrikeIndex: number,
  searchEndIndex: number,
  dropRatio: number
): number | null {
  // Defensive: findPeaks only ever returns interior indices (it requires a
  // following sample to compare against), so footstrikeIndex from
  // detectFootstrikes is always followed by at least one frame in
  // practice. Guards against a future change to that constraint rather
  // than a reachable case today.
  if (searchEndIndex - footstrikeIndex < 2) return null;

  const stanceValue = relativeHeight[footstrikeIndex];
  const windowValues = relativeHeight.slice(footstrikeIndex, searchEndIndex);
  const troughValue = Math.min(...windowValues);
  const threshold = stanceValue - (stanceValue - troughValue) * dropRatio;

  for (let i = footstrikeIndex + 1; i < searchEndIndex; i++) {
    if (relativeHeight[i] < threshold) return i;
  }
  return null;
}

/** Footstrike + toe-off pairs for one foot — see `detectFootstrikes` for
 * the footstrike side of this, which this builds on unchanged. */
export function detectStrides(
  frames: PoseFrame[],
  side: "left" | "right",
  options: DetectFootstrikesOptions & { toeOffDropRatio?: number } = {}
): StrideEvent[] {
  const footstrikes = detectFootstrikes(frames, side, options);
  if (footstrikes.length === 0) return [];

  const relativeHeight = ankleRelativeHeight(frames, side);
  const dropRatio = options.toeOffDropRatio ?? DEFAULT_TOE_OFF_DROP_RATIO;

  return footstrikes.map((strike, i) => {
    const searchEndIndex = footstrikes[i + 1]?.frameIndex ?? frames.length;
    const toeOffFrameIndex = findToeOffFrameIndex(
      relativeHeight,
      strike.frameIndex,
      searchEndIndex,
      dropRatio
    );
    return {
      ...strike,
      toeOffFrameIndex,
      toeOffTimestampMs: toeOffFrameIndex !== null ? frames[toeOffFrameIndex].timestampMs : null,
    };
  });
}

/** Stride events for both feet, combined and sorted chronologically. Same
 * cross-foot filtering as `detectAllFootstrikes` — see
 * `mergeCrossFootFiltered` — since a spurious close detection would
 * corrupt ground-contact-time/flight-time averages the same way it
 * inflates cadence. */
export function detectAllStrides(
  frames: PoseFrame[],
  options: DetectFootstrikesOptions & { toeOffDropRatio?: number } = {}
): StrideEvent[] {
  const left = detectStrides(frames, "left", options);
  const right = detectStrides(frames, "right", options);
  const minSeparationMs = options.minSeparationMs ?? DEFAULT_MIN_STRIKE_SEPARATION_MS;
  return mergeCrossFootFiltered(left, right, minSeparationMs / 2);
}
