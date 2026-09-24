import { describe, expect, it } from "vitest";
import { parseCreateAnalysisInput } from "./analyses";

describe("parseCreateAnalysisInput", () => {
  it("accepts a fully populated valid body", () => {
    const body = {
      video_fps: 120,
      video_storage_path: "videos/abc.mp4",
      score: 82.5,
      cadence: 178,
      vertical_oscillation: 7.2,
      overstride: 12.1,
      hip_drop: 4.6,
      arm_swing_symmetry: 91,
      landing_form: "heel",
      landing_form_confidence: "full",
      flags: ["overstride"],
    };
    const result = parseCreateAnalysisInput(body);
    expect(result).toEqual(body);
  });

  it("accepts an empty object (every field optional)", () => {
    expect(parseCreateAnalysisInput({})).toEqual({});
  });

  it("accepts explicit nulls for metrics that returned 'not enough data'", () => {
    const result = parseCreateAnalysisInput({ cadence: null, landing_form_confidence: null });
    expect(result).toEqual({ cadence: null, landing_form_confidence: null });
  });

  it("rejects a non-object body", () => {
    expect(parseCreateAnalysisInput("nope")).toEqual({
      error: "Request body must be a JSON object.",
    });
    expect(parseCreateAnalysisInput(null)).toEqual({
      error: "Request body must be a JSON object.",
    });
    expect(parseCreateAnalysisInput([1, 2])).toEqual({
      error: "Request body must be a JSON object.",
    });
  });

  it("rejects a non-numeric value for a numeric field", () => {
    const result = parseCreateAnalysisInput({ cadence: "fast" });
    expect(result).toEqual({ error: '"cadence" must be a number or null.' });
  });

  it("rejects an invalid landing_form_confidence value", () => {
    const result = parseCreateAnalysisInput({ landing_form_confidence: "sort-of" });
    expect(result).toEqual({
      error: '"landing_form_confidence" must be one of full, reduced, unavailable, or null.',
    });
  });

  it("rejects a flags array with non-string entries", () => {
    const result = parseCreateAnalysisInput({ flags: ["overstride", 42] });
    expect(result).toEqual({ error: '"flags" must be an array of strings.' });
  });

  it("rejects a non-array flags value", () => {
    const result = parseCreateAnalysisInput({ flags: "overstride" });
    expect(result).toEqual({ error: '"flags" must be an array of strings.' });
  });

  it("ignores unknown fields rather than rejecting them", () => {
    const result = parseCreateAnalysisInput({ cadence: 170, unknown_field: "whatever" });
    expect(result).toEqual({ cadence: 170 });
  });
});
