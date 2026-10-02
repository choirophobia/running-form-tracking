import type { FpsTier } from "../fps-detection";
import {
  inferCameraAngle,
  inferDirectionOfTravelAxis,
  inferTravelSign,
  type CameraAngleGuess,
} from "./camera-angle";
import { angleAtVertex, average, distance, magnitude, midpoint } from "./geometry";
import {
  allVisible,
  landmark,
  POSE_LANDMARK,
  tryNormalizedLandmark,
  type PoseFrame,
} from "./pose-landmarks";
import { detectAllFootstrikes, detectAllStrides } from "./strides";

// Batch 3: pure metric-computation functions per PRD Section 6. Each takes
// a sequence of already-detected PoseFrames (see pose-landmarks.ts) and
// returns null when there isn't enough signal to compute a value (too few
// frames, no footstrikes found), rather than a misleading number — callers
// (a future report UI) should treat null as "not enough data", not zero.

const METERS_TO_CM = 100;

/**
 * Estimates anatomical leg length (meters) from hip-to-ankle distance,
 * taking the *maximum* observed across the clip rather than an average —
 * a bent knee always shortens the projected hip-ankle distance, so the
 * longest observed reading is the closest proxy for true leg length (full
 * extension). Used to normalize metrics like overstride and vertical
 * oscillation as a fraction of the runner's own size instead of raw cm,
 * so two runners with identical *relative* form don't get different-
 * looking numbers just because one is taller.
 *
 * Returns null if no hip/ankle pair was ever visible enough to sample.
 */
function estimateLegLengthMeters(frames: PoseFrame[]): number | null {
  const distances: number[] = [];
  for (const f of frames) {
    const leftHip = landmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = landmark(f, POSE_LANDMARK.RIGHT_HIP);
    const leftAnkle = landmark(f, POSE_LANDMARK.LEFT_ANKLE);
    const rightAnkle = landmark(f, POSE_LANDMARK.RIGHT_ANKLE);
    if (allVisible([leftHip, leftAnkle])) distances.push(distance(leftHip, leftAnkle));
    if (allVisible([rightHip, rightAnkle])) distances.push(distance(rightHip, rightAnkle));
  }
  if (distances.length === 0) return null;
  return Math.max(...distances);
}

/**
 * Same idea as estimateLegLengthMeters but measured on normalized
 * (image-plane) landmarks instead of world landmarks, as a 2D x/y
 * distance — not a drop-in 3D equivalent, since normalized z is still
 * hip-relative depth (see pose-landmarks.ts), so it's deliberately left
 * out here rather than mixed in as if it were comparable to x/y.
 *
 * This exists purely as a calibration reference: computeVerticalOscillation
 * measures bounce in normalized units (the only space where cross-frame
 * hip position is meaningful at all — see PoseFrame's doc comment) and
 * needs a real-world-to-normalized-unit conversion factor to report cm.
 * Leg length is a convenient shared yardstick because it's a same-frame
 * measurement, valid in both coordinate spaces, so the ratio between its
 * world-meters and normalized-2D readings gives exactly that factor.
 */
function estimateLegLengthNormalized2D(frames: PoseFrame[]): number | null {
  const distances: number[] = [];
  for (const f of frames) {
    const leftHip = tryNormalizedLandmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = tryNormalizedLandmark(f, POSE_LANDMARK.RIGHT_HIP);
    const leftAnkle = tryNormalizedLandmark(f, POSE_LANDMARK.LEFT_ANKLE);
    const rightAnkle = tryNormalizedLandmark(f, POSE_LANDMARK.RIGHT_ANKLE);
    if (leftHip && leftAnkle && allVisible([leftHip, leftAnkle])) {
      distances.push(Math.hypot(leftHip.x - leftAnkle.x, leftHip.y - leftAnkle.y));
    }
    if (rightHip && rightAnkle && allVisible([rightHip, rightAnkle])) {
      distances.push(Math.hypot(rightHip.x - rightAnkle.x, rightHip.y - rightAnkle.y));
    }
  }
  if (distances.length === 0) return null;
  return Math.max(...distances);
}

export interface CadenceResult {
  /** Combined (both feet) steps per minute — the standard running-cadence
   * definition, i.e. every footstrike counts, not just one leg's strides. */
  stepsPerMinute: number;
  sampleCount: number;
  /** Each stride-to-stride interval converted to its own instantaneous
   * steps/min, chronological — for a per-stride strip-plot view of
   * consistency, not used to derive stepsPerMinute itself (that averages
   * the raw intervals, not these converted rates — the two differ
   * slightly, harmonic vs. arithmetic mean, so don't expect this array's
   * average to equal stepsPerMinute exactly). */
  perStrideStepsPerMinute: number[];
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

  return {
    stepsPerMinute: 60000 / avgIntervalMs,
    sampleCount: intervals.length,
    perStrideStepsPerMinute: intervals.map((ms) => 60000 / ms),
  };
}

export interface VerticalOscillationResult {
  oscillationCm: number;
  sampleCount: number;
  /** oscillationCm as a percentage of estimated leg length, or null if leg
   * length couldn't be estimated — a taller runner naturally has a larger
   * absolute oscillationCm for identical relative form, so this is the
   * more comparable number across different runners. See
   * estimateLegLengthMeters. */
  oscillationPercentLegLength: number | null;
}

/**
 * Hip-midpoint bounce per stride cycle (PRD: "Hip landmark bounce"),
 * averaged across all detected stride cycles and converted to cm.
 *
 * Tracked via **normalized** landmarks, not world landmarks — world
 * landmarks re-center to the hip midpoint on every single frame, so the
 * hip's own world-Y position is always ~0 and can never show bounce (see
 * pose-landmarks.ts). Normalized Y is a genuine absolute image-plane
 * coordinate, so cross-frame hip movement shows up there. That leaves
 * normalized (dimensionless, [0,1]) units to convert to real cm, which is
 * what estimateLegLengthNormalized2D's scale factor is for.
 *
 * Returns null (not a zero/undercounted number) when there's no usable
 * normalized data or no leg-length calibration reference — e.g. older
 * frames that only captured world landmarks.
 */
export function computeVerticalOscillation(frames: PoseFrame[]): VerticalOscillationResult | null {
  const strikeFrameIndices = detectAllFootstrikes(frames)
    .map((s) => s.frameIndex)
    .sort((a, b) => a - b);
  if (strikeFrameIndices.length < 2) return null;

  const hipY = frames.map((f) => {
    const leftHip = tryNormalizedLandmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = tryNormalizedLandmark(f, POSE_LANDMARK.RIGHT_HIP);
    return leftHip && rightHip ? (leftHip.y + rightHip.y) / 2 : null;
  });

  const amplitudes: number[] = [];
  for (let i = 0; i < strikeFrameIndices.length - 1; i++) {
    const start = strikeFrameIndices[i];
    const end = strikeFrameIndices[i + 1];
    if (end <= start) continue;
    const segment = hipY.slice(start, end + 1).filter((y): y is number => y !== null);
    if (segment.length < 2) continue;
    amplitudes.push(Math.max(...segment) - Math.min(...segment));
  }
  if (amplitudes.length === 0) return null;

  const legLengthM = estimateLegLengthMeters(frames);
  const legLengthNormalized = estimateLegLengthNormalized2D(frames);
  if (!legLengthM || !legLengthNormalized) return null;
  const metersPerNormalizedUnit = legLengthM / legLengthNormalized;

  const oscillationCm = average(amplitudes) * metersPerNormalizedUnit * METERS_TO_CM;

  return {
    oscillationCm,
    sampleCount: amplitudes.length,
    oscillationPercentLegLength: (oscillationCm / METERS_TO_CM / legLengthM) * 100,
  };
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
  /** overstrideCm as a percentage of estimated leg length, or null if leg
   * length couldn't be estimated. Keeps the sign of overstrideCm — see
   * estimateLegLengthMeters for why this is the more comparable number
   * across runners of different heights. */
  overstridePercentLegLength: number | null;
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
 *
 * Strikes where the striking ankle or either hip landmark has low
 * MediaPipe visibility (commonly the trailing leg, partly hidden behind
 * the body on a side-on shot) are skipped rather than sampled from noisy
 * data — see pose-landmarks.ts's `isVisible`.
 */
export function computeOverstride(frames: PoseFrame[]): OverstrideResult | null {
  const strikes = detectAllFootstrikes(frames);
  if (strikes.length === 0) return null;

  const travelAxis = inferDirectionOfTravelAxis(frames);
  const travelSign = travelAxis ? inferTravelSign(frames) : null;

  const distances: number[] = [];
  for (const strike of strikes) {
    const f = frames[strike.frameIndex];
    const ankleIndex = strike.side === "left" ? POSE_LANDMARK.LEFT_ANKLE : POSE_LANDMARK.RIGHT_ANKLE;
    const ankle = landmark(f, ankleIndex);
    const leftHip = landmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = landmark(f, POSE_LANDMARK.RIGHT_HIP);
    if (!allVisible([ankle, leftHip, rightHip])) continue;

    const hipCenter = midpoint(leftHip, rightHip);
    if (travelAxis && travelSign) {
      distances.push((ankle[travelAxis] - hipCenter[travelAxis]) * travelSign);
    } else {
      distances.push(magnitude({ x: ankle.x - hipCenter.x, y: 0, z: ankle.z - hipCenter.z }));
    }
  }
  if (distances.length === 0) return null;

  const overstrideCm = average(distances) * METERS_TO_CM;
  const legLengthM = estimateLegLengthMeters(frames);

  return {
    overstrideCm,
    sampleCount: distances.length,
    signed: travelAxis !== null,
    overstridePercentLegLength: legLengthM ? (overstrideCm / METERS_TO_CM / legLengthM) * 100 : null,
  };
}

export interface HipDropResult {
  hipDropDegrees: number;
  sampleCount: number;
  /** Individual per-footstrike readings behind the average, chronological —
   * for a per-stride strip-plot view of consistency. */
  samples: number[];
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
    if (!allVisible([leftHip, rightHip])) continue;
    const verticalDelta = Math.abs(leftHip.y - rightHip.y);
    const horizontalDelta = Math.abs(leftHip.x - rightHip.x);
    if (horizontalDelta === 0) continue;
    angles.push((Math.atan(verticalDelta / horizontalDelta) * 180) / Math.PI);
  }
  if (angles.length === 0) return null;

  return { hipDropDegrees: average(angles), sampleCount: angles.length, samples: angles };
}

export interface ArmSwingSymmetryResult {
  /** 0-100; 100 = perfectly symmetric range of motion between arms. */
  symmetryScore: number;
  leftRangeOfMotionDegrees: number;
  rightRangeOfMotionDegrees: number;
  leftSampleCount: number;
  rightSampleCount: number;
  /** The same 0-100 symmetry definition as symmetryScore, computed
   * independently within each combined footstrike-to-footstrike interval
   * (the same segmentation computeVerticalOscillation uses) — for a
   * per-stride strip-plot view of consistency. A segment is omitted when
   * either arm has fewer than 2 visible samples within it (not enough
   * signal for a ROM reading in that narrow window), so this can be
   * shorter than the stride count. */
  perStrideSymmetryScores: number[];
}

function elbowAnglesInRange(
  frames: PoseFrame[],
  side: "left" | "right",
  start: number,
  end: number
): number[] {
  const shoulderIndex = side === "left" ? POSE_LANDMARK.LEFT_SHOULDER : POSE_LANDMARK.RIGHT_SHOULDER;
  const elbowIndex = side === "left" ? POSE_LANDMARK.LEFT_ELBOW : POSE_LANDMARK.RIGHT_ELBOW;
  const wristIndex = side === "left" ? POSE_LANDMARK.LEFT_WRIST : POSE_LANDMARK.RIGHT_WRIST;

  const angles: number[] = [];
  for (let i = start; i <= end; i++) {
    const f = frames[i];
    const shoulder = landmark(f, shoulderIndex);
    const elbow = landmark(f, elbowIndex);
    const wrist = landmark(f, wristIndex);
    if (!allVisible([shoulder, elbow, wrist])) continue;
    angles.push(angleAtVertex(shoulder, elbow, wrist));
  }
  return angles;
}

function symmetryScoreFor(leftAngles: number[], rightAngles: number[]): number {
  const leftRom = Math.max(...leftAngles) - Math.min(...leftAngles);
  const rightRom = Math.max(...rightAngles) - Math.min(...rightAngles);
  const largerRom = Math.max(leftRom, rightRom);
  return largerRom === 0 ? 100 : 100 * (1 - Math.abs(leftRom - rightRom) / largerRom);
}

/**
 * Compares each arm's elbow-angle range of motion across the whole clip
 * (PRD: "Shoulder/elbow angle tracking") — the headline symmetryScore is
 * not a per-stride metric, since arm swing symmetry is fundamentally about
 * overall left/right balance, not a single cycle. perStrideSymmetryScores
 * below is a secondary, windowed view for spotting consistency/outliers,
 * not a replacement for that whole-clip definition.
 *
 * Each arm's frames are filtered independently for landmark visibility —
 * on a side-on shot the far arm is frequently partly hidden behind the
 * torso for stretches of the clip, and a momentarily-occluded frame could
 * otherwise corrupt that arm's min/max range with a garbage reading. One
 * arm's occlusion never affects the other's sample set.
 */
export function computeArmSwingSymmetry(frames: PoseFrame[]): ArmSwingSymmetryResult | null {
  if (frames.length < 2) return null;

  const leftAngles = elbowAnglesInRange(frames, "left", 0, frames.length - 1);
  const rightAngles = elbowAnglesInRange(frames, "right", 0, frames.length - 1);
  if (leftAngles.length === 0 || rightAngles.length === 0) return null;

  const leftRom = Math.max(...leftAngles) - Math.min(...leftAngles);
  const rightRom = Math.max(...rightAngles) - Math.min(...rightAngles);

  const strikeFrameIndices = detectAllFootstrikes(frames)
    .map((s) => s.frameIndex)
    .sort((a, b) => a - b);
  const perStrideSymmetryScores: number[] = [];
  for (let i = 0; i < strikeFrameIndices.length - 1; i++) {
    const start = strikeFrameIndices[i];
    const end = strikeFrameIndices[i + 1];
    if (end <= start) continue;
    const segLeft = elbowAnglesInRange(frames, "left", start, end);
    const segRight = elbowAnglesInRange(frames, "right", start, end);
    if (segLeft.length < 2 || segRight.length < 2) continue;
    perStrideSymmetryScores.push(symmetryScoreFor(segLeft, segRight));
  }

  return {
    symmetryScore: symmetryScoreFor(leftAngles, rightAngles),
    leftRangeOfMotionDegrees: leftRom,
    rightRangeOfMotionDegrees: rightRom,
    leftSampleCount: leftAngles.length,
    rightSampleCount: rightAngles.length,
    perStrideSymmetryScores,
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

/** heel.y - toe.y under the Y-down assumption: positive means the heel is
 * lower (closer to the ground) than the toe. Shared by computeLandingForm
 * and computeStrideDiagnostics so they can never disagree. */
function classifyFootStrikePattern(heelToeDeltaM: number): FootStrikePattern {
  if (heelToeDeltaM > HEEL_TOE_THRESHOLD_M) return "heel";
  if (heelToeDeltaM < -HEEL_TOE_THRESHOLD_M) return "forefoot";
  return "midfoot";
}

/**
 * Classifies footstrike pattern (heel/midfoot/forefoot) from the relative
 * height of the heel vs. toe landmark at each footstrike. Gated by the
 * Batch 2 fps tier (PRD Section 5/6): unavailable when blocked (<60fps),
 * since reliably catching the strike-instant frame needs it; confidence
 * is "reduced" at the 60-119fps tier and "full" at ≥120fps.
 *
 * Strikes where the heel or toe landmark has low visibility are skipped —
 * exactly the frame that matters most for this metric (the instant of
 * ground contact) is also a common moment for the foot to be partly
 * obscured by the other leg.
 */
export function computeLandingForm(frames: PoseFrame[], fpsTier: FpsTier): LandingFormResult | null {
  if (fpsTier === "blocked") return null;

  const strikes = detectAllFootstrikes(frames);
  if (strikes.length === 0) return null;

  const patterns: FootStrikePattern[] = [];
  for (const strike of strikes) {
    const f = frames[strike.frameIndex];
    const heelIndex = strike.side === "left" ? POSE_LANDMARK.LEFT_HEEL : POSE_LANDMARK.RIGHT_HEEL;
    const toeIndex = strike.side === "left" ? POSE_LANDMARK.LEFT_FOOT_INDEX : POSE_LANDMARK.RIGHT_FOOT_INDEX;
    const heel = landmark(f, heelIndex);
    const toe = landmark(f, toeIndex);
    if (!allVisible([heel, toe])) continue;

    patterns.push(classifyFootStrikePattern(heel.y - toe.y));
  }
  if (patterns.length === 0) return null;

  return {
    pattern: mostCommon(patterns),
    confidence: fpsTier === "full" ? "full" : "reduced",
    sampleCount: patterns.length,
  };
}

export interface GroundContactTimeResult {
  groundContactMs: number;
  confidence: LandingFormConfidence;
  sampleCount: number;
}

/**
 * Time from footstrike to toe-off, averaged across every stride with a
 * detected toe-off (see strides.ts's `detectAllStrides`). Gated by the
 * Batch 2 fps tier the same way `computeLandingForm` is: unavailable when
 * blocked (<60fps) — accurately timing ground contact needs the same
 * frame-rate headroom as catching the exact strike-instant frame does.
 *
 * Strides where either the footstrike or toe-off frame's ankle/hip
 * landmarks have low visibility are excluded.
 */
export function computeGroundContactTime(
  frames: PoseFrame[],
  fpsTier: FpsTier
): GroundContactTimeResult | null {
  if (fpsTier === "blocked") return null;

  const strides = detectAllStrides(frames);
  const durations: number[] = [];
  for (const stride of strides) {
    if (stride.toeOffTimestampMs === null) continue;
    const ankleIndex =
      stride.side === "left" ? POSE_LANDMARK.LEFT_ANKLE : POSE_LANDMARK.RIGHT_ANKLE;
    const strikeAnkle = landmark(frames[stride.frameIndex], ankleIndex);
    const toeOffAnkle = landmark(frames[stride.toeOffFrameIndex!], ankleIndex);
    if (!allVisible([strikeAnkle, toeOffAnkle])) continue;

    durations.push(stride.toeOffTimestampMs - stride.timestampMs);
  }
  if (durations.length === 0) return null;

  return {
    groundContactMs: average(durations),
    confidence: fpsTier === "full" ? "full" : "reduced",
    sampleCount: durations.length,
  };
}

export interface FlightTimeResult {
  flightMs: number;
  confidence: LandingFormConfidence;
  sampleCount: number;
}

/**
 * Time from one foot's toe-off to the *next* footstrike (either foot) —
 * the brief airborne phase between strides that's the main thing
 * distinguishing running from walking. Same fps gating as
 * `computeGroundContactTime` and the same reasoning.
 */
export function computeFlightTime(frames: PoseFrame[], fpsTier: FpsTier): FlightTimeResult | null {
  if (fpsTier === "blocked") return null;

  const strides = detectAllStrides(frames);
  const allFootstrikeTimestamps = strides.map((s) => s.timestampMs).sort((a, b) => a - b);

  const durations: number[] = [];
  for (const stride of strides) {
    if (stride.toeOffTimestampMs === null) continue;
    const ankleIndex =
      stride.side === "left" ? POSE_LANDMARK.LEFT_ANKLE : POSE_LANDMARK.RIGHT_ANKLE;
    const toeOffAnkle = landmark(frames[stride.toeOffFrameIndex!], ankleIndex);
    if (!allVisible([toeOffAnkle])) continue;

    const nextFootstrikeMs = allFootstrikeTimestamps.find((t) => t > stride.toeOffTimestampMs!);
    if (nextFootstrikeMs === undefined) continue;
    durations.push(nextFootstrikeMs - stride.toeOffTimestampMs);
  }
  if (durations.length === 0) return null;

  return {
    flightMs: average(durations),
    confidence: fpsTier === "full" ? "full" : "reduced",
    sampleCount: durations.length,
  };
}

export interface StrideDiagnostic {
  side: "left" | "right";
  frameIndex: number;
  timestampMs: number;
  /** Gap from the *previous* strike in the combined (both-feet) stream —
   * null for the first strike. This is exactly what computeCadence
   * averages; an implausibly small value here (e.g. two strikes a few
   * frames apart) means the detector is probably over-counting, not that
   * the runner actually took a step that fast. */
  intervalFromPreviousMs: number | null;
  toeOffTimestampMs: number | null;
  groundContactMs: number | null;
  /** Null only when the heel/toe landmarks weren't visible enough to
   * sample — not when the delta is small (that's a real "midfoot" read). */
  heelY: number | null;
  toeY: number | null;
  heelToeDeltaM: number | null;
  landingFormPattern: FootStrikePattern | null;
}

/**
 * Debug/audit tool, not a product metric: one row per detected stride
 * (both feet, chronological — the same event stream computeCadence and
 * computeLandingForm are built from) with the raw numbers behind both.
 * Unlike computeLandingForm, this is **not** gated by fps tier — it always
 * shows the raw heel/toe classification so the gating logic itself can be
 * inspected separately from the underlying geometry.
 *
 * Built specifically to let a human cross-check the algorithm against
 * what they actually see in the source video: does the strike count/
 * timing look plausible, and does the classified landing-form pattern at
 * a given timestamp match what that frame of video actually shows.
 */
export function computeStrideDiagnostics(frames: PoseFrame[]): StrideDiagnostic[] {
  const strides = detectAllStrides(frames);

  return strides.map((stride, i) => {
    const f = frames[stride.frameIndex];
    const heelIndex = stride.side === "left" ? POSE_LANDMARK.LEFT_HEEL : POSE_LANDMARK.RIGHT_HEEL;
    const toeIndex = stride.side === "left" ? POSE_LANDMARK.LEFT_FOOT_INDEX : POSE_LANDMARK.RIGHT_FOOT_INDEX;
    const heel = landmark(f, heelIndex);
    const toe = landmark(f, toeIndex);
    const landmarksVisible = allVisible([heel, toe]);
    const heelToeDeltaM = landmarksVisible ? heel.y - toe.y : null;

    return {
      side: stride.side,
      frameIndex: stride.frameIndex,
      timestampMs: stride.timestampMs,
      intervalFromPreviousMs: i > 0 ? stride.timestampMs - strides[i - 1].timestampMs : null,
      toeOffTimestampMs: stride.toeOffTimestampMs,
      groundContactMs:
        stride.toeOffTimestampMs !== null ? stride.toeOffTimestampMs - stride.timestampMs : null,
      heelY: landmarksVisible ? heel.y : null,
      toeY: landmarksVisible ? toe.y : null,
      heelToeDeltaM,
      landingFormPattern: heelToeDeltaM !== null ? classifyFootStrikePattern(heelToeDeltaM) : null,
    };
  });
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
  groundContactTime: GroundContactTimeResult | null;
  flightTime: FlightTimeResult | null;
  /** The inferred camera angle (see camera-angle.ts) — surfaced so a
   * caller can explain *why* hipDrop is null (side-view footage) rather
   * than lumping it in with "not enough data". */
  cameraAngle: CameraAngleGuess;
}

/** Computes every metric in one call — matches the "analyses" table's
 * field groupings in CLAUDE.md's data model sketch, though nothing here
 * persists anything (that's Batch 4). */
export function computeMetrics(frames: PoseFrame[], fpsTier: FpsTier): MetricsResult {
  const cameraAngle = inferCameraAngle(frames);
  return {
    cadence: computeCadence(frames),
    verticalOscillation: computeVerticalOscillation(frames),
    overstride: computeOverstride(frames),
    hipDrop: computeHipDrop(frames, cameraAngle),
    armSwingSymmetry: computeArmSwingSymmetry(frames),
    landingForm: computeLandingForm(frames, fpsTier),
    groundContactTime: computeGroundContactTime(frames, fpsTier),
    flightTime: computeFlightTime(frames, fpsTier),
    cameraAngle,
  };
}
