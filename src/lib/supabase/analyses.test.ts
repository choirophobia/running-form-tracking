import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, parseCreateAnalysisInput, parsePaginationParams } from "./analyses";

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
      ground_contact_time: 240,
      flight_time: 110,
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

  it("rejects physically-impossible values instead of silently persisting them", () => {
    expect(parseCreateAnalysisInput({ cadence: -5 })).toEqual({
      error: '"cadence" must be between 1 and 400 (got -5).',
    });
    expect(parseCreateAnalysisInput({ cadence: 5000 })).toEqual({
      error: '"cadence" must be between 1 and 400 (got 5000).',
    });
    expect(parseCreateAnalysisInput({ hip_drop: 91 })).toEqual({
      error: '"hip_drop" must be between 0 and 90 (got 91).',
    });
    expect(parseCreateAnalysisInput({ arm_swing_symmetry: 101 })).toEqual({
      error: '"arm_swing_symmetry" must be between 0 and 100 (got 101).',
    });
    expect(parseCreateAnalysisInput({ ground_contact_time: 2500 })).toEqual({
      error: '"ground_contact_time" must be between 0 and 2000 (got 2500).',
    });
    expect(parseCreateAnalysisInput({ flight_time: -1 })).toEqual({
      error: '"flight_time" must be between 0 and 2000 (got -1).',
    });
    expect(parseCreateAnalysisInput({ video_fps: 0 })).toEqual({
      error: '"video_fps" must be between 0.1 and 1000 (got 0).',
    });
  });

  it("accepts a signed overstride value within its symmetric bound", () => {
    expect(parseCreateAnalysisInput({ overstride: -15.3 })).toEqual({ overstride: -15.3 });
  });

  it("leaves the unbounded score field alone (its scale isn't decided yet)", () => {
    expect(parseCreateAnalysisInput({ score: 99999 })).toEqual({ score: 99999 });
  });

  it("still allows null even for fields with numeric bounds", () => {
    expect(parseCreateAnalysisInput({ cadence: null, hip_drop: null })).toEqual({
      cadence: null,
      hip_drop: null,
    });
  });
});

describe("parsePaginationParams", () => {
  it("defaults to the standard limit and zero offset with no query params", () => {
    expect(parsePaginationParams(new URLSearchParams())).toEqual({
      limit: DEFAULT_LIST_LIMIT,
      offset: 0,
    });
  });

  it("accepts explicit valid limit and offset", () => {
    expect(parsePaginationParams(new URLSearchParams("limit=10&offset=20"))).toEqual({
      limit: 10,
      offset: 20,
    });
  });

  it("accepts the maximum allowed limit", () => {
    expect(parsePaginationParams(new URLSearchParams(`limit=${MAX_LIST_LIMIT}`))).toEqual({
      limit: MAX_LIST_LIMIT,
      offset: 0,
    });
  });

  it("rejects a limit above the maximum instead of returning everything", () => {
    const result = parsePaginationParams(new URLSearchParams(`limit=${MAX_LIST_LIMIT + 1}`));
    expect(result).toEqual({
      error: `"limit" must be an integer between 1 and ${MAX_LIST_LIMIT}.`,
    });
  });

  it("rejects a zero or negative limit", () => {
    expect(parsePaginationParams(new URLSearchParams("limit=0"))).toEqual({
      error: `"limit" must be an integer between 1 and ${MAX_LIST_LIMIT}.`,
    });
    expect(parsePaginationParams(new URLSearchParams("limit=-5"))).toEqual({
      error: `"limit" must be an integer between 1 and ${MAX_LIST_LIMIT}.`,
    });
  });

  it("rejects a non-integer limit", () => {
    expect(parsePaginationParams(new URLSearchParams("limit=10.5"))).toEqual({
      error: `"limit" must be an integer between 1 and ${MAX_LIST_LIMIT}.`,
    });
    expect(parsePaginationParams(new URLSearchParams("limit=abc"))).toEqual({
      error: `"limit" must be an integer between 1 and ${MAX_LIST_LIMIT}.`,
    });
  });

  it("rejects a negative offset", () => {
    expect(parsePaginationParams(new URLSearchParams("offset=-1"))).toEqual({
      error: '"offset" must be a non-negative integer.',
    });
  });

  it("accepts a zero offset explicitly", () => {
    expect(parsePaginationParams(new URLSearchParams("offset=0"))).toEqual({
      limit: DEFAULT_LIST_LIMIT,
      offset: 0,
    });
  });
});
