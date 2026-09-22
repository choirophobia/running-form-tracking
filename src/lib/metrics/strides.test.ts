import { describe, expect, it } from "vitest";
import { detectAllFootstrikes, detectFootstrikes, findPeaks } from "./strides";
import { POSE_LANDMARK, type PoseFrame } from "./pose-landmarks";
import type { Vec3 } from "./geometry";

describe("findPeaks", () => {
  it("finds a single obvious peak", () => {
    expect(findPeaks([0, 1, 3, 5, 3, 1, 0], 1)).toEqual([3]);
  });

  it("finds two well-separated peaks", () => {
    expect(findPeaks([0, 5, 0, 0, 6, 0], 1)).toEqual([1, 4]);
  });

  it("keeps only the taller of two peaks within minSeparation", () => {
    // indices 1 (5) and 3 (6) are 2 apart; minSeparation 3 should drop the
    // shorter one.
    expect(findPeaks([0, 5, 4, 6, 0], 3)).toEqual([3]);
  });

  it("returns nothing for a flat signal", () => {
    expect(findPeaks([2, 2, 2, 2, 2], 1)).toEqual([]);
  });

  it("returns nothing for fewer than 3 samples", () => {
    expect(findPeaks([1, 2], 1)).toEqual([]);
  });

  it("filters out low-prominence noise below the threshold", () => {
    const values = [0, 10, 0, 0.5, 0.6, 0.4, 0];
    expect(findPeaks(values, 1, 0.5)).toEqual([1]);
  });
});

const FRAME_INTERVAL_MS = 1000 / 30;
const TIMESTAMP_TOLERANCE_MS = 50; // ~1.5 frame intervals of grid quantization

function neutralWorldLandmarks(): Vec3[] {
  const points: Vec3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  points[POSE_LANDMARK.LEFT_HIP] = { x: -0.1, y: 0, z: 0 };
  points[POSE_LANDMARK.RIGHT_HIP] = { x: 0.1, y: 0, z: 0 };
  points[POSE_LANDMARK.LEFT_ANKLE] = { x: -0.1, y: 0.9, z: 0 };
  points[POSE_LANDMARK.RIGHT_ANKLE] = { x: 0.1, y: 0.9, z: 0 };
  return points;
}

/**
 * Builds a synthetic session where each foot's height-above-hip follows a
 * clean cosine with known peak times — the footstrike "known reference"
 * this module is checked against. Hips are held fixed, so ankle-relative-
 * to-hip height is just the ankle's y value.
 */
function buildSyntheticStrideSession(options: {
  durationMs: number;
  periodMs: number;
  leftPhaseMs: number;
  rightPhaseMs: number;
}): PoseFrame[] {
  const { durationMs, periodMs, leftPhaseMs, rightPhaseMs } = options;
  const frames: PoseFrame[] = [];
  for (let t = 0; t <= durationMs; t += FRAME_INTERVAL_MS) {
    const points = neutralWorldLandmarks();
    const leftY = 0.9 + 0.05 * Math.cos((2 * Math.PI * (t - leftPhaseMs)) / periodMs);
    const rightY = 0.9 + 0.05 * Math.cos((2 * Math.PI * (t - rightPhaseMs)) / periodMs);
    points[POSE_LANDMARK.LEFT_ANKLE] = { x: -0.1, y: leftY, z: 0 };
    points[POSE_LANDMARK.RIGHT_ANKLE] = { x: 0.1, y: rightY, z: 0 };
    frames.push({ timestampMs: t, worldLandmarks: points });
  }
  return frames;
}

function expectTimestampsNear(actual: number[], expected: number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => {
    expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(TIMESTAMP_TOLERANCE_MS);
  });
}

describe("detectFootstrikes", () => {
  // Left foot peaks (footstrikes) at 150, 750, 1350, 1950, 2550ms; right
  // foot offset by half a period (300ms), matching real alternating gait.
  const session = buildSyntheticStrideSession({
    durationMs: 3000,
    periodMs: 600,
    leftPhaseMs: 150,
    rightPhaseMs: 450,
  });

  it("finds left footstrikes near the known synthetic peak times", () => {
    const strikes = detectFootstrikes(session, "left");
    expectTimestampsNear(
      strikes.map((s) => s.timestampMs),
      [150, 750, 1350, 1950, 2550]
    );
    expect(strikes.every((s) => s.side === "left")).toBe(true);
  });

  it("finds right footstrikes near the known synthetic peak times", () => {
    const strikes = detectFootstrikes(session, "right");
    expectTimestampsNear(
      strikes.map((s) => s.timestampMs),
      [450, 1050, 1650, 2250, 2850]
    );
  });

  it("returns nothing for too few frames", () => {
    expect(detectFootstrikes(session.slice(0, 2), "left")).toEqual([]);
  });
});

describe("detectAllFootstrikes", () => {
  it("merges both feet in chronological order", () => {
    const session = buildSyntheticStrideSession({
      durationMs: 3000,
      periodMs: 600,
      leftPhaseMs: 150,
      rightPhaseMs: 450,
    });
    const all = detectAllFootstrikes(session);

    expect(all).toHaveLength(10);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].timestampMs).toBeGreaterThanOrEqual(all[i - 1].timestampMs);
    }
    // Real running alternates feet — confirm the merged stream does too.
    for (let i = 1; i < all.length; i++) {
      expect(all[i].side).not.toBe(all[i - 1].side);
    }
  });
});
