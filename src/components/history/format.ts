// Batch 6: shared formatting for history entries (sidebar + saved report).
// en-GB gives "Sat 3 Oct" day-first ordering; the user's own time zone is
// used implicitly via Intl.

const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const YEAR = new Intl.DateTimeFormat("en-GB", { year: "numeric" });

/** "Sat 3 Oct · 21:04", with the year appended only when it isn't this year. */
export function formatRecordedAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${YEAR.format(d)}`;
  return `${DATE.format(d)}${year} · ${TIME.format(d)}`;
}
