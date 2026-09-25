import type { FpsTier } from "../fps-detection";
import {
  inferCameraAngle,
  inferDirectionOfTravelAxis,
  inferTravelSign,
  type CameraAngleGuess,
} from "./camera-angle";
import { angleAtVertex, average, magnitude, midpoint } from "./geometry";
import { landmark, POSE_LANDMARK, type PoseFrame } from "./pose-landmarks";
import { detectAllFootstrikes } from "./strides";

// Batch 3: pure metric-computation functions per PRD Section 6. Each takes
// a sequence of already-detected PoseFrames (see pose-landmarks.ts) and
// returns null when there isn't enough signal to compute a value (too few
// frames, no footstrikes found), rather than a misleading number — callers
// (a future report UI) should treat null as "not enough data", not zero.

const METERS_TO_CM = 100;

export interface CadenceResult {
  /** Combined (both feet) steps per minute — the standard running-cadence
   * definition, i.e. every footstrike counts, not just one leg's strides. */
  stepsPerMinute: number;
  sampleCount: number;
}

export function computeCadence(frames: PoseFrame[]): CadenceResult | null {
  const strikes = detectAllFootstrikes(frames);
  if (strikes.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 1; i < strikes.length; i++) {
    intervals.push(strikes[i].timestampMs - strikes[i - 1].timestampMs);
  }
  const avgIntervalMs = average(intervals);
  if (avgIntervalMs <= 0) return null;

  return { stepsPerMinute: 60000 / avgIntervalMs, sampleCount: intervals.length };
}

export interface VerticalOscillationResult {
  oscillationCm: number;
  sampleCount: number;
}

/** Hip-midpoint bounce per stride cycle (PRD: "Hip landmark bounce"),
 * averaged across all detected stride cycles and converted to cm. */
export function computeVerticalOscillation(frames: PoseFrame[]): VerticalOscillationResult | null {
  const strikeFrameIndices = detectAllFootstrikes(frames)
    .map((s) => s.frameIndex)
    .sort((a, b) => a - b);
  if (strikeFrameIndices.length < 2) return null;

  const hipY = frames.map(
    (f) => midpoint(landmark(f, POSE_LANDMARK.LEFT_HIP), landmark(f, POSE_LANDMARK.RIGHT_HIP)).y
  );

  const amplitudes: number[] = [];
  for (let i = 0; i < strikeFrameIndices.length - 1; i++) {
    const start = strikeFrameIndices[i];
    const end = strikeFrameIndices[i + 1];
    if (end <= start) continue;
    const segment = hipY.slice(start, end + 1);
    amplitudes.push(Math.max(...segment) - Math.min(...segment));
  }
  if (amplitudes.length === 0) return null;

  return { oscillationCm: average(amplitudes) * METERS_TO_CM, sampleCount: amplitudes.length };
}

export interface OverstrideResult {
  overstrideCm: number;
  sampleCount: number;
  /** true when a dominant direction of travel was inferred (see
   * camera-angle.ts) and overstrideCm is therefore signed — positive
   * means the foot landed ahead of the center of mass in the direction of
   * travel (the usual meaning of "overstriding"), negative means behind.
   * false means no dominant direction was found and overstrideCm falls
   * back to an undirected horizontal-plane distance (always >= 0). */
  signed: boolean;
}

/**
 * Distance between the striking foot's ankle and the hip midpoint
 * (center-of-mass proxy) at each footstrike, averaged — per PRD:
 * "Foot-strike position vs. center of mass". Excludes the vertical axis
 * so this measures how far ahead/behind the body the foot lands, not how
 * high the hip is above the ankle.
 *
 * When a clear direction of travel can be inferred (typical of a side-on
 * shot — see inferDirectionOfTravelAxis), this reports a *signed* value
 * projected onto that axis, matching the usual biomechanical meaning of
 * overstride (ahead of center of mass = positive). Without one — e.g. a
 * front/rear shot, or running in place — it falls back to an undirected
 * horizontal-plane distance, which can't distinguish "ahead" from
 * "behind" or "to the side".
 */
export function computeOverstride(frames: PoseFrame[]): OverstrideResult | null {
  const strikes = detectAllFootstrikes(frames);
  if (strikes.length === 0) return null;

  const travelAxis = inferDirectionOfTravelAxis(frames);
  const travelSign = travelAxis ? inferTravelSign(frames, travelAxis) : null;

  const distances = strikes.map((strike) => {
    const f = frames[strike.frameIndex];
    const ankleIndex = strike.side === "left" ? POSE_LANDMARK.LEFT_ANKLE : POSE_LANDMARK.RIGHT_ANKLE;
    const ankle = landmark(f, ankleIndex);
    const hipCenter = midpoint(landmark(f, POSE_LANDMARK.LEFT_HIP), landmark(f, POSE_LANDMARK.RIGHT_HIP));

    if (travelAxis && travelSign) {
      return (ankle[travelAxis] - hipCenter[travelAxis]) * travelSign;
    }
    return magnitude({ x: ankle.x - hipCenter.x, y: 0, z: ankle.z - hipCenter.z });
  });

  return {
    overstrideCm: average(distances) * METERS_TO_CM,
    sampleCount: distances.length,
    signed: travelAxis !== null,
  };
}

export interface HipDropResult {
  hipDropDegrees: number;
  sampleCount: number;
}

/**
 * Pelvis tilt (angle of the line between the two hip landmarks from
 * horizontal) at each footstrike, averaged.
 *
 * PRD note: this metric "requires front/rear-angle video" — from a
 * side-on shot the two hip landmarks nearly overlap in the visible plane
 * and this angle isn't meaningful. Rather than silently returning a
 * meaningless number for side-on footage, this infers the camera angle
 * from the pose data itself (see camera-angle.ts's `inferCameraAngle`)
 * and returns null when it looks like a side shot. That inference is a
 * heuristic, not a certainty — pass `cameraAngle` explicitly if a future
 * capture step (e.g. asking the user, or checking device orientation
 * metadata) can determine it more reliably.
 */
export function computeHipDrop(
  frames: PoseFrame[],
  cameraAngle: CameraAngleGuess = inferCameraAngle(frames)
): HipDropResult | null {
  if (cameraAngle === "side") return null;

  const strikes = detectAllFootstrikes(frames);
  if (strikes.length === 0) return null;

  const angles: number[] = [];
  for (const strike of strikes) {
    const f = frames[strike.frameIndex];
    const leftHip = landmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = landmark(f, POSE_LANDMARK.RIGHT_HIP);
    const verticalDelta = Math.abs(leftHip.y - rightHip.y);
    const horizontalDelta = Math.abs(leftHip.x - rightHip.x);
    if (horizontalDelta === 0) continue;
    angles.push((Math.atan(verticalDelta / horizontalDelta) * 180) / Math.PI);
  }
  if (angles.length === 0) return null;

  return { hipDropDegrees: average(angles), sampleCount: angles.length };
}

export interface ArmSwingSymmetryResult {
  /** 0-100; 100 = perfectly symmetric range of motion between arms. */
  symmetryScore: number;
  leftRangeOfMotionDegrees: number;
  rightRangeOfMotionDegrees: number;
}

/** Compares each arm's elbow-angle range of motion across the whole clip
 * (PRD: "Shoulder/elbow angle tracking") — not a per-stride metric, since
 * arm swing symmetry is about overall left/right balance, not a single
 * cycle. */
export function computeArmSwingSymmetry(frames: PoseFrame[]): ArmSwingSymmetryResult | null {
  if (frames.length < 2) return null;

  const elbowAngle = (f: PoseFrame, side: "left" | "right") =>
    angleAtVertex(
      landmark(f, side === "left" ? POSE_LANDMARK.LEFT_SHOULDER : POSE_LANDMARK.RIGHT_SHOULDER),
      landmark(f, side === "left" ? POSE_LANDMARK.LEFT_ELBOW : POSE_LANDMARK.RIGHT_ELBOW),
      landmark(f, side === "left" ? POSE_LANDMARK.LEFT_WRIST : POSE_LANDMARK.RIGHT_WRIST)
    );

  const leftAngles = frames.map((f) => elbowAngle(f, "left"));
  const rightAngles = frames.map((f) => elbowAngle(f, "right"));

  const leftRom = Math.max(...leftAngles) - Math.min(...leftAngles);
  const rightRom = Math.max(...rightAngles) - Math.min(...rightAngles);
  const largerRom = Math.max(leftRom, rightRom);

  const symmetryScore = largerRom === 0 ? 100 : 100 * (1 - Math.abs(leftRom - rightRom) / largerRom);

  return {
    symmetryScore,
    leftRangeOfMotionDegrees: leftRom,
    rightRangeOfMotionDegrees: rightRom,
  };
}

export type FootStrikePattern = "heel" | "midfoot" | "forefoot";
export type LandingFormConfidence = "full" | "reduced";

export interface LandingFormResult {
  pattern: FootStrikePattern;
  confidence: LandingFormConfidence;
  sampleCount: number;
}

/** Below this heel-vs-toe height difference (meters), call the strike
 * "midfoot" rather than heel/forefoot — avoids over-classifying noise as
 * a clear strike pattern. */
const HEEL_TOE_THRESHOLD_M = 0.01;

/**
 * Classifies footstrike pattern (heel/midfoot/forefoot) from the relative
 * height of the heel vs. toe landmark at each footstrike. Gated by the
 * Batch 2 fps tier (PRD Section 5/6): unavailable when blocked (<60fps),
 * since reliably catching the strike-instant frame needs it; confidence
 * is "reduced" at the 60-119fps tier and "full" at ≥120fps.
 */
export function computeLandingForm(frames: PoseFrame[], fpsTier: FpsTier): LandingFormResult | null {
  if (fpsTier === "blocked") return null;

  const strikes = detectAllFootstrikes(frames);
  if (strikes.length === 0) return null;

  const patterns: FootStrikePattern[] = strikes.map((strike) => {
    const f = frames[strike.frameIndex];
    const heelIndex = strike.side === "left" ? POSE_LANDMARK.LEFT_HEEL : POSE_LANDMARK.RIGHT_HEEL;
    const toeIndex = strike.side === "left" ? POSE_LANDMARK.LEFT_FOOT_INDEX : POSE_LANDMARK.RIGHT_FOOT_INDEX;
    const delta = landmark(f, heelIndex).y - landmark(f, toeIndex).y; // Y-down: larger = lower
    if (delta > HEEL_TOE_THRESHOLD_M) return "heel";
    if (delta < -HEEL_TOE_THRESHOLD_M) return "forefoot";
    return "midfoot";
  });

  return {
    pattern: mostCommon(patterns),
    confidence: fpsTier === "full" ? "full" : "reduced",
    sampleCount: patterns.length,
  };
}

function mostCommon<T extends string>(items: T[]): T {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  let best = items[0];
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}

export interface MetricsResult {
  cadence: CadenceResult | null;
  verticalOscillation: VerticalOscillationResult | null;
  overstride: OverstrideResult | null;
  hipDrop: HipDropResult | null;
  armSwingSymmetry: ArmSwingSymmetryResult | null;
  landingForm: LandingFormResult | null;
  /** The inferred camera angle (see camera-angle.ts) — surfaced so a
   * caller can explain *why* hipDrop is null (side-view footage) rather
   * than lumping it in with "not enough data". */
  cameraAngle: CameraAngleGuess;
}

/** Computes every Batch 3 metric in one call — matches the "analyses"
 * table's field groupings in CLAUDE.md's data model sketch, though nothing
 * here persists anything (that's Batch 4). */
export function computeMetrics(frames: PoseFrame[], fpsTier: FpsTier): MetricsResult {
  const cameraAngle = inferCameraAngle(frames);
  return {
    cadence: computeCadence(frames),
    verticalOscillation: computeVerticalOscillation(frames),
    overstride: computeOverstride(frames),
    hipDrop: computeHipDrop(frames, cameraAngle),
    armSwingSymmetry: computeArmSwingSymmetry(frames),
    landingForm: computeLandingForm(frames, fpsTier),
    cameraAngle,
  };
}
