# #119 — Strict causal primitive adapters (RunRandom + SimClock)

**Developer-only, independent component milestone.** This is real, reusable `src/` code that can capture and restore real seeded `Rng` and fixed-tick `SimClock` objects. It does **not** register a production `BbSavestateCache` layout, authorize incoming savestate bytes, restore the Matter world or GhostRecorder, expose a player Save/Resume option, change physics, or grant leaderboard credit. A saved slot still accepts **envelope-only** data.

## Explicit field ownership

| Object | Exact own fields | Captured and checked | Refused cases |
| --- | --- | --- | --- |
| `runRandom` | `version`, `physicsScramble`, `visualSled`, `visualFx`, `visualCamera` | Version 1; every stream's `baseSeed` and `state` as uint32, including cosmetic streams | Unknown/absent stream, wrong version, cross-run base seed, nonfresh target, duplicate stream alias, accessor/nonwritable state, unexpected future `Rng` own field |
| each `Rng` | `baseSeed`, `state` | Preserves the target stream **object identity**, changes only `state`, checks base seed against the freshly created stream | Bad prototype, bad uint32, newly added field |
| `SimClock` | `tickMs`, `maxTicks`, `accMs`, `tick`, `droppedMs`, `_edges`, `_timeline` | Exact tick count and runtime configuration, accumulator/dropped time as canonical `f64:` bits; null pending-input journal | New clock field, mismatched tick settings, stale target, nonfinite/rejected clocks, queued one-shot input or live timeline, write-protected target |

**Atomic preflight boundary:** both restore functions check the target and *every* snapshot field before writing a value. Restores require new, seed-matched objects; they refuse to overwrite an already-advanced stream or clock. Inputs are plain data (cross-realm ordinary objects supported), not arbitrary class materializers. No snapshot can supply its own execution or schema validator. Causal clock configuration is matched, never blindly overwritten. Future staging of multiple components and Matter must separately preflight the **entire transaction** before swapping a world into active gameplay; these two helpers alone do **not** make a whole-world restore atomic.

**Tick boundary:** `SimClock._edges` and `_timeline` must both be null. Pausing between input assignment and consumption would otherwise lose an input, so capture explicitly throws. The tick, sub-tick accumulator, dropped frame time, and all stream states survive a canonical byte round-trip and produce exactly matching subsequent draws/clock steps in Jest. A complete feature must also stage Matter bodies, collision pair order, world generator/chunks, scene-owned mutable objects, UI/eligibility, recorder prefix and all other causal sections, and replay the entire tick-zero tape for any normal-board eligibility. The diagnostic reflective `tools/savestate-experiment/game-state-kit.js` is not a valid production serializer.

## Local proof

`npm test -- --runInBand tests/determinism/savestate-primitive-state.test.js`

A test explicitly creates two independent actual stream sets, draws an uneven prefix in each named stream, captures through BB-CJSON, restores to a *fresh* instance seeded identically, and compares 120 subsequent draws **per stream**. Another advances a real clock under irregular frame intervals, captures through BB-CJSON, restores fresh, then compares tick counts, frames, pending edge behavior, accumulator and dropped time including a long stall. Negative tests reject corrupt/truncated versions, wrong seeds, unknown fields, invalid double/uint32, accessors, aliasing, queued input and nonwritable targets without partially modifying the destination.

These are pure production-class component tests, **not** a representative whole-world Matter/recorder fresh-restore test, save UI or a legitimate official scored run.
