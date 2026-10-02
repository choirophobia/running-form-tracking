import { describe, expect, it } from "vitest";
import {
  computeArmSwingSymmetry,
  computeCadence,
  computeFlightTime,
  computeGroundContactTime,
  computeHipDrop,
  computeLandingForm,
  computeMetrics,
  computeOverstride,
  computeStrideDiagnostics,
  computeVerticalOscillation,
} from "./metrics";
import { POSE_LANDMARK, type PoseFrame, type PoseLandmark } from "./pose-landmarks";
import type { Vec3 } from "./geometry";

const FRAME_INTERVAL_MS = 1000 / 30;

function neutralWorldLandmarks(): PoseLandmark[] {
  const points: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  // Shoulders above the hips (smaller y, under the Y-down convention) at a
  // realistic torso-height offset — needed so inferCameraAngle's hip-
  // separation-to-torso-height ratio reads as a plausible front/rear shot
  // by default, not an accidental (0,0,0) degenerate torso. Tests that
  // care about camera-angle classification specifically (or about arm
  // swing, which overrides shoulders anyway) set their own positions.
  points[POSE_LANDMARK.LEFT_SHOULDER] = { x: -0.1, y: -0.5, z: 0 };
  points[POSE_LANDMARK.RIGHT_SHOULDER] = { x: 0.1, y: -0.5, z: 0 };
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
  augment?: (points: PoseLandmark[], t: number) => void;
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

    // Re-derive shoulders at a realistic offset above wherever the hips
    // ended up (a test's augment may move them) so inferCameraAngle's
    // torso-height reference stays sane regardless of what a given test
    // does to hip position.
    const hipMidX = (points[POSE_LANDMARK.LEFT_HIP].x + points[POSE_LANDMARK.RIGHT_HIP].x) / 2;
    const hipMidY = (points[POSE_LANDMARK.LEFT_HIP].y + points[POSE_LANDMARK.RIGHT_HIP].y) / 2;
    points[POSE_LANDMARK.LEFT_SHOULDER] = { x: hipMidX - 0.1, y: hipMidY - 0.5, z: 0 };
    points[POSE_LANDMARK.RIGHT_SHOULDER] = { x: hipMidX + 0.1, y: hipMidY - 0.5, z: 0 };

    // Mirrors worldLandmarks' x/y exactly (not a realistic normalized
    // [0,1] image-space range, but these tests never depend on the actual
    // scale) so that computeVerticalOscillation's world/normalized
    // leg-length calibration ratio comes out to exactly 1 — letting tests
    // keep asserting closed-form expected values without separately
    // deriving a normalized-space fixture. See camera-angle.test.ts for
    // fixtures that *do* care about realistic normalized hip-width scale.
    const normalizedLandmarks = points.map((p) => ({ ...p }));

    frames.push({ timestampMs: t, worldLandmarks: points, normalizedLandmarks });
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

  it("normalizes against estimated leg length", () => {
    // Ankles held 10m out on x (dominates hip-to-ankle distance, so leg
    // length stays close to a known ~10m regardless of the small y
    // oscillations from both hip and ankle) while hips still oscillate
    // with the same known 6cm amplitude as the test above.
    const session = buildStrideSession({
      augment: (points, t) => {
        const hipY = 1.0 + 0.03 * Math.cos((2 * Math.PI * t) / 300);
        points[POSE_LANDMARK.LEFT_HIP] = { x: 0, y: hipY, z: 0 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0, y: hipY, z: 0 };
        points[POSE_LANDMARK.LEFT_ANKLE] = { ...points[POSE_LANDMARK.LEFT_ANKLE], x: 10, z: 0 };
        points[POSE_LANDMARK.RIGHT_ANKLE] = { ...points[POSE_LANDMARK.RIGHT_ANKLE], x: 10, z: 0 };
      },
    });
    const result = computeVerticalOscillation(session);
    expect(result).not.toBeNull();
    expect(result!.oscillationCm).toBeGreaterThan(5.5);
    expect(result!.oscillationCm).toBeLessThan(6.5);
    // Leg length ~10m -> 1000cm, so percent should sit close to
    // oscillationCm / 1000 * 100 = oscillationCm / 10 (~0.6%).
    expect(result!.oscillationPercentLegLength).not.toBeNull();
    expect(result!.oscillationPercentLegLength!).toBeGreaterThan(0.5);
    expect(result!.oscillationPercentLegLength!).toBeLessThan(0.7);
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
    // No hip movement over time in this fixture -> no direction of travel
    // to sign against -> falls back to the undirected formula.
    expect(result!.signed).toBe(false);
  });

  it("returns a signed value when a direction of travel is inferred", () => {
    // Hips translate steadily along x (a side-shot signature — see
    // camera-angle.test.ts) while ankles are held 0.3m *behind* the hip
    // in x at every frame -> the foot is landing behind the direction of
    // travel, which should read as a negative (not just small) value,
    // unlike the undirected fallback which can only ever be >= 0.
    const session = buildStrideSession({
      augment: (points, t) => {
        const hipX = t * 0.001; // steady translation along x
        points[POSE_LANDMARK.LEFT_HIP] = { x: hipX - 0.1, y: 0, z: 0 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: hipX + 0.1, y: 0, z: 0 };
        points[POSE_LANDMARK.LEFT_ANKLE] = { ...points[POSE_LANDMARK.LEFT_ANKLE], x: hipX - 0.3, z: 0 };
        points[POSE_LANDMARK.RIGHT_ANKLE] = { ...points[POSE_LANDMARK.RIGHT_ANKLE], x: hipX - 0.3, z: 0 };
      },
    });
    const result = computeOverstride(session);
    expect(result).not.toBeNull();
    expect(result!.signed).toBe(true);
    expect(result!.overstrideCm).toBeCloseTo(-30, 6);
  });

  it("returns null with no detected footstrikes", () => {
    expect(computeOverstride([])).toBeNull();
  });

  it("normalizes against estimated leg length", () => {
    // Hip fixed at the origin, ankle held 10m out on x (so leg length
    // stays close to a known ~10m, dominated by that horizontal offset)
    // while overstrideCm itself is still exactly 10m = 1000cm.
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HIP] = { x: 0, y: 0, z: 0 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0, y: 0, z: 0 };
        points[POSE_LANDMARK.LEFT_ANKLE] = { ...points[POSE_LANDMARK.LEFT_ANKLE], x: 10, z: 0 };
        points[POSE_LANDMARK.RIGHT_ANKLE] = { ...points[POSE_LANDMARK.RIGHT_ANKLE], x: 10, z: 0 };
      },
    });
    const result = computeOverstride(session);
    expect(result).not.toBeNull();
    expect(result!.overstrideCm).toBeCloseTo(1000, 0);
    // Leg length ~10m -> overstride ~= leg length -> percent close to 100%.
    expect(result!.overstridePercentLegLength).not.toBeNull();
    expect(result!.overstridePercentLegLength!).toBeGreaterThan(95);
    expect(result!.overstridePercentLegLength!).toBeLessThan(105);
  });

  it("excludes strikes where the ankle has low visibility", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_ANKLE] = { ...points[POSE_LANDMARK.LEFT_ANKLE], x: 0.3, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.RIGHT_ANKLE] = { ...points[POSE_LANDMARK.RIGHT_ANKLE], x: 0.3, z: 0, visibility: 0.1 };
      },
    });
    // Every strike's ankle is below the visibility threshold -> nothing
    // left to sample from, same as "no detected footstrikes".
    expect(computeOverstride(session)).toBeNull();
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

  it("returns null for side-view footage instead of a misleading angle", () => {
    // Hips collapsed onto each other in x (the side-view signature — see
    // camera-angle.test.ts), separated in z instead. The same vertical
    // offset that produced a real angle in the front/rear test above must
    // now be suppressed entirely, not silently reported.
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HIP] = { x: 0, y: 0.02, z: -0.1 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0, y: 0, z: 0.1 };
        points[POSE_LANDMARK.LEFT_SHOULDER] = { x: 0, y: -0.5, z: -0.1 };
        points[POSE_LANDMARK.RIGHT_SHOULDER] = { x: 0, y: -0.5, z: 0.1 };
      },
    });
    expect(computeHipDrop(session)).toBeNull();
  });

  it("respects an explicitly passed camera angle over the inferred one", () => {
    // Hip x-separation small enough to still infer as "side" (0.02m vs.
    // ~0.5m torso height), but non-zero so the underlying angle formula
    // still has something to compute once the gate is overridden.
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HIP] = { x: -0.01, y: 0.02, z: -0.1 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0.01, y: 0, z: 0.1 };
      },
    });
    expect(computeHipDrop(session, "side")).toBeNull();
    expect(computeHipDrop(session, "front-or-rear")).not.toBeNull();
  });

  it("excludes strikes where a hip landmark has low visibility", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HIP] = { x: -0.1, y: 0.02, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0.1, y: 0, z: 0 };
      },
    });
    expect(computeHipDrop(session)).toBeNull();
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
    expect(result!.leftSampleCount).toBe(2);
    expect(result!.rightSampleCount).toBe(2);
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

  it("returns null when one arm is entirely low-visibility", () => {
    const points = neutralWorldLandmarks();
    points[POSE_LANDMARK.LEFT_SHOULDER] = { x: 0, y: 0, z: 0, visibility: 0.1 };
    points[POSE_LANDMARK.LEFT_ELBOW] = { x: 1, y: 0, z: 0, visibility: 0.1 };
    points[POSE_LANDMARK.LEFT_WRIST] = { x: 2, y: 0, z: 0, visibility: 0.1 };
    points[POSE_LANDMARK.RIGHT_SHOULDER] = { x: 0, y: 0, z: 0 };
    points[POSE_LANDMARK.RIGHT_ELBOW] = { x: -1, y: 0, z: 0 };
    points[POSE_LANDMARK.RIGHT_WRIST] = { x: -2, y: 0, z: 0 };
    const frames = [
      { timestampMs: 0, worldLandmarks: points },
      { timestampMs: FRAME_INTERVAL_MS, worldLandmarks: points },
    ];
    // The right arm alone has a full valid sample set, but with no left
    // data at all there's nothing to compare it against.
    expect(computeArmSwingSymmetry(frames)).toBeNull();
  });

  it("excludes only the low-visibility frames, one arm at a time", () => {
    const visibleFrame: PoseFrame = {
      timestampMs: 0,
      worldLandmarks: (() => {
        const points = neutralWorldLandmarks();
        points[POSE_LANDMARK.LEFT_SHOULDER] = { x: 0, y: 0, z: 0 };
        points[POSE_LANDMARK.LEFT_ELBOW] = { x: 1, y: 0, z: 0 };
        points[POSE_LANDMARK.LEFT_WRIST] = { x: 2, y: 0, z: 0 }; // 180deg (straight)
        points[POSE_LANDMARK.RIGHT_SHOULDER] = { x: 0, y: 0, z: 0 };
        points[POSE_LANDMARK.RIGHT_ELBOW] = { x: -1, y: 0, z: 0 };
        points[POSE_LANDMARK.RIGHT_WRIST] = { x: -2, y: 0, z: 0 }; // 180deg (straight)
        return points;
      })(),
    };
    const leftOccludedFrame: PoseFrame = {
      timestampMs: FRAME_INTERVAL_MS,
      worldLandmarks: (() => {
        const points = neutralWorldLandmarks();
        // Left arm bent to 90deg but marked low-visibility -> should not
        // count toward the left arm's range of motion.
        points[POSE_LANDMARK.LEFT_SHOULDER] = { x: 0, y: 0, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.LEFT_ELBOW] = { x: 1, y: 0, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.LEFT_WRIST] = { x: 1, y: 1, z: 0, visibility: 0.1 };
        // Right arm bent to 90deg and fully visible -> counts normally.
        points[POSE_LANDMARK.RIGHT_SHOULDER] = { x: 0, y: 0, z: 0 };
        points[POSE_LANDMARK.RIGHT_ELBOW] = { x: -1, y: 0, z: 0 };
        points[POSE_LANDMARK.RIGHT_WRIST] = { x: -1, y: 1, z: 0 };
        return points;
      })(),
    };

    const result = computeArmSwingSymmetry([visibleFrame, leftOccludedFrame]);
    expect(result).not.toBeNull();
    // Left only ever got one valid (unoccluded) sample -> zero range.
    expect(result!.leftSampleCount).toBe(1);
    expect(result!.leftRangeOfMotionDegrees).toBe(0);
    // Right got both samples -> a real range (180 -> 90 = 90deg).
    expect(result!.rightSampleCount).toBe(2);
    expect(result!.rightRangeOfMotionDegrees).toBeCloseTo(90, 6);
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

  it("excludes strikes where the heel or toe has low visibility", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HEEL] = { x: -0.1, y: 0.95, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.LEFT_FOOT_INDEX] = { x: -0.1, y: 0.9, z: 0.1, visibility: 0.1 };
        points[POSE_LANDMARK.RIGHT_HEEL] = { x: 0.1, y: 0.95, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.RIGHT_FOOT_INDEX] = { x: 0.1, y: 0.9, z: 0.1, visibility: 0.1 };
      },
    });
    expect(computeLandingForm(session, "full")).toBeNull();
  });
});

// Matches strides.ts's DEFAULT_TOE_OFF_DROP_RATIO — for a cosine ankle-
// height signal, the drop-ratio crossing happens at a theta with
// cos(theta) = 1 - 2*dropRatio, independent of amplitude/offset (see
// strides.test.ts for the full derivation this mirrors).
const TOE_OFF_DROP_RATIO = 0.3;
function expectedToeOffOffsetMs(periodMs: number): number {
  const theta = Math.acos(1 - 2 * TOE_OFF_DROP_RATIO);
  return (theta * periodMs) / (2 * Math.PI);
}

describe("computeGroundContactTime", () => {
  const periodMs = 600;
  const session = buildStrideSession({ durationMs: 3000, periodMs, leftPhaseMs: 150, rightPhaseMs: 450 });

  it("matches the theoretical footstrike-to-toe-off offset", () => {
    const result = computeGroundContactTime(session, "full");
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(10);
    expect(result!.confidence).toBe("full");

    const expectedMs = expectedToeOffOffsetMs(periodMs);
    expect(result!.groundContactMs).toBeGreaterThan(expectedMs - 50);
    expect(result!.groundContactMs).toBeLessThan(expectedMs + 50);
  });

  it("mirrors the fps tier's confidence when not blocked", () => {
    expect(computeGroundContactTime(session, "reduced")!.confidence).toBe("reduced");
  });

  it("returns null at the blocked fps tier regardless of data", () => {
    expect(computeGroundContactTime(session, "blocked")).toBeNull();
  });

  it("excludes strides where the ankle has low visibility", () => {
    const lowVisSession = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_ANKLE] = { ...points[POSE_LANDMARK.LEFT_ANKLE], visibility: 0.1 };
        points[POSE_LANDMARK.RIGHT_ANKLE] = { ...points[POSE_LANDMARK.RIGHT_ANKLE], visibility: 0.1 };
      },
    });
    expect(computeGroundContactTime(lowVisSession, "full")).toBeNull();
  });

  it("returns null with no detected strides", () => {
    expect(computeGroundContactTime([], "full")).toBeNull();
  });
});

describe("computeFlightTime", () => {
  const periodMs = 600;
  const session = buildStrideSession({ durationMs: 3000, periodMs, leftPhaseMs: 150, rightPhaseMs: 450 });

  it("matches the theoretical toe-off-to-next-footstrike offset", () => {
    const result = computeFlightTime(session, "full");
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("full");

    // Combined footstrike stream alternates every half period; flight
    // time is whatever's left of that half period after ground contact.
    const expectedMs = periodMs / 2 - expectedToeOffOffsetMs(periodMs);
    expect(result!.flightMs).toBeGreaterThan(expectedMs - 50);
    expect(result!.flightMs).toBeLessThan(expectedMs + 50);
  });

  it("returns null at the blocked fps tier regardless of data", () => {
    expect(computeFlightTime(session, "blocked")).toBeNull();
  });

  it("returns null with no detected strides", () => {
    expect(computeFlightTime([], "full")).toBeNull();
  });
});

describe("computeStrideDiagnostics", () => {
  it("returns one row per stride, chronologically, with null interval only for the first", () => {
    const session = buildStrideSession({ durationMs: 3000, periodMs: 600, leftPhaseMs: 150, rightPhaseMs: 450 });
    const rows = computeStrideDiagnostics(session);

    expect(rows).toHaveLength(10);
    expect(rows[0].intervalFromPreviousMs).toBeNull();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].intervalFromPreviousMs).not.toBeNull();
      expect(rows[i].intervalFromPreviousMs).toBeCloseTo(
        rows[i].timestampMs - rows[i - 1].timestampMs,
        6
      );
      // Chronological, matching computeCadence's own ordering assumption.
      expect(rows[i].timestampMs).toBeGreaterThanOrEqual(rows[i - 1].timestampMs);
    }
  });

  it("reports ground contact time consistent with the strike/toe-off timestamps", () => {
    const session = buildStrideSession({});
    const rows = computeStrideDiagnostics(session);
    for (const row of rows) {
      if (row.toeOffTimestampMs === null) {
        expect(row.groundContactMs).toBeNull();
      } else {
        expect(row.groundContactMs).toBeCloseTo(row.toeOffTimestampMs - row.timestampMs, 6);
      }
    }
  });

  it("matches computeLandingForm's classification for a known heel strike", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HEEL] = { x: -0.1, y: 0.95, z: 0 };
        points[POSE_LANDMARK.LEFT_FOOT_INDEX] = { x: -0.1, y: 0.9, z: 0.1 };
        points[POSE_LANDMARK.RIGHT_HEEL] = { x: 0.1, y: 0.95, z: 0 };
        points[POSE_LANDMARK.RIGHT_FOOT_INDEX] = { x: 0.1, y: 0.9, z: 0.1 };
      },
    });
    const rows = computeStrideDiagnostics(session);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.landingFormPattern).toBe("heel");
      expect(row.heelToeDeltaM).toBeCloseTo(0.05, 6);
      expect(row.heelY).toBeCloseTo(0.95, 6);
      expect(row.toeY).toBeCloseTo(0.9, 6);
    }
  });

  it("leaves heel/toe fields null when the landmarks have low visibility", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HEEL] = { x: -0.1, y: 0.95, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.LEFT_FOOT_INDEX] = { x: -0.1, y: 0.9, z: 0.1, visibility: 0.1 };
        points[POSE_LANDMARK.RIGHT_HEEL] = { x: 0.1, y: 0.95, z: 0, visibility: 0.1 };
        points[POSE_LANDMARK.RIGHT_FOOT_INDEX] = { x: 0.1, y: 0.9, z: 0.1, visibility: 0.1 };
      },
    });
    const rows = computeStrideDiagnostics(session);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.heelY).toBeNull();
      expect(row.toeY).toBeNull();
      expect(row.heelToeDeltaM).toBeNull();
      expect(row.landingFormPattern).toBeNull();
    }
  });

  it("returns an empty array with no detected strides", () => {
    expect(computeStrideDiagnostics([])).toEqual([]);
  });
});

describe("computeMetrics", () => {
  it("computes every metric together for a full synthetic session", () => {
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
    expect(result.groundContactTime).not.toBeNull();
    expect(result.groundContactTime!.confidence).toBe("full");
    expect(result.flightTime).not.toBeNull();
    expect(result.cameraAngle).toBe("front-or-rear");
  });

  it("omits landing form, ground contact time, and flight time when the fps tier is blocked", () => {
    const session = buildStrideSession({});
    const result = computeMetrics(session, "blocked");
    expect(result.landingForm).toBeNull();
    expect(result.groundContactTime).toBeNull();
    expect(result.flightTime).toBeNull();
  });

  it("omits hip drop and surfaces the inferred angle for side-view footage", () => {
    const session = buildStrideSession({
      augment: (points) => {
        points[POSE_LANDMARK.LEFT_HIP] = { x: 0, y: 0.02, z: -0.1 };
        points[POSE_LANDMARK.RIGHT_HIP] = { x: 0, y: 0, z: 0.1 };
      },
    });
    const result = computeMetrics(session, "full");
    expect(result.cameraAngle).toBe("side");
    expect(result.hipDrop).toBeNull();
    // Side view doesn't affect the other metrics.
    expect(result.cadence).not.toBeNull();
  });
});
