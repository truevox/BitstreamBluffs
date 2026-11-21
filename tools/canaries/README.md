# Golden canary tapes + feel-diff gate (Issue #117)

Regression canaries for clasp/sled handling: a curated corpus of real input tapes is replayed frame-by-frame
against the **real built game**, and each run is compared to a committed golden record. If handling drifts,
the differ names the first tick, the field and both values.

This is **test infrastructure only**. It does not change physics, and it is not a physics tuner.

## Layout

```
tools/canaries/
  corpus/<id>.json     one input tape per canary (the fixture; reviewable JSON)
  golden/<id>.json     committed baseline record for that tape
  out/<id>.json        the latest recording (working output, not committed)
  expected/<id>.json   a reviewed declaration that a canary SHOULD differ (see expected/README.md)
  lib/compare.cjs      pure comparator: statuses, first divergence, outcome + handling stats
  run-canaries.mjs     recorder: drives the real game, writes out/ (and golden/ with --record-golden)
  feel-diff.mjs        the gate: record (or reuse out/), compare to golden/, report, exit 0 or 2
  probe-features.mjs   authoring aid: dumps the real generated lips/pads/hazards around an X
tests/canaries/
  compare.test.js      unit tests for the real comparator (no browser, no network)
```

## The corpus

Each canary names the feature it must actually reach, and its `notes` field records the *verified* evidence
for that claim (tick/x/measurement from a real run). A canary whose target feature never occurs is a bug in
the fixture, not a passing test.

| canary | covers | verified outcome |
| --- | --- | --- |
| `flip-edge` | front flip released one 100 ms step from the land/bail boundary | lands `good` at 24.4°; the same tape released 100 ms later lands `sloppy` at 69°. Score 312, no crash |
| `bump` | natural terrain bump off a real generator launch lip (no hop input) | crosses lip x=4688, lands `perfect` at 5.9°, score 234 |
| `cruise-points` | score/trick accrual without crashing | airBrake + frontflip, 2158 ms of air, highBandwidth zone, score 481 |
| `long-airborne` | long canopy-controlled airtime | 2350 ms airborne; parachute/helicopterCW/airBrake all register, score 774 |
| `hazard-transition` | biome boundary crossing into a real hazard | null sector 5 → `pyramid-peak` sector 6, then dies to `glitchChasm` at tick 580 |
| `bsod-attack` | the deletion wall actually catching a stalled sled | `minBsodGapPx` 1.27 px, `cause='bsod'` at tick 6891, score 45 |
| `stall` | a 2500 ms display stall that must NOT fast-forward | `stallCount=2`, `droppedMs=0`, fixed-tick sequence unchanged |

## Recording and comparing

The recorder drives the real game in headless Chromium. It needs a **built** bundle served over HTTP:

```bash
npm run build
npx vite preview --port 8317 --strictPort --host 127.0.0.1 &   # serve dist/
GAME_URL=http://127.0.0.1:8317/ node tools/canaries/run-canaries.mjs
```

Then:

```bash
# the gate: fresh recording, compare every canary to golden/. exit 0 = PASS/EXPECTED_DIFF, 2 = fail
node tools/canaries/feel-diff.mjs

# compare the records already in out/ without launching a browser (fast, for CI-less checks)
node tools/canaries/feel-diff.mjs --use-out

# one canary, with a machine summary and a markdown table
ONLY=flip-edge REPORT_MD=.friday/canary-diff.md SUMMARY_JSON=out/summary.json \
  node tools/canaries/feel-diff.mjs --use-out

# re-baseline after a REVIEWED handling change (commit golden/ with the change)
node tools/canaries/feel-diff.mjs --record-golden
```

Inputs are chosen by env: `BASELINE_DIR` (default `tools/canaries/golden`), `OUT_DIR` (default
`tools/canaries/out`), `ONLY=id,id`. `feel-diff.mjs` always writes a machine JSON summary —
`SUMMARY_JSON=path`, defaulting to `<OUT_DIR>/feel-diff-summary.json` — and a markdown table when
`REPORT_MD=path` is set.

`feel-diff.mjs` prints, per canary: status, the earliest divergence (tick, tickMs, field, baseline, current,
abs delta), the outcome deltas (crash tick/cause/hazardId/score/distance/endTick), the handling-statistics
deltas and the sim-version stamp. It quotes the per-field epsilon on every run so the tolerance is never
implicit. A sim-version mismatch (`sameSimVersion` false) prints its own loud line, because comparing across a
physics/format bump is meaningless. Exit codes: `0` every canary PASS or declared EXPECTED_DIFF,
`2` at least one `DIVERGED`/`MISSING_BASELINE`, `1` harness error (missing dir, unreadable JSON — no verdict).

## Statuses

- `PASS` — identical within epsilon.
- `EXPECTED_DIFF` — differs, but every difference is covered by a reviewed `expected/<id>.json`.
- `DIVERGED` — an uncovered difference. **The gate fails.**
- `MISSING_BASELINE` — no golden for that canary. Also a failure: silence must not look like a pass.

Epsilon is **per field** and defaults to **0** everywhere: the recorder is frame-stepped against the fixed
`SimClock` tick, so two runs of the same tape are byte-identical (verified: two consecutive full-corpus runs
produced identical records for all 7 canaries). Any nonzero epsilon must be justified, and the only
sanctioned way to tolerate a real difference is a reviewed `expected/` entry — never a widened global
epsilon. Override per run with `EPSILON_JSON=path/to/eps.json` (documented, not recommended).

## What is committed

- `corpus/**`, `golden/**`, `expected/**` — committed. They are the fixture, the baseline and the review
  record. `.gitignore` has no rule that excludes them (verified with `git check-ignore`); keep it that way.
- `out/**` — **not** committed. It is per-run working output that `feel-diff` regenerates on every run; only
  `golden/` is the durable baseline. `.gitignore` therefore excludes `tools/canaries/out/`. If a future CI
  wants the raw records as artifacts, upload them from the job rather than committing them.
- `expected/**` ships **empty of approvals** — only the directory README. See `expected/README.md`.

## Honest limitations

- **Headless Chromium + SwiftShader.** GPU/driver-dependent rendering differences are absent by design; the
  gate covers *simulation* handling, not visual fidelity.
- **Code-only checkout.** The OGG music packs are not present in this environment, so audio and the Music Lab
  are **not** covered by these canaries.
- **One browser context per canary**, fresh page per run — no IndexedDB/profile leakage, but also no coverage
  of multi-run session state.
- **Single machine, single browser build.** Goldens are only meaningful for the same setup. The goldens
  committed here were recorded with **Node v22.22.3 / Playwright 1.65.0 / Chromium 1254
  (`chromium-1254/chrome-linux64/chrome`)** on Linux. A bump to any of those may legitimately move records;
  re-baseline deliberately and say so in the PR.
- **Daily-rule dependent unless the clock is frozen.** `RunScene` resolves a daily physics rule for *every*
  run, not just dailies: a `daily-YYYY-MM-DD` seed plays that date's rule, and every other seed plays
  `DailyPatch.getDailyInfo()` — **today's** rule, which rotates gravity/friction/air-control modifiers into
  `PhysicsTuner`. An unfrozen recorder would therefore have goldens that legitimately diverge at midnight.
  `run-canaries.mjs` freezes page time to `CANARY_DATE` (default `2026-11-21`, noon UTC) via
  `page.clock.install()` *before* the bundle initialises, and stamps the resolved rule into each record as
  `dailyRule: {asOfDate, id, modifiers}`. Override with `CANARY_DATE=YYYY-MM-DD`, but then re-record the
  goldens — the rule is part of the fixture.
- **These are regression canaries, not a fairness or anti-cheat proof**, and not an official ruleset. Replay
  hashes from one machine do not establish that a public score was earned legitimately; that requires
  independently verifiable state and rules, which this issue does not attempt.
- **`startX` teleports** stream terrain to an offset so a canary can reach a distant feature. The distance
  accounting subtracts the canary's own origin, so `distance` in a record is relative, not a world position.
- Tooling must never be used to *change* handling under this issue; it only observes. Any handling change
  needs its own issue, its own review, and (if intended) a reviewed `expected/` entry or re-baselined golden.
