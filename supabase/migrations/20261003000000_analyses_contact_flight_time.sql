-- Batch 6: the two metrics added after the original schema (ground contact
-- time and flight time, see CLAUDE.md's Batch 3 section) weren't persisted,
-- so a saved report in the history sidebar would have silently dropped them.
-- Both are milliseconds, nullable like every other metric ("not enough data").
-- Additive only — no existing column or RLS policy changes.

alter table public.analyses
  add column ground_contact_time numeric,
  add column flight_time numeric;
