import { MetricCard, MetricGroup } from "@/components/report";
import type { AnalysisRow } from "@/lib/supabase/analyses";
import { formatRecordedAt } from "./format";

// Batch 6: a saved run, re-opened from the history sidebar. Same cards as
// the live report (src/components/report.tsx), but only the headline numbers
// the `analyses` table stores — no video, no per-stride strip plots, no
// camera-angle or leg-length notes. Says so plainly rather than leaving
// those gaps unexplained.

function fixed(value: number | null, digits: number): string | null {
  return value == null ? null : value.toFixed(digits);
}

export function SavedReport({ analysis }: { analysis: AnalysisRow }) {
  const confidence =
    analysis.landing_form_confidence && analysis.landing_form_confidence !== "unavailable"
      ? `${analysis.landing_form_confidence} confidence`
      : undefined;

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <h2 className="font-display text-2xl uppercase tracking-wide text-ink sm:text-3xl">
        Saved run
      </h2>
      <p className="mt-1 font-mono text-sm text-stone">
        {formatRecordedAt(analysis.recorded_at)}
        {analysis.video_fps != null && ` · ${analysis.video_fps.toFixed(0)}fps`}
      </p>
      <p className="mt-2 mb-6 max-w-prose text-sm text-stone">
        Saved runs keep each metric&apos;s headline number. The video and per-stride plots
        aren&apos;t stored.
      </p>

      <MetricGroup label="Timing" columnsClassName="sm:grid-cols-3">
        <MetricCard label="Cadence" value={fixed(analysis.cadence, 0)} unit="spm" />
        <MetricCard
          label="Ground contact time"
          value={fixed(analysis.ground_contact_time, 0)}
          unit="ms"
        />
        <MetricCard label="Flight time" value={fixed(analysis.flight_time, 0)} unit="ms" />
      </MetricGroup>

      <MetricGroup label="Alignment & impact" columnsClassName="sm:grid-cols-2">
        <MetricCard
          label="Vertical oscillation"
          value={fixed(analysis.vertical_oscillation, 1)}
          unit="cm"
        />
        <MetricCard
          label="Overstride"
          value={analysis.overstride == null ? null : Math.abs(analysis.overstride).toFixed(1)}
          unit="cm"
          // Whether a positive value was a signed "ahead of center of mass"
          // reading or an undirected distance isn't stored, so it gets no
          // rust flag here — only a negative value (always signed) can be
          // described with confidence.
          note={analysis.overstride != null && analysis.overstride < 0 ? "behind center of mass" : undefined}
        />
        <MetricCard label="Hip drop" value={fixed(analysis.hip_drop, 1)} unit="°" />
        <MetricCard label="Landing form" value={analysis.landing_form} note={confidence} />
      </MetricGroup>

      <MetricGroup label="Symmetry">
        <MetricCard
          label="Arm swing symmetry"
          value={fixed(analysis.arm_swing_symmetry, 0)}
          unit="%"
        />
      </MetricGroup>
    </div>
  );
}
