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
   * ASSUMPTION, not yet verified against a real captured session: +Y
   * increases downward, matching MediaPipe's normalized image-landmark
   * convention (smaller y = higher up, e.g. head; larger y = lower, e.g.
   * feet). Every "higher/lower" comparison in this module depends on that
   * sign. If computed metrics look inverted once run against real
   * footage (Batch 5+), this is the first thing to check.
   */
  worldLandmarks: Vec3[];
}

/** Looks up a landmark by index, throwing if the frame doesn't have it — a
 * caller bug (an incomplete frame should never have been pushed) rather
 * than something to silently tolerate. */
export function landmark(frame: PoseFrame, index: number): Vec3 {
  const point = frame.worldLandmarks[index];
  if (!point) {
    throw new Error(`Pose frame at ${frame.timestampMs}ms is missing landmark index ${index}`);
  }
  return point;
}
