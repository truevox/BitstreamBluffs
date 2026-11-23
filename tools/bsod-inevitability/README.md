# #128 — BSOD inevitability: bounded developer-only pursuit stress test

This tool measures the **real current game's** BSOD pursuit under deterministic scripted player strategies. It uses the existing `tools/sim/run.mjs` browser harness and actual `RunScene`/`BsodPursuit`, *not* a second physics engine or a tuned pursuer. **No gameplay, leaderboard, SIM revision, history, release metadata, or score rules change.**

```sh
# Small smoke test (two matching seeds, two policies, 30 simulated seconds)
node tools/bsod-inevitability/run.mjs --seeds sim-01,sim-02 \
  --policies handsOff,canopyFlip --maxSec 30 --workers 2 \
  --outDir /tmp/bsb-128-smoke

# 12 matched seeds × 4 real bot policies, with the longer 180s horizon
node tools/bsod-inevitability/run.mjs --seeds 12 --maxSec 180 \
  --maxM 100000 --workers 3 --sampleMs 5000 \
  --outDir /tmp/bsb-128-study

# Independent determinism rerun (two page instances per seed)
node tools/sim/run.mjs --seeds sim-01,sim-02 --policy canopyFlip \
  --maxSec 30 --maxM 100000 --pursuitSampleMs 5000 --verify --workers 2

# DIAGNOSTIC ONLY: explicitly counterfactual BSOD pressure, NEVER default game/replay
node tools/bsod-inevitability/run.mjs --seeds 12 --policies handsOff,flip,canopyHop,canopyFlip \
  --maxSec 60 --workers 3 --startGapPx 500 --startSpeedPxS 1000 \
  --outDir /tmp/bsb-128-counterfactual-speed
```

## Opt-in near-threat counterfactual (not a player setting)

The stock first-slice experiment starts the wall **7,600px** behind the rider, well outside
`BSOD_DEFAULTS.dangerRangePx = 3,400`. To test whether pursuit collision works inside real danger,
`--startGapPx N` translates the *existing game's* actual BSOD wall leading edge relative to the
**Matter compound sled body's left bound** at `RunScene` `RUN_START`, after the real
`BsodPursuit` is constructed and before the first ordinary fixed-physics tick. It does **not**
patch production `src/` physics constants, edit `BsodPursuit`, change the acceleration schedule,
or construct a second simulator. `--startSpeedPxS N` (only with `--startGapPx`) can also set the
existing wall's initial speed **for an explicitly counterfactual research run**. Valid ranges:
start gap 50–20,000px and initial wall speed 25–3,000px/s. Without these flags, the
simulator follows the unchanged stock start position/speed.

Counterfactual runs always carry an `intervention` notice in their JSON config and Markdown,
and each arm carries **prior, requested and observed** gap/speed, the real danger threshold,
and `noCanonicalPlayerTape:true`. The browser explicitly disables `ghostRecorder` for this
counterfactual: no player run/tape generated under a lying original-wall header is admissible.
The report **fails closed** if an intervened arm is mixed into a nominal dataset, or an
injected initial gap/speed is missing, mislabeled, or not verified. Read these as
controlled experiments with different initial conditions, NOT evidence that the unchanged
shipped BSOD is already threatening players. Non-catches at finite horizons do not establish
infinite escape; early `crash:bsod` must arise from the authoritative game's physics/collision.


## How it works

The only instrumentation is in **developer tooling**, `tools/sim/browser.js` and `tools/sim/run.mjs`. When opted in with `--pursuitSampleMs`, the harness reads the authoritative post-tick `RunScene.bsodState` after each 60Hz browser frame, captures the **first active** gap, full-frame minimum and maximum, and a bounded interval timeline plus actual terminal gap. Every sample includes simulated milliseconds, player distance, and whether the sled is airborne. No wall position, acceleration, speed, steering or physics state is changed. With the option absent, the existing simulator runs normally with no gap timeline.

`run.mjs` calls the simulator independently per policy, with an identical explicit list of seeds. A run must include all seeds *exactly once*, with matching policy, sample period, and requested horizons. The report **fails closed** if source identity, metadata, measurements or arms are incomplete or contradictory. Pursuit telemetry is also cross-checked internally: an active-frame count must be an integer within observed frames; the first, terminal, sampled-minimum and full-frame maximum gaps must be mutually consistent (allowing 0.001px rounding of timeline snapshots). Each session validates the ruleset's current content-addressed `sha256:` identity via the existing build-identity CLI, and writes the exact Git SHA, clean/dirty worktree status, **actual working-tree SHA256 fingerprint** (tracked diffs and untracked non-ignored file content), SIM revision, canonical ruleset, build ID, package version and source artifact checksum. **The entire source identity and working-tree fingerprint are rechecked after every browser-policy child and before the final evidence is emitted**; if anything changes, the run fails closed rather than mixing differently sourced policy data. A dirty-source result is labeled experimental and content-fingerprinted, never silently attested to the Git SHA alone. These boundary checks cannot detect a transient edit that is made and reverted entirely inside one child run; for authoritative reproducibility use a committed clean checkout.

The directory named `run-<timestamp>` contains `summary.json`, `report.md`, `raw-<policy>.json`, and `run-<policy>.log` with the exact child commands. Each raw simulator file receives a SHA256 hash in the summary. Existing output is never overwritten. Full sources and tapes are external by default if you pass `--outDir`; the ignored default `tools/bsod-inevitability/out/` is local development output, not a canonical replay fixture or leaderboard evidence.

## Interpreting results

- **BSOD catch:** actual recorded `crash:bsod`; **other death:** a different actual crash. They are not counted together.
- **Right-censored:** the run reached `--maxSec` or `--maxM` without a crash. This only proves survival **until that finite bound**; it does *not* prove unbounded escape.
- **Stalled:** simulator's existing movement-stall termination; not a BSOD catch or a horizon success.
- **Initial/min/final BSOD gap:** real engine gap, measured after actual simulated ticks; **minimum** checks every 60Hz frame, not the narrower 120Hz physics substep. `lastHalfSampledGrowthPx` is a finite-window descriptor, not an extrapolation.
- **Airtime:** longest completed flight in seconds and fraction of observed 60Hz frames airborne. A policy name does not prove the player used the control; raw `inputActivity` contains actual held/active brake and parachute observations.
- **No general proof:** bot strategies do not cover human skills, all upgrade tiers, every air route, alternative inputs or future tuning. Samples reflect SIM6 released `main` when run there, NOT the draft SIM7 AirBrake retune in #248.

### Acceptance and ownership

This is the **first bounded research slice** for #128, not a solved chase pacing policy. Positive evidence requires reproducible matched seeds, actual source identity, and truthful censoring; adverse findings should feed separate owner decisions about wall pacing. Future player-tape backward compatibility is an **architectural design goal** (#266) but is not a pre-release historic SIM1–SIM6 requirement. Do not merge this experiment without review; no change to pursuer pacing or ranked verification has been authorized.

Focused tests: `npm test -- --runInBand tests/bsod-inevitability/analyze.test.js`.
