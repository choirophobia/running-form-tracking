import { average } from "./geometry";
import { landmark, POSE_LANDMARK, tryNormalizedLandmark, type PoseFrame } from "./pose-landmarks";

// Neither of these functions needs the camera angle to be told to them —
// they infer it from the pose data already being collected, since the
// PRD's own capture guidance (side view for most metrics, front/rear for
// hip drop) isn't something today's pose-poc page asks the user for.

export type CameraAngleGuess = "side" | "front-or-rear";

// Below this ratio of (hip left-right separation / torso height), the two
// hip landmarks have effectively collapsed onto each other in the
// camera's horizontal axis — the signature of looking at the body edge-on
// (a side shot), where the true left-right hip axis points into the
// screen instead of across it. A real front/rear shot can't produce a
// ratio this low: typical hip width is roughly 50-70% of torso height, so
// there's a wide, comfortable margin above this threshold for genuine
// front/rear footage and a wide margin below it for genuine side footage.
const SIDE_VIEW_HIP_SEPARATION_RATIO = 0.2;

/**
 * Infers whether a clip was shot from the side vs. front/rear, from the
 * pose data alone — by checking how much the left/right hip landmarks
 * separate in the camera's horizontal axis relative to torso height (a
 * body-scale reference that doesn't collapse with camera rotation the way
 * left-right separation does). Defaults to `"front-or-rear"` (i.e. doesn't
 * suppress hip drop) when there's too little data to tell confidently —
 * better to occasionally show a slightly-off number than to hide a
 * genuinely valid one on a false positive.
 */
export function inferCameraAngle(frames: PoseFrame[]): CameraAngleGuess {
  if (frames.length === 0) return "front-or-rear";

  const hipSeparations: number[] = [];
  const torsoHeights: number[] = [];

  for (const f of frames) {
    const leftHip = landmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = landmark(f, POSE_LANDMARK.RIGHT_HIP);
    const leftShoulder = landmark(f, POSE_LANDMARK.LEFT_SHOULDER);
    const rightShoulder = landmark(f, POSE_LANDMARK.RIGHT_SHOULDER);

    hipSeparations.push(Math.abs(leftHip.x - rightHip.x));

    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipMidY = (leftHip.y + rightHip.y) / 2;
    torsoHeights.push(Math.abs(hipMidY - shoulderMidY));
  }

  const avgTorsoHeight = average(torsoHeights);
  if (avgTorsoHeight === 0) return "front-or-rear";

  const ratio = average(hipSeparations) / avgTorsoHeight;
  return ratio < SIDE_VIEW_HIP_SEPARATION_RATIO ? "side" : "front-or-rear";
}

// Only "x" is meaningful here — see inferDirectionOfTravelAxis's doc
// comment for why there's no usable second axis once this is based on
// normalized landmarks. Kept as a named type (rather than a bare boolean)
// so computeOverstride's `ankle[travelAxis]` indexing reads the same way
// it always has.
export type TravelAxis = "x";

// The normalized hip midpoint needs to travel at least this many "hip
// widths" across the frame to count as real translation rather than sway/
// jitter — a body-scale-relative threshold (via normalized hip
// separation) rather than a fixed absolute one, so it's robust to how
// zoomed-in the shot is.
const MIN_TRAVEL_RATIO = 3;

/**
 * Infers whether the runner is translating horizontally across the frame
 * over the course of the clip — from the **normalized** (image-space) hip
 * midpoint's x range, not world landmarks. World landmarks can't answer
 * this: their origin is the hip midpoint itself, reset every frame (see
 * pose-landmarks.ts), so the hip's own world position is always ~(0,0,0)
 * and never shows real movement. Normalized x is a genuine absolute
 * image-plane coordinate, so it does.
 *
 * There's deliberately no second candidate axis the way the old world-
 * landmark version compared x against z: normalized y is already spoken
 * for by vertical oscillation (bounce), and normalized z is *still*
 * hip-relative depth, not absolute, even on normalized landmarks — using
 * either as a travel-direction signal would either double-count bounce as
 * "travel" or just reproduce the same broken-origin problem this function
 * exists to avoid.
 *
 * Returns null when there isn't a clearly dominant horizontal drift (e.g.
 * running in place, a treadmill shot, or frames missing
 * `normalizedLandmarks` entirely) — falls back to an undirected
 * measurement, see computeOverstride.
 */
export function inferDirectionOfTravelAxis(frames: PoseFrame[]): TravelAxis | null {
  const hipMidXs: number[] = [];
  const hipWidths: number[] = [];

  for (const f of frames) {
    const leftHip = tryNormalizedLandmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = tryNormalizedLandmark(f, POSE_LANDMARK.RIGHT_HIP);
    if (!leftHip || !rightHip) continue;
    hipMidXs.push((leftHip.x + rightHip.x) / 2);
    hipWidths.push(Math.abs(leftHip.x - rightHip.x));
  }
  if (hipMidXs.length < 2) return null;

  const avgHipWidth = average(hipWidths);
  if (avgHipWidth === 0) return null;

  const rangeX = Math.max(...hipMidXs) - Math.min(...hipMidXs);
  return rangeX >= avgHipWidth * MIN_TRAVEL_RATIO ? "x" : null;
}

/**
 * +1 if the (normalized) hip midpoint net-moved in the positive x
 * direction over the clip, -1 if negative — the sign convention "ahead"
 * is measured against for a signed overstride value. The actual overstride
 * *magnitude* still comes from world landmarks (a same-frame, real-meters
 * measurement, which is valid); this only supplies the sign, assuming
 * world-x and normalized-x point the same real-world direction — the same
 * kind of axis-alignment assumption `PoseFrame`'s Y-down note already
 * makes, documented there rather than re-litigated here.
 *
 * No axis parameter (unlike the old world-landmark version): there's only
 * ever one meaningful travel axis now — see TravelAxis/
 * inferDirectionOfTravelAxis — so the caller already knows it's "x" by
 * the time it decides to call this at all.
 *
 * Simplification: uses net displacement across the whole clip, not
 * per-stride velocity, so a clip that reverses direction partway through
 * (e.g. runs away from camera then back) would get this wrong for the
 * second half — acceptable for a straight-line running shot, the assumed
 * case.
 */
export function inferTravelSign(frames: PoseFrame[]): 1 | -1 {
  const hipMidX = (f: PoseFrame): number | null => {
    const leftHip = tryNormalizedLandmark(f, POSE_LANDMARK.LEFT_HIP);
    const rightHip = tryNormalizedLandmark(f, POSE_LANDMARK.RIGHT_HIP);
    return leftHip && rightHip ? (leftHip.x + rightHip.x) / 2 : null;
  };

  const first = frames.map(hipMidX).find((x) => x !== null) ?? 0;
  const last = [...frames].reverse().map(hipMidX).find((x) => x !== null) ?? 0;
  return last >= first ? 1 : -1;
}
