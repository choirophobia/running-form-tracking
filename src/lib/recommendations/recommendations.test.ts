import { describe, expect, it } from "vitest";
import type { MetricsResult } from "@/lib/metrics";
import rawTable from "@/data/recommendations.json";
import { flagMetrics, METRIC_IDS, parseRecommendationTable, RECOMMENDATIONS } from "./index";

const EMPTY: MetricsResult = {
  cadence: null,
  verticalOscillation: null,
  overstride: null,
  hipDrop: null,
  armSwingSymmetry: null,
  landingForm: null,
  groundContactTime: null,
  flightTime: null,
  cameraAngle: "front-or-rear",
};

function withHipDrop(degrees: number): MetricsResult {
  return { ...EMPTY, hipDrop: { hipDropDegrees: degrees, sampleCount: 6, samples: [degrees] } };
}

describe("recommendations table", () => {
  it("has exactly one entry per metric", () => {
    expect(Object.keys(RECOMMENDATIONS).sort()).toEqual([...METRIC_IDS].sort());
  });

  it("gives every flagged metric a cited recommendation, and every other metric a reason", () => {
    for (const id of METRIC_IDS) {
      const entry = RECOMMENDATIONS[id];
      if (entry.flag) {
        expect(entry.recommendation.citations.length).toBeGreaterThan(0);
        for (const c of entry.recommendation.citations) expect(c.doi).toMatch(/^10\.\d{4,}\//);
        expect(entry.recommendation.video.url).toMatch(/^https:\/\//);
      } else {
        expect(entry.notJudgedReason.length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects a flagged entry with no citations", () => {
    const broken = structuredClone(rawTable) as Record<string, { recommendation?: { citations: unknown[] } }>;
    broken.hip_drop.recommendation!.citations = [];
    expect(() => parseRecommendationTable(broken)).toThrow(/hip_drop/);
  });

  it("rejects a table missing a metric", () => {
    const broken = structuredClone(rawTable) as Record<string, unknown>;
    delete broken.cadence;
    expect(() => parseRecommendationTable(broken)).toThrow(/cadence/);
  });
});

describe("flagMetrics", () => {
  it("flags nothing when there's no data", () => {
    expect(flagMetrics(EMPTY)).toEqual([]);
  });

  it("flags hip drop at the 8.4° cutoff, not below it", () => {
    expect(flagMetrics(withHipDrop(8.39))).toEqual([]);
    expect(flagMetrics(withHipDrop(8.4))).toEqual(["hip_drop"]);
    expect(flagMetrics(withHipDrop(12))).toEqual(["hip_drop"]);
  });

  it("never flags metrics without a research cutoff, however extreme", () => {
    const extreme: MetricsResult = {
      ...EMPTY,
      cadence: { stepsPerMinute: 120, perStrideStepsPerMinute: [120] },
      overstride: { overstrideCm: 40, sampleCount: 6, signed: true, overstridePercentLegLength: 45 },
      armSwingSymmetry: { symmetryScore: 10, leftSampleCount: 5, rightSampleCount: 5, perStrideSymmetryScores: [10] },
    } as MetricsResult;
    expect(flagMetrics(extreme)).toEqual([]);
  });
});
