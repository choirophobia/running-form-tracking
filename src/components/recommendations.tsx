import { RECOMMENDATIONS, type MetricId } from "@/lib/recommendations";

// Batch 7: the recommendations block (PRD Section 7) and the per-card
// judgement line, shared by the live report (src/app/page.tsx) and saved
// reports (src/components/history/SavedReport.tsx). All copy comes from the
// curated table (src/data/recommendations.json) — nothing per-metric is
// hardcoded here.

/** What a metric card says about its own value: rust + the flagged message
 * when flagged; otherwise a quiet line on why it isn't judged (or that it's
 * under the cutoff). Rust is reserved for flags — nothing else sets it. */
export function cardJudgement(
  id: MetricId,
  flags: readonly MetricId[],
  hasValue: boolean
): { accent?: "rust"; judgement?: string } {
  const entry = RECOMMENDATIONS[id];
  if (!entry.flag) return { judgement: entry.notJudgedReason };
  if (flags.includes(id)) return { accent: "rust", judgement: entry.flaggedMessage };
  if (!hasValue) return {};
  const word = entry.flag.op === ">=" ? "Under" : "Over";
  return { judgement: `${word} the ${entry.flag.value}${entry.flag.unit} research cutoff.` };
}

export function RecommendationsSection({
  flags,
  hipDropMeasured,
}: {
  flags: readonly MetricId[];
  /** False when hip drop had no value — usually a side-on video. Hip drop
   * is the only metric with a cutoff, so "nothing flagged" needs that
   * caveat to be honest. */
  hipDropMeasured: boolean;
}) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h3 className="font-display text-lg uppercase tracking-wide text-ink">What to work on</h3>

      {flags.length === 0 ? (
        <p className="mt-2 max-w-prose text-sm text-stone">
          Nothing flagged in this run.
          {!hipDropMeasured &&
            " Hip drop is the only metric with a research cutoff so far, and it needs a front or rear camera angle — film from behind to check it."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {flags.map((id) => {
            const entry = RECOMMENDATIONS[id];
            if (!entry.flag) return null;
            const rec = entry.recommendation;
            return (
              <li key={id} className="py-4">
                <p className="text-xs text-stone">{entry.label}</p>
                <p className="mt-1 font-medium text-ink">{rec.drill}</p>
                <p className="mt-1 max-w-prose text-sm text-ink">{rec.rationale}</p>
                {rec.evidenceNote && (
                  <p className="mt-2 max-w-prose text-sm text-rust">{rec.evidenceNote}</p>
                )}
                <p className="mt-2 text-xs text-stone">
                  {rec.citations.map((c, i) => (
                    <span key={c.doi}>
                      {i > 0 && "; "}
                      <a
                        href={`https://doi.org/${c.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={c.title}
                        className="underline decoration-line underline-offset-2 hover:text-ink"
                      >
                        {c.authors} <span className="font-mono">{c.year}</span>
                      </a>
                    </span>
                  ))}
                </p>
                <p className="mt-2 text-sm">
                  <a
                    href={rec.video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                  >
                    Watch: {rec.video.title}
                  </a>
                  <span className="text-stone"> · {rec.video.channel}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 max-w-prose text-xs text-stone">
        These are suggestions, not medical advice. Talk to a coach, physiotherapist, or doctor before
        starting new exercises — especially if you have pain or an existing injury.
      </p>
    </section>
  );
}
