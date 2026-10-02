import { describe, expect, it } from "vitest";
import { inferCameraAngle, inferDirectionOfTravelAxis, inferTravelSign } from "./camera-angle";
import { POSE_LANDMARK, type PoseFrame } from "./pose-landmarks";
import type { Vec3 } from "./geometry";

function neutralWorldLandmarks(): Vec3[] {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
}

function frameWith(overrides: Partial<Record<number, Vec3>>, timestampMs = 0): PoseFrame {
  const points = neutralWorldLandmarks();
  for (const [index, point] of Object.entries(overrides)) {
    if (point) points[Number(index)] = point;
  }
  return { timestampMs, worldLandmarks: points };
}

// inferDirectionOfTravelAxis/inferTravelSign read normalizedLandmarks, not
// worldLandmarks (see camera-angle.ts's doc comments for why) — a frame
// that omits normalizedLandmarks entirely is the "no usable data" case,
// not a crash, so most of these fixtures set it explicitly while
// worldLandmarks is just filled with neutral placeholder points those two
// functions never read.
function frameWithNormalized(overrides: Partial<Record<number, Vec3>>, timestampMs = 0): PoseFrame {
  const points = neutralWorldLandmarks();
  for (const [index, point] of Object.entries(overrides)) {
    if (point) points[Number(index)] = point;
  }
  return { timestampMs, worldLandmarks: neutralWorldLandmarks(), normalizedLandmarks: points };
}

describe("inferCameraAngle", () => {
  it("classifies a side-on shot as 'side' (hips collapsed in camera x)", () => {
    // Hips nearly coincide in x (the anatomical left-right axis points
    // into the screen), separated in z instead — the side-view signature.
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWith(
        {
          [POSE_LANDMARK.LEFT_HIP]: { x: 0, y: 1.0, z: -0.1 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: 0, y: 1.0, z: 0.1 },
          [POSE_LANDMARK.LEFT_SHOULDER]: { x: 0, y: 1.5, z: -0.1 },
          [POSE_LANDMARK.RIGHT_SHOULDER]: { x: 0, y: 1.5, z: 0.1 },
        },
        i * 33
      )
    );
    expect(inferCameraAngle(frames)).toBe("side");
  });

  it("classifies a front/rear shot as 'front-or-rear' (hips separated in camera x)", () => {
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWith(
        {
          [POSE_LANDMARK.LEFT_HIP]: { x: -0.15, y: 1.0, z: 0 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: 0.15, y: 1.0, z: 0 },
          [POSE_LANDMARK.LEFT_SHOULDER]: { x: -0.2, y: 1.5, z: 0 },
          [POSE_LANDMARK.RIGHT_SHOULDER]: { x: 0.2, y: 1.5, z: 0 },
        },
        i * 33
      )
    );
    expect(inferCameraAngle(frames)).toBe("front-or-rear");
  });

  it("defaults to 'front-or-rear' rather than suppressing on no data", () => {
    expect(inferCameraAngle([])).toBe("front-or-rear");
  });

  it("defaults to 'front-or-rear' rather than dividing by zero on a degenerate torso", () => {
    const frames = [
      frameWith({
        [POSE_LANDMARK.LEFT_HIP]: { x: 0, y: 0, z: 0 },
        [POSE_LANDMARK.RIGHT_HIP]: { x: 0, y: 0, z: 0 },
        [POSE_LANDMARK.LEFT_SHOULDER]: { x: 0, y: 0, z: 0 },
        [POSE_LANDMARK.RIGHT_SHOULDER]: { x: 0, y: 0, z: 0 },
      }),
    ];
    expect(inferCameraAngle(frames)).toBe("front-or-rear");
  });
});

describe("inferDirectionOfTravelAxis", () => {
  it("detects x as the dominant travel axis (normalized hip-mid drift well past hip width)", () => {
    // Hip-mid x ranges 0 -> 1.8 across the clip, against a constant 0.05
    // hip width (normalized units) — a 36x ratio, comfortably past the 3x
    // MIN_TRAVEL_RATIO threshold.
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWithNormalized(
        {
          [POSE_LANDMARK.LEFT_HIP]: { x: i * 0.2 - 0.025, y: 0.5, z: 0 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: i * 0.2 + 0.025, y: 0.5, z: 0 },
        },
        i * 33
      )
    );
    expect(inferDirectionOfTravelAxis(frames)).toBe("x");
  });

  it("returns null when hip-mid drift is on the same scale as hip width (e.g. running in place)", () => {
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWithNormalized(
        {
          // Tiny jitter (+/- 0.01) against a much larger 0.1 hip width —
          // nowhere near the 3x-hip-width travel threshold.
          [POSE_LANDMARK.LEFT_HIP]: { x: -0.05 + (i % 2 === 0 ? 0.01 : -0.01), y: 0.5, z: 0 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: 0.05 + (i % 2 === 0 ? 0.01 : -0.01), y: 0.5, z: 0 },
        },
        i * 33
      )
    );
    expect(inferDirectionOfTravelAxis(frames)).toBeNull();
  });

  it("returns null with fewer than two valid frames", () => {
    expect(inferDirectionOfTravelAxis([frameWithNormalized({})])).toBeNull();
  });

  it("returns null when frames carry no normalizedLandmarks at all", () => {
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWith(
        {
          [POSE_LANDMARK.LEFT_HIP]: { x: i * 0.2, y: 1, z: 0 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: i * 0.2, y: 1, z: 0 },
        },
        i * 33
      )
    );
    expect(inferDirectionOfTravelAxis(frames)).toBeNull();
  });
});

describe("inferTravelSign", () => {
  it("returns +1 when the normalized hip midpoint net-moves positive along x", () => {
    const frames = [
      frameWithNormalized(
        { [POSE_LANDMARK.LEFT_HIP]: { x: -0.05, y: 0.5, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 0.05, y: 0.5, z: 0 } },
        0
      ),
      frameWithNormalized(
        { [POSE_LANDMARK.LEFT_HIP]: { x: 0.95, y: 0.5, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 1.05, y: 0.5, z: 0 } },
        100
      ),
    ];
    expect(inferTravelSign(frames)).toBe(1);
  });

  it("returns -1 when the normalized hip midpoint net-moves negative along x", () => {
    const frames = [
      frameWithNormalized(
        { [POSE_LANDMARK.LEFT_HIP]: { x: 0.95, y: 0.5, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 1.05, y: 0.5, z: 0 } },
        0
      ),
      frameWithNormalized(
        { [POSE_LANDMARK.LEFT_HIP]: { x: -0.05, y: 0.5, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 0.05, y: 0.5, z: 0 } },
        100
      ),
    ];
    expect(inferTravelSign(frames)).toBe(-1);
  });

  it("skips frames missing normalizedLandmarks when finding the first/last valid sample", () => {
    const frames = [
      frameWith({ [POSE_LANDMARK.LEFT_HIP]: { x: 99, y: 99, z: 99 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 99, y: 99, z: 99 } }, 0),
      frameWithNormalized(
        { [POSE_LANDMARK.LEFT_HIP]: { x: -0.05, y: 0.5, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 0.05, y: 0.5, z: 0 } },
        100
      ),
      frameWithNormalized(
        { [POSE_LANDMARK.LEFT_HIP]: { x: 0.95, y: 0.5, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 1.05, y: 0.5, z: 0 } },
        200
      ),
      frameWith({ [POSE_LANDMARK.LEFT_HIP]: { x: -99, y: -99, z: -99 }, [POSE_LANDMARK.RIGHT_HIP]: { x: -99, y: -99, z: -99 } }, 300),
    ];
    expect(inferTravelSign(frames)).toBe(1);
  });
});
