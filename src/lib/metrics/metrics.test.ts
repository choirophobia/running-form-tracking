import { describe, expect, it } from "vitest";
import {
  computeArmSwingSymmetry,
  computeCadence,
  computeHipDrop,
  computeLandingForm,
  computeMetrics,
  computeOverstride,
  computeVerticalOscillation,
} from "./metrics";
import { POSE_LANDMARK, type PoseFrame } from "./pose-landmarks";
import type { Vec3 } from "./geometry";

const FRAME_INTERVAL_MS = 1000 / 30;

function neutralWorldLandmarks(): Vec3[] {
  const points: Vec3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  points[POSE_LANDMARK.LEFT_HIP] = { x: -0.1, y: 0, z: 0 };
  points[POSE_LANDMARK.RIGHT_HIP] = { x: 0.1, y: 0, z: 0 };
  points[POSE_LANDMARK.LEFT_ANKLE] = { x: -0.1, y: 0.9, z: 0 };
  points[POSE_LANDMARK.RIGHT_ANKLE] = { x: 0.1, y: 0.9, z: 0 };
  points[POSE_LANDMARK.LEFT_HEEL] = { x: -0.1, y: 0.95, z: 0 };
  points[POSE_LANDMARK.RIGHT_HEEL] = { x: 0.1, y: 0.95, z: 0 };
  points[POSE_LANDMARK.LEFT_FOOT_INDEX] = { x: -0.1, y: 0.95, z: 0.1 };
  points[POSE_LANDMARK.RIGHT_FOOT_INDEX] = { x: 0.1, y: 0.95, z: 0.1 };
  return points;
}

/**
 * A synthetic alternating-stride session: ankle-relative-to-hip height
 * follows a clean cosine (known footstrike times, same construction as
 * strides.test.ts), with an optional per-frame `augment` hook to layer in
 * whatever a specific metric test needs (fixed or time-varying landmark
 * positions elsewhere on the body).
 */
function buildStrideSession(options: {
  durationMs?: number;
  periodMs?: number;
  leftPhaseMs?: number;
  rightPhaseMs?: number;
  augment?: (points: Vec3[], t: number) => void;
}): PoseFrame[] {
  const {
    durationMs = 3000,
    periodMs = 600,
    leftPhaseMs = 150,
    rightPhaseMs = 450,
    augment,
  } = options;

  const frames: PoseFrame[] = [];
  for (let t = 0; t <= durationMs; t += FRAME_INTERVAL_MS) {
    const points = neutralWorldLandmarks();
    const leftY = 0.9 + 0.05 * Math.cos((2 * Math.PI * (t - leftPhaseMs)) / periodMs);
    const rightY = 0.9 + 0.05 * Math.cos((2 * Math.PI * (t - rightPhaseMs)) / periodMs);
    points[POSE_LANDMARK.LEFT_ANKLE] = { x: -0.1, y: leftY, z: 0 };
    points[POSE_LANDMARK.RIGHT_ANKLE] = { x: 0.1, y: rightY, z: 0 };
    augment?.(points, t);
    frames.push({ timestampMs: t, worldLandmarks: points });
  }
  return frames;
}

describe("computeCadence", () => {
  it("matches the known combined-strike interval of the synthetic session", () => {
    // Left/right footstrikes 300ms apart (see buildStrideSession defaults)
    // -> 10 total strikes, 9 intervals averaging ~300ms -> ~200 steps/min.
    const session = buildStrideSession({});
    const result = computeCadence(session);
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(9);
    expect(result!.stepsPerMinute).toBeGreaterThan(180);
    expect(result!.stepsPerMinute).toBeLessThan(220);
  });

  it("returns null with fewer than two footstrikes", () => {
    expect(computeCadence([])).toBeNull();
  });
});

describe("computeVerticalOscillation", () => {
  it("matches a known hip-bounce amplitude", () => {
    // Hip height oscillates with a 300ms period (== the combined-strike
    // interval), peak-to-trough amplitude exactly 0.06m = 6cm — any
    // window spanning a full period captures the full range regardless
    // of phase, so each stride segment should read ~6cm.
    const session = buildStrideSession({
      augment: (points, t) => {
        const hipY = 1.0 + 0.03 * Math.cos((2 * Math.PI * t) / 300);
        points[POSE_LANDMARK.LEFT_HIP] = { x: -0.1, y: hipY, z: 0 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0.1, y: hipY, z: 0 };
      },
    });
    const result = computeVerticalOscillation(session);
    expect(result).not.toBeNull();
    expect(result!.oscillationCm).toBeGreaterThan(5.5);
    expect(result!.oscillationCm).toBeLessThan(6.5);
  });

  it("returns null with fewer than two footstrikes", () => {
    expect(computeVerticalOscillation([])).toBeNull();
  });
});

describe("computeOverstride", () => {
  it("matches a known, frame-invariant foot-to-hip horizontal distance", () => {
    // Both ankles held at x=0.3 for every frame while the hip midpoint
    // stays at x=0 -> horizontal distance is exactly 30cm regardless of
    // which frame gets picked as the strike.
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_ANKLE] = { ...points[POSE_LANDMARK.LEFT_ANKLE], x: 0.3, z: 0 };
        points[POSE_LANDMARK.RIGHT_ANKLE] = { ...points[POSE_LANDMARK.RIGHT_ANKLE], x: 0.3, z: 0 };
      },
    });
    const result = computeOverstride(session);
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(10);
    expect(result!.overstrideCm).toBeCloseTo(30, 6);
  });

  it("returns null with no detected footstrikes", () => {
    expect(computeOverstride([])).toBeNull();
  });
});

describe("computeHipDrop", () => {
  it("matches a known, frame-invariant pelvis-tilt angle", () => {
    // Hips held at a fixed vertical/horizontal offset every frame ->
    // atan(0.02 / 0.2) exactly, regardless of which frame is the strike.
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HIP] = { x: -0.1, y: 0.02, z: 0 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0.1, y: 0, z: 0 };
      },
    });
    const expectedDegrees = (Math.atan(0.02 / 0.2) * 180) / Math.PI;
    const result = computeHipDrop(session);
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(10);
    expect(result!.hipDropDegrees).toBeCloseTo(expectedDegrees, 6);
  });

  it("returns null with no detected footstrikes", () => {
    expect(computeHipDrop([])).toBeNull();
  });
});

describe("computeArmSwingSymmetry", () => {
  it("matches known elbow-angle ranges of motion for each arm", () => {
    // Left elbow sweeps 90deg -> 180deg (ROM 90); right sweeps
    // 100deg -> 160deg (ROM 60). Elbow positions are fixed; only the
    // wrist angle around the elbow changes between the two frames.
    const leftElbow = { x: -1, y: 0, z: 0 };
    const leftShoulder = { x: 0, y: 0, z: 0 }; // elbow + (1,0,0)
    const rightElbow = { x: 1, y: 0, z: 0 };
    const rightShoulder = { x: 2, y: 0, z: 0 }; // elbow + (1,0,0)

    const wristAt = (elbow: Vec3, degrees: number): Vec3 => {
      const rad = (degrees * Math.PI) / 180;
      return { x: elbow.x + Math.cos(rad), y: elbow.y + Math.sin(rad), z: 0 };
    };

    function frameAt(timestampMs: number, leftDeg: number, rightDeg: number): PoseFrame {
      const points = neutralWorldLandmarks();
      points[POSE_LANDMARK.LEFT_SHOULDER] = leftShoulder;
      points[POSE_LANDMARK.LEFT_ELBOW] = leftElbow;
      points[POSE_LANDMARK.LEFT_WRIST] = wristAt(leftElbow, leftDeg);
      points[POSE_LANDMARK.RIGHT_SHOULDER] = rightShoulder;
      points[POSE_LANDMARK.RIGHT_ELBOW] = rightElbow;
      points[POSE_LANDMARK.RIGHT_WRIST] = wristAt(rightElbow, rightDeg);
      return { timestampMs, worldLandmarks: points };
    }

    const frames = [frameAt(0, 90, 100), frameAt(FRAME_INTERVAL_MS, 180, 160)];
    const result = computeArmSwingSymmetry(frames);

    expect(result).not.toBeNull();
    expect(result!.leftRangeOfMotionDegrees).toBeCloseTo(90, 6);
    expect(result!.rightRangeOfMotionDegrees).toBeCloseTo(60, 6);
    expect(result!.symmetryScore).toBeCloseTo(100 * (1 - 30 / 90), 6);
  });

  it("returns 100 (perfectly symmetric) when both arms don't move", () => {
    const points = neutralWorldLandmarks();
    points[POSE_LANDMARK.LEFT_SHOULDER] = { x: 0, y: 0, z: 0 };
    points[POSE_LANDMARK.LEFT_ELBOW] = { x: 1, y: 0, z: 0 };
    points[POSE_LANDMARK.LEFT_WRIST] = { x: 2, y: 0, z: 0 };
    points[POSE_LANDMARK.RIGHT_SHOULDER] = { x: 0, y: 0, z: 0 };
    points[POSE_LANDMARK.RIGHT_ELBOW] = { x: -1, y: 0, z: 0 };
    points[POSE_LANDMARK.RIGHT_WRIST] = { x: -2, y: 0, z: 0 };
    const frames = [
      { timestampMs: 0, worldLandmarks: points },
      { timestampMs: FRAME_INTERVAL_MS, worldLandmarks: points },
    ];
    expect(computeArmSwingSymmetry(frames)!.symmetryScore).toBe(100);
  });

  it("returns null with fewer than two frames", () => {
    expect(computeArmSwingSymmetry([])).toBeNull();
  });
});

describe("computeLandingForm", () => {
  const heelStrikeSession = buildStrideSession({
    augment: (points) => {
      points[POSE_LANDMARK.LEFT_HEEL] = { x: -0.1, y: 0.95, z: 0 };
      points[POSE_LANDMARK.LEFT_FOOT_INDEX] = { x: -0.1, y: 0.9, z: 0.1 };
      points[POSE_LANDMARK.RIGHT_HEEL] = { x: 0.1, y: 0.95, z: 0 };
      points[POSE_LANDMARK.RIGHT_FOOT_INDEX] = { x: 0.1, y: 0.9, z: 0.1 };
    },
  });

  it("classifies a clear heel strike, full confidence at the full fps tier", () => {
    const result = computeLandingForm(heelStrikeSession, "full");
    expect(result).toEqual({ pattern: "heel", confidence: "full", sampleCount: 10 });
  });

  it("classifies the same data as reduced confidence at the reduced fps tier", () => {
    const result = computeLandingForm(heelStrikeSession, "reduced");
    expect(result?.confidence).toBe("reduced");
    expect(result?.pattern).toBe("heel");
  });

  it("returns null (unavailable) at the blocked fps tier regardless of data", () => {
    expect(computeLandingForm(heelStrikeSession, "blocked")).toBeNull();
  });

  it("classifies a clear forefoot strike", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HEEL] = { x: -0.1, y: 0.9, z: 0 };
        points[POSE_LANDMARK.LEFT_FOOT_INDEX] = { x: -0.1, y: 0.95, z: 0.1 };
        points[POSE_LANDMARK.RIGHT_HEEL] = { x: 0.1, y: 0.9, z: 0 };
        points[POSE_LANDMARK.RIGHT_FOOT_INDEX] = { x: 0.1, y: 0.95, z: 0.1 };
      },
    });
    expect(computeLandingForm(session, "full")?.pattern).toBe("forefoot");
  });

  it("classifies a near-equal heel/toe height as midfoot", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HEEL] = { x: -0.1, y: 0.9, z: 0 };
        points[POSE_LANDMARK.LEFT_FOOT_INDEX] = { x: -0.1, y: 0.9, z: 0.1 };
        points[POSE_LANDMARK.RIGHT_HEEL] = { x: 0.1, y: 0.9, z: 0 };
        points[POSE_LANDMARK.RIGHT_FOOT_INDEX] = { x: 0.1, y: 0.9, z: 0.1 };
      },
    });
    expect(computeLandingForm(session, "full")?.pattern).toBe("midfoot");
  });
});

describe("computeMetrics", () => {
  it("computes all six metrics together for a full synthetic session", () => {
    const session = buildStrideSession({
      augment: (points, t) => {
        const hipY = 1.0 + 0.03 * Math.cos((2 * Math.PI * t) / 300);
        points[POSE_LANDMARK.LEFT_HIP] = { x: -0.1, y: hipY, z: 0 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0.1, y: hipY, z: 0 };
      },
    });
    const result = computeMetrics(session, "full");

    expect(result.cadence).not.toBeNull();
    expect(result.verticalOscillation).not.toBeNull();
    expect(result.overstride).not.toBeNull();
    expect(result.hipDrop).not.toBeNull();
    expect(result.armSwingSymmetry).not.toBeNull();
    expect(result.landingForm).not.toBeNull();
    expect(result.landingForm!.confidence).toBe("full");
  });

  it("omits landing form when the fps tier is blocked", () => {
    const session = buildStrideSession({});
    expect(computeMetrics(session, "blocked").landingForm).toBeNull();
  });
});
