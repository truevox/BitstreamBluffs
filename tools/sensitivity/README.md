# `tools/sensitivity` — developer-only input-timing sensitivity preflight

Scope: the **first narrow slice** of issue [#130](https://github.com/truevox/BitstreamBluffs/issues/130)
(Butterfly Sensitivity Heatmaps). One axis only — **fixed-tick input timing** — on one named control, over a
matched set of deterministic stock seeds. Not a heatmap surface, not a multi-constant sweep, not a balance or
fairness finding, and not a change to the game.

## What it actually measures

For each seed it:

1. **captures one run** from the shipped game (Phaser + Matter in headless Chromium, driven exactly as
   `tools/sim/run.mjs` drives it) and keeps that run's own ghost tape;
2. **proves the capture is reproducible** by replaying the untouched tape through the game's own `TapePlayer`
   and requiring its checkpoints to match — if they do not, the seed is refused rather than measured;
3. **replays that same tape with one control shifted** by ±1, ±2 fixed simulation ticks, and records how each
   arm ended.

The tape is the shipped, authoritative record of what the run fed the simulation. Perturbing it and feeding it
back through the shipped `TapePlayer` means the **only** difference between arms is the shifted ticks: no
policy re-derivation, no second simulator, no copied physics.

## Reproduce

One command, from the repo root:

```sh
node tools/sensitivity/run-sensitivity.mjs --seeds 12 --field hopPress --offsets -2,-1,0,1,2 \
  --maxM 5000 --maxSec 180 --workers 2 \
  --out tools/sensitivity/results/hopPress-12seeds.json
```

The source-pinned measurement in `results/hopPress-12seeds.json` was generated **after** the
instrumentation was committed at Git SHA `66d8b0a67f0f6caa21a64ee3d1a7bfbb5e8a276b`, against its
clean checkout. The report's `build.sourceSha` therefore identifies that **executable implementation**;
the subsequent evidence-only commit containing this JSON is not a different simulation build. At the
original 90-second capture horizon `sim-06` correctly refused to emit a stale tape; extending capture
up to 180 seconds allowed its own real `crash:hazard` event at tick 12282 and yielded 12/12 valid
control captures, 60/60 complete offset arms, and one right-censored perturbed run. Add `--out FILE`
to write the machine record, `--quiet` to suppress per-run lines. The earlier Seeking scratch result is
preserved in recovery snapshots but is **not evidence for this recovered source**: its ruleset and SIM
identity were self-attested from environment variables and were inconsistent with the canonical artifacts.

| flag | meaning | default |
| --- | --- | --- |
| `--seeds LIST\|N` | explicit comma list, or `N` → `sim-01..sim-NN` | `12` |
| `--field NAME` | one control from `lib/perturb.mjs` `FIELDS` | `hopPress` |
| `--offsets LIST` | fixed-tick offsets; must contain `0` | `-2,-1,0,1,2` |
| `--rule ID\|none` | daily rule for **both** capture and replay | `featherweight` |
| `--maxM N` / `--maxSec N` | **capture** distance/time limits only; a capped capture without a finalized tape is **refused** | `3000` / `90` |
| `--workers N` | parallel pages | `2` |
| `--out FILE` | machine record (raw rows + aggregate) | — |

## What the record contains

`results/hopPress-12seeds.json` is self-describing and carries, per run: seed, field, offset, the control's
end tick/reason/distance/score, whether the tape actually changed, the number of activation spans shifted, the
outcome class, the crash cause, end tick, distance, score, max airtime, checkpoints checked, resolved daily rule
id, and the tick at which the arm diverged from the control's checkpoints. Alongside it: exact Git HEAD, a clean/dirty checkout flag, canonical SHA-256 physics ruleset ID, exact
build ID and SIM revision **derived and validated from this checkout** (never from an arbitrary environment
variable), policy, tick rate, pinned calendar day, seed/offset plan, captures, failures, and aggregate.
The tool verifies source identity at the **start and end** of the measurement and fails closed if anything
changes mid-run. Optional `SENSITIVITY_*` variables are assertions and must agree with the checked-out
source; old-style `bsb-ruleset@...` values are invalid.

## How to read the numbers

- **`censored` is not survival.** The replay is bounded by **the captured tape's own horizon plus 1200
  fixed ticks (10 seconds at 120Hz)**, *not* by `--maxM` or `--maxSec`. An arm that reaches this
  replay window without crashing has `endReason: "replay-window"`, `replayMaxTicks`, and outcome
  `censored`. It is kept in the denominator, never called a survivor or an unbounded run.
  `--maxM`/`--maxSec` bound the initial capture; if that capture cannot finalize its tape, the seed
  fails closed instead of being omitted or silently replaced by the previous seed's tape.
- **Rates carry a Wilson 95% interval** and a `smallSample` flag. With a dozen seeds a rate of 1.0 is not
  "everything survives"; the lower bound says how little that sample supports.
- **Pairs are on the same seed.** Seeds differ enormously in how far a run gets, so an unpaired comparison
  would mostly measure which seeds landed in which bin. A seed missing from either arm is *named* in
  `missingArm`/`missingControl`, never silently dropped.
- **The boundary is an exact observation**, reported only for an offset that was actually run, and never
  extrapolated between offsets. It is not a boundary of the game.
- **Checkpoint divergence is signal on a perturbed arm, not a failure.** The checkpoints belong to the
  unperturbed control, so a shifted control diverges as soon as the change reaches the simulation. Excluding
  those rows would discard exactly the runs that show sensitivity. Divergence is therefore recorded with its
  tick. On the *control* arm divergence is an integrity failure, because that arm must reproduce the capture.

## What this does not do

No physics, scoring, ranked or ruleset change; no change to simulation or replay historical tapes; no writes
outside `--out`; no second simulator; no fabricated results; no goldens touched. It makes no claim about
offsets, seeds or gameplay beyond what it measured, and no claim about live gameplay, fairness or balance.

## Tests

```sh
npm test -- tests/sensitivity
```

`tests/sensitivity/perturb.test.js` pins the reconstruction against the **shipped** `TapePlayer` and the
shipped `encodePad`/`decodePad` (identity at offset 0, one field moved and nothing else, every refusal named).
`tests/sensitivity/aggregate.test.js` pins the honesty rules above;
`tests/sensitivity/source-identity.test.js` pins the canonical source-identity contract. The fixtures in
`tests/sensitivity/fixtures/` are real tapes captured from the shipped sim by this same tool, so a format
change that would break the tool fails a test instead of silently perturbing a different control.
Raw external copy and provenance on CT223: `/srv/friday-audio/bsb-130-recovery-provenance-20261123/hopPress-12seed-180s-complete.json`
(SHA256 `388720c85d612e258fb5b3272c4a373cbc7acc829c875f4f7e1381414ff32a84`). The
12-seed sample is still small and the measured effects are not a universal gameplay fairness claim.

## Why capture runs under the tape's own rule

`RunScene` resolves the daily rule from the **replay tape** when replaying, but `tools/sim/run.mjs` neutralises
`scene.dailyMods` for a capture. A capture taken that way records the rule id while simulating without it, so
its own tape desyncs at the first checkpoint. This tool therefore captures with the rule the tape will record
and **refuses to run** if a capture tape does not replay to its own checkpoints. That refusal is the guard that
the measurement is of the real game and not of a mismatched one.
