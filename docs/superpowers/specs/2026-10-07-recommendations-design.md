# Batch 7: Recommendations — design + evidence record

Date: 2026-10-07. Status: implemented (branch `batch7-recommendations`).

## Goal

PRD Section 7: one recommendation per flagged metric (drill, one-line rationale, real author/year
citation or an explicit "limited evidence" label, video from a curated table), with a fixed medical
disclaimer. Flags persist in `analyses.flags`.

## Decisions (agreed with the user)

1. **Evidence sourcing**: Claude researches (PubMed), the user reviews. Videos found by Claude and
   checked to resolve (YouTube oEmbed) before inclusion.
2. **Conservative flagging**: speed is unknown, so only cutoffs that hold regardless of speed are
   used. Unflagged metrics show a one-line "not judged" reason instead.
3. **Approach A**: static JSON table in the repo (`src/data/recommendations.json`), flagging in the
   browser, flags stored at save time; saved reports show stored flags, never recomputed.
4. **Overstride**: the old "positive overstride = rust" rule is removed — no research cutoff.
5. **Hip drop cutoff**: 8.4° (5.6° + 2.8°), not 5.6°.

## Evidence table

| Metric | Flag | Basis |
|---|---|---|
| Hip drop | ≥ 8.4° | Bramah et al. 2019, Am J Sports Med, doi:10.1177/0363546519879693 — inclusion cutoff "CPD ≥5.6°" (≥1 SD above a healthy-runner database); +10% step rate cut CPD by 3.12° at 4 weeks (12-runner case series). Bramah et al. 2018, Am J Sports Med, doi:10.1177/0363546518793657 — CPD most associated with injury, ~80% higher odds per degree. Dingenen et al. 2018, Phys Ther Sport, doi:10.1016/j.ptsp.2018.06.009 — 2D CPD smallest detectable difference 2.7–2.8°. |
| Overstride | none | Lieberman et al. 2015, J Exp Biol, doi:10.1242/jeb.125500 — foot further ahead of the hip ↔ more braking force; no cutoff. |
| Cadence | none | Speed-dependent. Van Hooren et al. 2024, Sports Med, doi:10.1007/s40279-024-01997-3 — small association with cost (r = −0.20). |
| Vertical oscillation | none | Same meta-analysis: moderate association (r = 0.35), but speed/height-dependent, no cutoff. |
| Ground contact / flight time | none | Same meta-analysis: trivial associations (r = −0.02 / 0.11). |
| Landing form | none | Burke et al. 2021, Orthop J Sports Med, doi:10.1177/23259671211020283 — low evidence linking strike type to injury. |
| Arm swing symmetry | none | Kuhtz-Buschbeck et al. 2007, Gait Posture, doi:10.1016/j.gaitpost.2007.05.011 — some asymmetry is physiological. |

Supporting: Anderson et al. 2022, Sports Med Open, doi:10.1186/s40798-022-00504-0 — step-rate
injury outcomes "very limited" evidence (hence the hip-drop entry's "limited evidence" note).

Video: "Increasing Running Step Rate in PFP", Physio Network (Dr Bradley Neal) —
https://www.youtube.com/watch?v=vxbidUgskpM (resolved 2026-10-07).

## Known limitations

- Our hip drop is 2D pelvis tilt averaged at footstrike; the studies used 3D peak pelvic drop at
  midstance. The 2.8° margin reduces, but doesn't remove, that mismatch.
- Hip drop needs front/rear video, so side-on clips can never be flagged; the UI says so.
- Link rot: the video URL has no automated check in CI — re-verify when editing the table.
