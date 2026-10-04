import { describe, expect, it } from "vitest";
import type { MetricsResult } from "@/lib/metrics";
import { parseCreateAnalysisInput } from "@/lib/supabase/analyses";
import { toAnalysisInput } from "./to-analysis-input";

const EMPTY: MetricsResult = {
  cadence: null,
  verticalOscillation: null,
  overstride: null,
  hipDrop: null,
  armSwingSymmetry: null,
  landingForm: null,
  groundContactTime: null,
  flightTime: null,
  cameraAngle: "side",
};

describe("toAnalysisInput", () => {
  it("keeps 'not enough data' as null rather than zero", () => {
    expect(toAnalysisInput(EMPTY, 120)).toEqual({
      video_fps: 120,
      cadence: null,
      vertical_oscillation: null,
      overstride: null,
      hip_drop: null,
      arm_swing_symmetry: null,
      ground_contact_time: null,
      flight_time: null,
      landing_form: null,
      landing_form_confidence: "unavailable",
      flags: [],
    });
  });

  it("maps every headline value and passes the API's own validation", () => {
    const metrics = {
      ...EMPTY,
      cadence: { stepsPerMinute: 176.4, perStrideStepsPerMinute: [175, 178] },
      verticalOscillation: { oscillationCm: 7.8, oscillationPercentLegLength: 9.1 },
      overstride: { overstrideCm: -3.2, sampleCount: 6, signed: true, overstridePercentLegLength: 3.7 },
      hipDrop: { hipDropDegrees: 5.1, samples: [5, 5.2] },
      armSwingSymmetry: { symmetryScore: 88, perStrideSymmetryScores: [86, 90] },
      landingForm: { pattern: "midfoot", confidence: "reduced", sampleCount: 6 },
      groundContactTime: { groundContactMs: 245, confidence: "reduced" },
      flightTime: { flightMs: 105, confidence: "reduced" },
    } as unknown as MetricsResult;

    const input = toAnalysisInput(metrics, 90);
    expect(input).toMatchObject({
      video_fps: 90,
      cadence: 176.4,
      vertical_oscillation: 7.8,
      overstride: -3.2,
      hip_drop: 5.1,
      arm_swing_symmetry: 88,
      ground_contact_time: 245,
      flight_time: 105,
      landing_form: "midfoot",
      landing_form_confidence: "reduced",
    });
    expect(input).not.toHaveProperty("score");
    expect(parseCreateAnalysisInput(input)).toEqual(input);
  });
});
