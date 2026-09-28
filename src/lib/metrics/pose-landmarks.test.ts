import { describe, expect, it } from "vitest";
import { allVisible, isVisible, landmark, MIN_LANDMARK_VISIBILITY, type PoseFrame } from "./pose-landmarks";

describe("isVisible", () => {
  it("treats a landmark with no visibility field as visible", () => {
    expect(isVisible({ x: 0, y: 0, z: 0 })).toBe(true);
  });

  it("treats a landmark at or above the threshold as visible", () => {
    expect(isVisible({ x: 0, y: 0, z: 0, visibility: MIN_LANDMARK_VISIBILITY })).toBe(true);
    expect(isVisible({ x: 0, y: 0, z: 0, visibility: 1 })).toBe(true);
  });

  it("treats a landmark below the threshold as not visible", () => {
    expect(isVisible({ x: 0, y: 0, z: 0, visibility: MIN_LANDMARK_VISIBILITY - 0.01 })).toBe(false);
    expect(isVisible({ x: 0, y: 0, z: 0, visibility: 0 })).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isVisible({ x: 0, y: 0, z: 0, visibility: 0.3 }, 0.2)).toBe(true);
    expect(isVisible({ x: 0, y: 0, z: 0, visibility: 0.3 }, 0.4)).toBe(false);
  });
});

describe("allVisible", () => {
  it("is true only when every landmark passes", () => {
    const visible = { x: 0, y: 0, z: 0, visibility: 0.9 };
    const notVisible = { x: 0, y: 0, z: 0, visibility: 0.1 };
    expect(allVisible([visible, visible])).toBe(true);
    expect(allVisible([visible, notVisible])).toBe(false);
    expect(allVisible([])).toBe(true);
  });
});

describe("landmark", () => {
  it("throws on a missing index rather than returning undefined silently", () => {
    const frame: PoseFrame = { timestampMs: 0, worldLandmarks: [] };
    expect(() => landmark(frame, 23)).toThrow(/missing landmark index 23/);
  });
});
