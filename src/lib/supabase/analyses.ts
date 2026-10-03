// Batch 4: the `analyses` row shape, matching the migration in
// supabase/migrations/. Validation is hand-rolled rather than pulling in a
// schema library — the shape is small, fixed, and doesn't need one.

export const LANDING_FORM_CONFIDENCE_VALUES = ["full", "reduced", "unavailable"] as const;
export type LandingFormConfidence = (typeof LANDING_FORM_CONFIDENCE_VALUES)[number];

export interface AnalysisRow {
  id: string;
  user_id: string;
  recorded_at: string;
  video_fps: number | null;
  video_storage_path: string | null;
  score: number | null;
  cadence: number | null;
  vertical_oscillation: number | null;
  overstride: number | null;
  hip_drop: number | null;
  arm_swing_symmetry: number | null;
  /** Milliseconds — added in Batch 6's migration, see supabase/migrations/. */
  ground_contact_time: number | null;
  /** Milliseconds — added in Batch 6's migration, see supabase/migrations/. */
  flight_time: number | null;
  landing_form: string | null;
  landing_form_confidence: LandingFormConfidence | null;
  flags: string[];
  created_at: string;
}

export type CreateAnalysisInput = Partial<
  Pick<
    AnalysisRow,
    | "video_fps"
    | "video_storage_path"
    | "score"
    | "cadence"
    | "vertical_oscillation"
    | "overstride"
    | "hip_drop"
    | "arm_swing_symmetry"
    | "ground_contact_time"
    | "flight_time"
    | "landing_form"
    | "landing_form_confidence"
    | "flags"
  >
>;

const NULLABLE_NUMBER_FIELDS = [
  "video_fps",
  "score",
  "cadence",
  "vertical_oscillation",
  "overstride",
  "hip_drop",
  "arm_swing_symmetry",
  "ground_contact_time",
  "flight_time",
] as const;

const NULLABLE_STRING_FIELDS = ["video_storage_path", "landing_form"] as const;

/**
 * Physically-plausible bounds per numeric field — catches obviously
 * corrupt data (negative cadence, a fps of 50000) before it's persisted,
 * without being so tight it rejects legitimate extreme values. `score`
 * (the composite efficiency score) is deliberately unbounded: its scale
 * isn't decided yet (PRD Section 12 open decision), so any bound here
 * would just be a guess.
 */
const NUMBER_FIELD_BOUNDS: Partial<
  Record<(typeof NULLABLE_NUMBER_FIELDS)[number], { min: number; max: number }>
> = {
  video_fps: { min: 0.1, max: 1000 },
  cadence: { min: 1, max: 400 },
  vertical_oscillation: { min: 0, max: 50 },
  // Signed since the camera-angle enhancement (ahead of/behind center of
  // mass) — generous symmetric bound either direction.
  overstride: { min: -100, max: 100 },
  hip_drop: { min: 0, max: 90 }, // pelvis tilt can't physically exceed 90deg
  arm_swing_symmetry: { min: 0, max: 100 }, // matches computeArmSwingSymmetry's own 0-100 scale
  // Milliseconds. A whole stride cycle is well under 2s even when walking,
  // so either phase alone can't plausibly exceed that.
  ground_contact_time: { min: 0, max: 2000 },
  flight_time: { min: 0, max: 2000 },
};

function isNullableNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === "number";
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

/**
 * Validates an untyped request body into a CreateAnalysisInput, or returns
 * a human-readable error string. Every field is optional/nullable — a
 * caller can submit only the metrics it managed to compute (see the `null`
 * results from src/lib/metrics for "not enough data").
 */
export function parseCreateAnalysisInput(body: unknown): CreateAnalysisInput | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  for (const field of NULLABLE_NUMBER_FIELDS) {
    if (!isNullableNumber(b[field])) {
      return { error: `"${field}" must be a number or null.` };
    }
    const value = b[field];
    const bounds = NUMBER_FIELD_BOUNDS[field];
    if (bounds && typeof value === "number" && (value < bounds.min || value > bounds.max)) {
      return {
        error: `"${field}" must be between ${bounds.min} and ${bounds.max} (got ${value}).`,
      };
    }
  }
  for (const field of NULLABLE_STRING_FIELDS) {
    if (!isNullableString(b[field])) {
      return { error: `"${field}" must be a string or null.` };
    }
  }
  if (
    b.landing_form_confidence !== undefined &&
    b.landing_form_confidence !== null &&
    !LANDING_FORM_CONFIDENCE_VALUES.includes(b.landing_form_confidence as LandingFormConfidence)
  ) {
    return {
      error: `"landing_form_confidence" must be one of ${LANDING_FORM_CONFIDENCE_VALUES.join(", ")}, or null.`,
    };
  }
  if (b.flags !== undefined && (!Array.isArray(b.flags) || !b.flags.every((f) => typeof f === "string"))) {
    return { error: `"flags" must be an array of strings.` };
  }

  const input: CreateAnalysisInput = {};
  for (const field of NULLABLE_NUMBER_FIELDS) {
    if (b[field] !== undefined) input[field] = b[field] as number | null;
  }
  for (const field of NULLABLE_STRING_FIELDS) {
    if (b[field] !== undefined) input[field] = b[field] as string | null;
  }
  if (b.landing_form_confidence !== undefined) {
    input.landing_form_confidence = b.landing_form_confidence as LandingFormConfidence | null;
  }
  if (b.flags !== undefined) {
    input.flags = b.flags as string[];
  }

  return input;
}

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Parses `?limit=&offset=` for `GET /api/analyses`, applying a default and
 * a hard ceiling so a caller can't request an unbounded page (the query
 * previously had no limit at all — fine while every user has a handful of
 * rows, not once someone actually has a real history).
 */
export function parsePaginationParams(
  searchParams: URLSearchParams
): PaginationParams | { error: string } {
  let limit = DEFAULT_LIST_LIMIT;
  const limitParam = searchParams.get("limit");
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIST_LIMIT) {
      return { error: `"limit" must be an integer between 1 and ${MAX_LIST_LIMIT}.` };
    }
    limit = parsed;
  }

  let offset = 0;
  const offsetParam = searchParams.get("offset");
  if (offsetParam !== null) {
    const parsed = Number(offsetParam);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: `"offset" must be a non-negative integer.` };
    }
    offset = parsed;
  }

  return { limit, offset };
}
