import type { MetricsResult } from "@/lib/metrics";
import type { CreateAnalysisInput } from "@/lib/supabase/analyses";

// Batch 6: maps one computed report (Batch 3's MetricsResult) onto the
// `POST /api/analyses` body. Pure and framework-free so it's unit-testable
// like the rest of src/lib.
//
// Only headline numbers are persisted — per-stride arrays (strip plots),
// the camera-angle guess, and leg-length percentages aren't in the schema,
// so a saved report shows less than the live one. `null` ("not enough
// data") is preserved as null, never coerced to 0.

export function toAnalysisInput(metrics: MetricsResult, videoFps: number | null): CreateAnalysisInput {
  return {
    video_fps: videoFps,
    cadence: metrics.cadence?.stepsPerMinute ?? null,
    vertical_oscillation: metrics.verticalOscillation?.oscillationCm ?? null,
    // Signed when a travel direction was found (positive = ahead of center
    // of mass), otherwise an undirected magnitude — see OverstrideResult.
    overstride: metrics.overstride?.overstrideCm ?? null,
    hip_drop: metrics.hipDrop?.hipDropDegrees ?? null,
    arm_swing_symmetry: metrics.armSwingSymmetry?.symmetryScore ?? null,
    ground_contact_time: metrics.groundContactTime?.groundContactMs ?? null,
    flight_time: metrics.flightTime?.flightMs ?? null,
    landing_form: metrics.landingForm?.pattern ?? null,
    landing_form_confidence: metrics.landingForm?.confidence ?? "unavailable",
    // No flagging logic exists yet (that's Batch 7's recommendations) —
    // an empty list, not a guess.
    flags: [],
    // `score` deliberately omitted: the efficiency-score formula is still an
    // open decision (PRD Section 12).
  };
}
