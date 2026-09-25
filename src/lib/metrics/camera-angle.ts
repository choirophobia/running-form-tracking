import { average } from "./geometry";
import { landmark, POSE_LANDMARK, type PoseFrame } from "./pose-landmarks";

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

export type TravelAxis = "x" | "z";

// Below this ratio between the two horizontal axes' movement range, there
// isn't a clearly dominant direction of travel (e.g. running in place, or
// a treadmill shot centered on the runner) — not confident enough to sign
// an overstride value against.
const MIN_DOMINANT_AXIS_RATIO = 2;

/**
 * Infers which horizontal axis (camera-relative x or z) the runner is
 * translating along over the course of the clip, from how much the hip
 * midpoint's range of motion on each axis differs — a side shot typically
 * shows a clear, dominant direction of travel across the frame. Returns
 * null when neither axis clearly dominates (falls back to an undirected
 * measurement — see computeOverstride).
 */
export function inferDirectionOfTravelAxis(frames: PoseFrame[]): TravelAxis | null {
  if (frames.length < 2) return null;

  const hipMidX = frames.map(
    (f) => (landmark(f, POSE_LANDMARK.LEFT_HIP).x + landmark(f, POSE_LANDMARK.RIGHT_HIP).x) / 2
  );
  const hipMidZ = frames.map(
    (f) => (landmark(f, POSE_LANDMARK.LEFT_HIP).z + landmark(f, POSE_LANDMARK.RIGHT_HIP).z) / 2
  );

  const rangeX = Math.max(...hipMidX) - Math.min(...hipMidX);
  const rangeZ = Math.max(...hipMidZ) - Math.min(...hipMidZ);

  if (rangeX === 0 && rangeZ === 0) return null;
  if (rangeX >= rangeZ * MIN_DOMINANT_AXIS_RATIO) return "x";
  if (rangeZ >= rangeX * MIN_DOMINANT_AXIS_RATIO) return "z";
  return null;
}

/** +1 if the hip midpoint net-moved in the positive direction of `axis`
 * over the clip, -1 if negative — the sign convention "ahead" is measured
 * against for a signed overstride value. Simplification: uses net
 * displacement across the whole clip, not per-stride velocity, so a clip
 * that reverses direction partway through (e.g. runs away from camera then
 * back) would get this wrong for the second half — acceptable for a
 * straight-line running shot, which is the assumed case. */
export function inferTravelSign(frames: PoseFrame[], axis: TravelAxis): 1 | -1 {
  const hipMid = (f: PoseFrame) =>
    (landmark(f, POSE_LANDMARK.LEFT_HIP)[axis] + landmark(f, POSE_LANDMARK.RIGHT_HIP)[axis]) / 2;
  return hipMid(frames[frames.length - 1]) >= hipMid(frames[0]) ? 1 : -1;
}
