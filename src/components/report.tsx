import type { ReactNode } from "react";

// Report building blocks shared by the live report (src/app/page.tsx) and
// Batch 6's saved-report view (src/components/history/SavedReport.tsx), so a
// saved run renders with exactly the same cards as the live one. Moved out
// of page.tsx unchanged — an App Router page file can't export helpers.

export function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-10 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs text-stone">{String(number).padStart(2, "0")}</span>
        <h2 className="font-display text-xl uppercase tracking-wide text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** A numeric readout (percentage of leg length) within an otherwise-prose
 * note — rendered in the mono data-label face per
 * running-brand-design-tokens.md's type rule ("monospace... for numeric
 * readouts... only"), so a measurement reads as a measurement even inside
 * a sentence, not just in the card's headline value. */
export function PctOfLegLength({ percent }: { percent: number }) {
  return <span className="font-mono">{percent.toFixed(1)}%</span>;
}

export function MetricGroup({
  label,
  columnsClassName,
  children,
}: {
  label: string;
  /** Tailwind column classes sized to exactly this group's card count —
   * omit for a single card, which renders at a capped width instead of a
   * full-bleed one-column "grid". */
  columnsClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-6 last:mb-0">
      <p className="mb-2 text-xs text-stone">{label}</p>
      {columnsClassName ? (
        <div className={`grid grid-cols-1 gap-px border border-line bg-line ${columnsClassName}`}>
          {children}
        </div>
      ) : (
        <div className="max-w-xs border border-line bg-line p-px">{children}</div>
      )}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  note,
  accent,
  strip,
}: {
  label: string;
  value: string | null;
  unit?: string;
  note?: ReactNode;
  accent?: "field" | "rust";
  /** Optional per-stride strip plot (see StripPlot) rendered below the
   * note — omitted entirely, not shown empty, when there's no value or
   * too few samples to plot. */
  strip?: ReactNode;
}) {
  return (
    <div className="bg-paper p-4">
      <p className="text-xs text-stone">{label}</p>
      {value ? (
        <p
          className={`mt-1 font-display text-3xl leading-none ${
            // Default is the --energy accent, not flat ink — every card's
            // headline number is "hero data" for its own card even though
            // the page has no single page-wide hero number (see
            // CLAUDE.md's Design system section). rust/field still
            // override it for their existing specific flagged meanings —
            // a card never shows more than one of the three at once.
            accent === "field" ? "text-field" : accent === "rust" ? "text-rust" : "text-energy"
          }`}
        >
          {value}
          {unit && <span className="ml-1 font-sans text-base text-stone">{unit}</span>}
        </p>
      ) : (
        <p className="mt-1 font-mono text-sm text-stone">not enough data</p>
      )}
      {note && <p className="mt-1 text-xs text-stone">{note}</p>}
      {value && strip}
    </div>
  );
}
