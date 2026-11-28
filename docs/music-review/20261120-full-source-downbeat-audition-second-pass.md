# *One More Run* — full-source downbeat candidates and listening tool (UNVERIFIED)

**Research continuation, 2026-11-20 UTC · Issue #50 / draft PR #53. No gameplay changes.**

The prior first pass used eight original recording windows. The repeatable
research command has now analyzed all **15 original OGG stem segments**,
including the shorter original 6.6-second ending. The eight previously
analyzed window objects are **identical as parsed JSON objects**
to those in the first-pass report: the original evidence has not been revised.

## Full 160 BPM candidate overview — NOT beat-one truth

These are the **highest local source-energy ranked hypotheses** for one of
three *unconfirmed* tempo proposals. The "best" offset is an arbitrary
drum/bass contrast ranking, not musical approval. Local phase is seconds
after each segment's start; it cannot be stitched into a continuous song map.

| Source interval (s) | Local phase (s) | Locally favored 4/4 offset (0–3) |
|---|---:|---:|
| 0–12 | 0.0499 | 0 |
| 12–24 | 0.2868 | 3 |
| 24–36 | 0.0748 | 0 |
| 36–48 | 0.0249 | 2 |
| 48–60 | 0.3118 | 3 |
| 60–72 | 0.2619 | 3 |
| 72–84 | 0.3118 | 3 |
| 84–96 | 0.1247 | 1 |
| 96–108 | 0.1247 | 2 |
| 108–120 | 0.1247 | 1 |
| 120–132 | 0.1372 | 2 |
| 132–144 | 0.3492 | 3 |
| 144–156 | 0.1746 | 3 |
| 156–168 | 0.0499 | 2 |
| 168–174.6 | 0.3367 | 1 |

**This pattern does not prove actual bar changes or a drifting recorded
tempo.** Each 12-second window has its own independent pulse alignment.
Kick/snare accents, bass changes, syncopation, local masking, pickups and
half-time perception can all bias these phase and meter rankings. The
shorter ending has fewer beats of evidence. The segment with the lowest
160 BPM top-score in this experiment is 120–132 seconds; that metric is
not a probability or confidence score.

## Direct original-audio listening comparison

The standalone, optional browser UI at
`/music-review/downbeat-review/` now loads the original stem pack and
checks its exact source-manifest SHA-256, then plays a selected original
segment with independent synthetic click overlays. It offers:

- All 15 source excerpts; three non-verified BPM hypotheses (160, 161.5,
  163.84), up to four pulse-phase rivals per BPM, and all four rival
  bar-start accents for every phase.
- Full six-stem, drums, bass, and guitar+piano+other audition modes.
- Stronger hypothetical beat-one tick vs three quieter quarter-note ticks.
  Each rival repeats the *same* original audio and the *same* pulse phase;
  only the accent's four-beat placement changes.
- Downloadable, explicitly **unverified listening observations** rather
  than any write to the shipped beat catalog, GBrain, or original OGGs.

The CT223 research worktree intentionally excludes tracked OGG binaries
for disk safety; normal full checkouts and full-preview builds include them.
Manifest and original onsets were analyzed from an already-existing,
hash-identical full music worktree without copying any audio.

## Source fingerprints / reproduction

- Original pack manifest SHA-256:
  `e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a`
- All-15-window JSON report SHA-256:
  `6696cf5e9b07089ad1cefd171110efb96fd38b228902f48b0786a416d6aa9024`
- Machine-readable report:
  `one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json`
- Generator and UI:
  `tools/music/research_original_downbeat_candidates.py --all-windows`,
  `tools/music/build_downbeat_review_data.py`,
  `public/music-review/downbeat-review/`

Offline analysis reproducibly requires the original audio plus NumPy/SciPy.
The browser UI's source-linked clock and candidate data have dependency-free
Node regression tests. **No section is human-verified; no release beat or
measure frames were produced or approved.**

## Next required musical review

Prioritize repeated-by-ear offset comparison through 60–120 seconds and
at the actual bridge entrance/exit once human listeners identify them.
A perceived half-time backbeat need not alter the quarter-note grid.
Independent pulse and harmonic/phrase checks should be added before
claiming bar identity, and each acceptable source interval should be
reviewed by two independent listeners (or equivalent independently
grounded musical evaluations). Only then should a versioned,
frame-accurate **separate** source meter schema be proposed.
