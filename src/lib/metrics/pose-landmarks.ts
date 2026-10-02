import type { Vec3 } from "./geometry";

// BlazePose / MediaPipe Pose Landmarker's 33-point topology — same indices
// used by PoseLandmarker.POSE_CONNECTIONS for the Batch 1 skeleton overlay.
// See https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
export const POSE_LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

/**
 * A world landmark plus MediaPipe's own confidence signal for it.
 * `visibility` (0-1, from `PoseLandmarkerResult.worldLandmarks`) is
 * MediaPipe's estimate of whether that point is actually visible (not
 * occluded) in the frame — genuinely useful for a side-on shot, where the
 * far-side arm/leg is frequently partly hidden behind the body. Optional
 * because synthetic test fixtures generally don't set it (see `isVisible`
 * below for how an absent value is treated).
 */
export interface PoseLandmark extends Vec3 {
  visibility?: number;
}

export interface PoseFrame {
  /**
   * Timestamp in ms, relative to the video's own playback position (e.g.
   * `video.currentTime * 1000`) — NOT wall-clock time or the timestamp
   * argument passed to `detectForVideo` (that one only needs to be
   * monotonically increasing; it doesn't need to track real video time).
   * Interval-based metrics like cadence depend on this being actual video
   * content time, so it stays correct regardless of processing speed/lag.
   */
  timestampMs: number;
  /**
   * World landmarks (PoseLandmarkerResult.worldLandmarks[0]): real-world
   * 3D coordinates in meters, NOT the normalized [0,1] image landmarks.
   * All 33 BlazePose points must be present — callers should only push
   * frames where a pose was actually detected.
   *
   * CONFIRMED (MediaPipe's own docs, not an assumption): the origin is
   * the midpoint of the hips, **reset on every single frame**. That makes
   * world landmarks excellent for *same-frame, relative* measurements —
   * one joint vs. another, limb lengths, joint angles — but structurally
   * useless for tracking how a joint's *own* position changes *across*
   * frames (the hip itself is always ~(0,0,0); it can never show
   * movement). For that, use `normalizedLandmarks` below instead. This
   * was found the hard way: `computeVerticalOscillation` originally read
   * hip.y here and always computed ~0 — not a bug in the peak-finding,
   * a wrong coordinate space for a cross-frame measurement.
   *
   * ASSUMPTION, not yet verified against a real captured session: +Y
   * increases downward, matching MediaPipe's normalized image-landmark
   * convention (smaller y = higher up, e.g. head; larger y = lower, e.g.
   * feet). Every "higher/lower" comparison in this module depends on that
   * sign. If computed metrics look inverted once run against real
   * footage, this is the first thing to check.
   */
  worldLandmarks: PoseLandmark[];
  /**
   * Normalized (image-space) landmarks (PoseLandmarkerResult.landmarks[0]):
   * x/y in [0,1] relative to the video frame — genuine **absolute**
   * image-plane position, *not* recentered to the hip the way world
   * landmarks are. Use this specifically for tracking a joint's position
   * *across* frames (vertical oscillation, direction of travel), assuming
   * the camera itself is reasonably stationary during capture.
   *
   * `z` on these points is still hip-relative depth (same origin as world
   * landmarks), not an absolute coordinate — never use `.z` here for
   * anything that assumes a cross-frame or absolute meaning; only `.x`/
   * `.y` are safe for that.
   *
   * Optional: older/synthetic frames that don't need cross-frame tracking
   * can omit it. A function that needs it (and doesn't have it) should
   * return `null`/fall back, not throw — see `tryNormalizedLandmark`.
   */
  normalizedLandmarks?: PoseLandmark[];
}

/** Looks up a world landmark by index, throwing if the frame doesn't have
 * it — a caller bug (an incomplete frame should never have been pushed)
 * rather than something to silently tolerate. */
export function landmark(frame: PoseFrame, index: number): PoseLandmark {
  const point = frame.worldLandmarks[index];
  if (!point) {
    throw new Error(`Pose frame at ${frame.timestampMs}ms is missing landmark index ${index}`);
  }
  return point;
}

/** Looks up a normalized landmark by index, returning `null` (not
 * throwing) if the frame has no `normalizedLandmarks` at all or is
 * missing that specific point — unlike `landmark`, this is an optional
 * field, so "not present" is an expected, handle-it case, not a bug. */
export function tryNormalizedLandmark(frame: PoseFrame, index: number): PoseLandmark | null {
  return frame.normalizedLandmarks?.[index] ?? null;
}

/** Below this MediaPipe visibility score, treat a landmark as too
 * unreliable to sample from — common for the far-side limb on a side-on
 * shot, where it's frequently partly occluded by the torso. */
export const MIN_LANDMARK_VISIBILITY = 0.5;

/** A landmark with no `visibility` value at all (e.g. most synthetic test
 * fixtures) is treated as fully trusted — only an explicit low score
 * excludes it. */
export function isVisible(point: PoseLandmark, threshold = MIN_LANDMARK_VISIBILITY): boolean {
  return point.visibility === undefined || point.visibility >= threshold;
}

/** True only if every given landmark individually passes `isVisible`. */
export function allVisible(points: PoseLandmark[], threshold = MIN_LANDMARK_VISIBILITY): boolean {
  return points.every((point) => isVisible(point, threshold));
}
