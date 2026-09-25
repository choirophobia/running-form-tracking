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
  it("detects x as the dominant travel axis", () => {
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWith(
        {
          [POSE_LANDMARK.LEFT_HIP]: { x: i * 0.2, y: 1, z: 0 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: i * 0.2, y: 1, z: 0.01 },
        },
        i * 33
      )
    );
    expect(inferDirectionOfTravelAxis(frames)).toBe("x");
  });

  it("detects z as the dominant travel axis", () => {
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWith(
        {
          [POSE_LANDMARK.LEFT_HIP]: { x: 0, y: 1, z: i * 0.2 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: 0.01, y: 1, z: i * 0.2 },
        },
        i * 33
      )
    );
    expect(inferDirectionOfTravelAxis(frames)).toBe("z");
  });

  it("returns null when neither axis clearly dominates (e.g. running in place)", () => {
    const frames: PoseFrame[] = Array.from({ length: 10 }, (_, i) =>
      frameWith(
        {
          [POSE_LANDMARK.LEFT_HIP]: { x: 0, y: 1, z: 0 },
          [POSE_LANDMARK.RIGHT_HIP]: { x: 0, y: 1, z: 0 },
        },
        i * 33
      )
    );
    expect(inferDirectionOfTravelAxis(frames)).toBeNull();
  });

  it("returns null with fewer than two frames", () => {
    expect(inferDirectionOfTravelAxis([frameWith({})])).toBeNull();
  });
});

describe("inferTravelSign", () => {
  it("returns +1 when the hip midpoint net-moves positive along the axis", () => {
    const frames = [
      frameWith({ [POSE_LANDMARK.LEFT_HIP]: { x: 0, y: 0, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 0, y: 0, z: 0 } }, 0),
      frameWith({ [POSE_LANDMARK.LEFT_HIP]: { x: 1, y: 0, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 1, y: 0, z: 0 } }, 100),
    ];
    expect(inferTravelSign(frames, "x")).toBe(1);
  });

  it("returns -1 when the hip midpoint net-moves negative along the axis", () => {
    const frames = [
      frameWith({ [POSE_LANDMARK.LEFT_HIP]: { x: 1, y: 0, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 1, y: 0, z: 0 } }, 0),
      frameWith({ [POSE_LANDMARK.LEFT_HIP]: { x: 0, y: 0, z: 0 }, [POSE_LANDMARK.RIGHT_HIP]: { x: 0, y: 0, z: 0 } }, 100),
    ];
    expect(inferTravelSign(frames, "x")).toBe(-1);
  });
});
