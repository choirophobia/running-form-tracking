import type { MetricsResult } from "@/lib/metrics";
import { METRIC_IDS, RECOMMENDATIONS, type MetricId, type RecommendationTable } from "./table";

// Batch 7: decides which metrics are flagged. Pure — runs in the browser on
// every live recompute, and its output is what gets saved to
// `analyses.flags`. All thresholds come from the curated table; this file
// only knows how to read each metric's headline value.

/** Each metric's headline value, in the same unit its report card shows.
 * Null when there's no data (never flagged) or the metric isn't numeric
 * (landing form is a category, so it can't take a numeric cutoff). */
export function headlineValue(metrics: MetricsResult, id: MetricId): number | null {
  switch (id) {
    case "cadence":
      return metrics.cadence?.stepsPerMinute ?? null;
    case "ground_contact_time":
      return metrics.groundContactTime?.groundContactMs ?? null;
    case "flight_time":
      return metrics.flightTime?.flightMs ?? null;
    case "vertical_oscillation":
      return metrics.verticalOscillation?.oscillationCm ?? null;
    case "overstride":
      // Only a signed reading means "ahead of center of mass"; an undirected
      // magnitude can't be compared against a directional cutoff.
      return metrics.overstride?.signed ? metrics.overstride.overstrideCm : null;
    case "hip_drop":
      return metrics.hipDrop?.hipDropDegrees ?? null;
    case "arm_swing_symmetry":
      return metrics.armSwingSymmetry?.symmetryScore ?? null;
    case "landing_form":
      return null;
  }
}

export function flagMetrics(metrics: MetricsResult, table: RecommendationTable = RECOMMENDATIONS): MetricId[] {
  return METRIC_IDS.filter((id) => {
    const rule = table[id].flag;
    const value = headlineValue(metrics, id);
    if (!rule || value == null) return false;
    return rule.op === ">=" ? value >= rule.value : value <= rule.value;
  });
}

/** Saved runs store flags as plain strings — keep only ids this table
 * still knows, so an old or hand-edited row can't break the report. */
export function knownFlags(flags: readonly string[]): MetricId[] {
  return METRIC_IDS.filter((id) => flags.includes(id));
}
