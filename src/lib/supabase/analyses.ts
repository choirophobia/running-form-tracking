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
] as const;

const NULLABLE_STRING_FIELDS = ["video_storage_path", "landing_form"] as const;

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
