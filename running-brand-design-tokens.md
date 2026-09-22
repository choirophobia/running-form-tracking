# Design tokens — running product line

Shared visual language for the running form SaaS and Volt and Fast rebuild, so both read as one identity instead of two disconnected builds. Grounded in the athletic-editorial direction already set by the Volt and Fast references (Bandit Running, Koumori, Satisfy Running).

## Color

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#12130F` | Primary text, dark surfaces |
| `--paper` | `#F2EFE6` | Base background — warm off-white, not stark white |
| `--stone` | `#B8B2A1` | Secondary text, dividers, muted labels |
| `--rust` | `#B5502E` | Single accent — effort, alerts, CTAs. Used sparingly |
| `--field` | `#3C4A2E` | Secondary accent — success states, "good form" flags |
| `--line` | `#DAD5C6` | Hairline borders, table rules |

Two accents only (`rust`, `field`) — never both in the same component. Rust reads as "pay attention" (overstride flag, form warning); field reads as "on track" (good rep, valid range).

## Type

- **Display / headlines:** a condensed, high-contrast grotesk (e.g. Neue Haas Grotesk Condensed or Archivo Expanded) — used for big numbers (cadence, score) and section titles only. Not used for body copy.
- **Body / UI:** a plain grotesk (e.g. Inter or General Sans) — sentence case throughout, no tracked-out caps.
- **Data labels:** monospace (e.g. JetBrains Mono), small size, for numeric readouts and timestamps only — reinforces "this is a measurement," not decoration.

Line length under 80 characters for body copy. No accenting single words in headlines with color or italics.

## Layout principles

- Left-aligned content, not centered — reads as a working tool, not a landing page
- One hero number per screen (the efficiency score, the pace) rendered large in the display face; everything else stays quiet
- Flat surfaces, hairline `--line` borders only — no drop shadows, no rounded-card-kit sameness
- Motion limited to one moment: the report revealing itself when analysis completes. No hover animations on every card.
- Numbered steps only where the content is genuinely sequential (upload → analyze → report) — not decorative 01/02/03 elsewhere

## What to avoid (from frontend-design skill calibration)

- Cream + terracotta + serif combo (too close to generic AI-generated defaults, despite similar warmth here — the condensed grotesk and mono data labels are what differentiate this)
- Identical rounded cards with matching soft shadows everywhere
- Tracked-out ALL-CAPS eyebrow labels above every section
- Arrow (→) appended to buttons and links

## Voice

Plain, direct, coaching tone — not corporate SaaS copy. "Overstriding on your left foot" not "Overstride event detected: LEFT." Errors explain what happened and what to do next, never a raw exception string.
