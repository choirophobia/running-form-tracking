import { describe, expect, it } from "vitest";
import { angleAtVertex, average, distance, magnitude } from "./geometry";

describe("angleAtVertex", () => {
  it("returns 90 for a right angle", () => {
    expect(angleAtVertex({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90, 6);
  });

  it("returns 180 for a straight line", () => {
    expect(angleAtVertex({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(180, 6);
  });

  it("returns 0 when both rays point the same direction", () => {
    expect(angleAtVertex({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBeCloseTo(0, 6);
  });

  it("returns 60 for a known equilateral-triangle vertex angle", () => {
    const a = { x: 1, y: 0, z: 0 };
    const vertex = { x: 0, y: 0, z: 0 };
    const c = { x: 0.5, y: Math.sqrt(3) / 2, z: 0 };
    expect(angleAtVertex(a, vertex, c)).toBeCloseTo(60, 6);
  });

  it("returns 120 for a known reference angle", () => {
    const a = { x: 1, y: 0, z: 0 };
    const vertex = { x: 0, y: 0, z: 0 };
    const c = { x: -0.5, y: Math.sqrt(3) / 2, z: 0 };
    expect(angleAtVertex(a, vertex, c)).toBeCloseTo(120, 6);
  });

  it("returns 0 (not NaN) when a ray is degenerate", () => {
    const vertex = { x: 0, y: 0, z: 0 };
    expect(angleAtVertex(vertex, vertex, { x: 1, y: 0, z: 0 })).toBe(0);
  });

  it("is not sensitive to ray length, only direction", () => {
    const vertex = { x: 0, y: 0, z: 0 };
    const a = { x: 1, y: 0, z: 0 };
    const shortC = { x: 0, y: 0.01, z: 0 };
    const longC = { x: 0, y: 100, z: 0 };
    expect(angleAtVertex(a, vertex, shortC)).toBeCloseTo(angleAtVertex(a, vertex, longC), 6);
  });
});

describe("distance", () => {
  it("matches a known 3-4-5 right triangle", () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBeCloseTo(5, 6);
  });

  it("is zero for coincident points", () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(distance(p, p)).toBe(0);
  });
});

describe("magnitude", () => {
  it("matches a known 3-4-5 vector length", () => {
    expect(magnitude({ x: 3, y: 4, z: 0 })).toBeCloseTo(5, 6);
  });
});

describe("average", () => {
  it("averages a known set of values", () => {
    expect(average([1, 2, 3, 4])).toBeCloseTo(2.5, 6);
  });

  it("returns 0 for an empty array rather than NaN", () => {
    expect(average([])).toBe(0);
  });
});
