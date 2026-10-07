import rawTable from "@/data/recommendations.json";

// Batch 7: the curated recommendations table (PRD Section 7). The data lives
// in src/data/recommendations.json — not hardcoded per metric in components —
// so a cutoff, citation, or dead video link can be changed by editing one
// file. This module only validates its shape at import time, so a malformed
// edit fails tests/build instead of shipping a half-broken report.
//
// Ground rule for editing that file: a metric gets a `flag` only when a real,
// checkable source backs the cutoff. Otherwise `flag` stays null and
// `notJudgedReason` explains why. Never invent a threshold.

/** Metric ids — the `analyses` column names, which is also what
 * `analyses.flags` stores (PRD Section 9: "flags (array of metric names)"). */
export const METRIC_IDS = [
  "cadence",
  "ground_contact_time",
  "flight_time",
  "vertical_oscillation",
  "overstride",
  "hip_drop",
  "landing_form",
  "arm_swing_symmetry",
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

export interface Citation {
  authors: string;
  year: number;
  title: string;
  doi: string;
}

export interface Recommendation {
  drill: string;
  rationale: string;
  citations: Citation[];
  /** Shown verbatim when the evidence is weak — PRD: say "limited evidence"
   * explicitly rather than overstate it. */
  evidenceNote: string | null;
  video: { url: string; title: string; channel: string };
}

/** Flag when the metric's headline value (same unit as its report card)
 * compares true against `value`. */
export interface FlagRule {
  op: ">=" | "<=";
  value: number;
  unit: string;
}

export type RecommendationEntry =
  | {
      label: string;
      flag: FlagRule;
      thresholdSource: string;
      flaggedMessage: string;
      recommendation: Recommendation;
    }
  | { label: string; flag: null; notJudgedReason: string };

export type RecommendationTable = Record<MetricId, RecommendationEntry>;

function fail(id: string, problem: string): never {
  throw new Error(`recommendations.json: "${id}" ${problem}`);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseEntry(id: string, raw: unknown): RecommendationEntry {
  if (typeof raw !== "object" || raw === null) fail(id, "is missing");
  const e = raw as Record<string, unknown>;
  if (!isNonEmptyString(e.label)) fail(id, "needs a label");

  if (e.flag === null) {
    if (!isNonEmptyString(e.notJudgedReason)) fail(id, "has no flag, so it needs a notJudgedReason");
    return { label: e.label, flag: null, notJudgedReason: e.notJudgedReason };
  }

  const flag = e.flag as Record<string, unknown> | undefined;
  if (!flag || (flag.op !== ">=" && flag.op !== "<=") || typeof flag.value !== "number" || !isNonEmptyString(flag.unit)) {
    fail(id, 'needs flag: null or { op: ">=" | "<=", value: number, unit: string }');
  }
  if (!isNonEmptyString(e.thresholdSource)) fail(id, "is flagged, so it needs a thresholdSource");
  if (!isNonEmptyString(e.flaggedMessage)) fail(id, "is flagged, so it needs a flaggedMessage");

  const rec = e.recommendation as Record<string, unknown> | undefined;
  if (!rec || !isNonEmptyString(rec.drill) || !isNonEmptyString(rec.rationale)) {
    fail(id, "is flagged, so it needs a recommendation with a drill and rationale");
  }
  const citations = rec.citations;
  if (!Array.isArray(citations) || citations.length === 0) {
    fail(id, "is flagged, so it needs at least one citation — never ship a flag without a source");
  }
  for (const c of citations as Record<string, unknown>[]) {
    if (!isNonEmptyString(c.authors) || typeof c.year !== "number" || !isNonEmptyString(c.title) || !isNonEmptyString(c.doi)) {
      fail(id, "has a citation missing authors, year, title, or doi");
    }
  }
  const video = rec.video as Record<string, unknown> | undefined;
  if (!video || !isNonEmptyString(video.url) || !video.url.startsWith("https://") || !isNonEmptyString(video.title) || !isNonEmptyString(video.channel)) {
    fail(id, "needs a video with an https url, title, and channel");
  }
  if (rec.evidenceNote != null && !isNonEmptyString(rec.evidenceNote)) fail(id, "has an empty evidenceNote");

  return {
    label: e.label,
    flag: { op: flag.op, value: flag.value, unit: flag.unit as string },
    thresholdSource: e.thresholdSource,
    flaggedMessage: e.flaggedMessage,
    recommendation: {
      drill: rec.drill as string,
      rationale: rec.rationale as string,
      citations: citations as unknown as Citation[],
      evidenceNote: (rec.evidenceNote as string | undefined) ?? null,
      video: { url: video.url, title: video.title as string, channel: video.channel as string },
    },
  };
}

export function parseRecommendationTable(raw: unknown): RecommendationTable {
  if (typeof raw !== "object" || raw === null) throw new Error("recommendations.json: not an object");
  const table = raw as Record<string, unknown>;
  for (const key of Object.keys(table)) {
    if (!(METRIC_IDS as readonly string[]).includes(key)) fail(key, "isn't a known metric id");
  }
  return Object.fromEntries(METRIC_IDS.map((id) => [id, parseEntry(id, table[id])])) as RecommendationTable;
}

export const RECOMMENDATIONS: RecommendationTable = parseRecommendationTable(rawTable);
