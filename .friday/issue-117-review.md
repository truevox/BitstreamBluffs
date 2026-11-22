# Issue #117 — Golden Canary Tapes + Feel-Diff Dashboard — review report

**Status:** ready for external review (Gal Friday gate). **Do not merge without Gal Friday's approval.**
**Orchestrator:** Home Friday (CT223) · **Branch:** `friday/issue-117-home-canaries-20261121` · **PR:** #158
**Implementers:** OpenCode WALL-E (bounded attempts) + Home Friday direct fixes and re-verification
**Independent reviewer:** pending (open question, see §9)

Every claim below was re-run by the orchestrator on 2026-11-21 in this worktree. Where an earlier draft of this
file stated a number, that number was checked against real output and corrected if it did not reproduce; the
corrections are listed in §10 so the reviewer can see what was wrong rather than a clean-looking history.

---

## 1. What this delivers

| Deliverable | Path | State |
| --- | --- | --- |
| Curated input tapes (7) | `tools/canaries/corpus/*.json` | verified, each with recorded evidence in `notes` |
| Recorder (drives the real game) | `tools/canaries/run-canaries.mjs` | working; 7/7 records |
| Comparator (pure, no browser) | `tools/canaries/lib/compare.cjs` | working; 24 comparator tests |
| Stall invariant rule | `tools/canaries/lib/stall.cjs` | working; 8 tests |
| Feel-diff gate | `tools/canaries/feel-diff.mjs` | working; exit 0/2/1 per spec |
| Golden baselines (7) | `tools/canaries/golden/*.json` | re-recorded; 7/7 PASS on a fresh re-record |
| Expected-difference schema | `tools/canaries/expected/README.md` | documented; **no approvals shipped** |
| Harness docs | `tools/canaries/README.md` | coverage, workflow, honest limitations |
| Unit tests | `tests/canaries/*.test.js` | `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/canaries` → 32 passed |

**Scope discipline:** only `tools/canaries/**` and `tests/canaries/**` (+ `.friday/` artifact and a 3-line
`.gitignore` entry for the regenerable `tools/canaries/out/`). No change to `src/**`, `js/**`, `public/**`,
`package.json`, `.github/workflows/**`, `tools/replay-determinism-browser-probe.mjs` (Team B #120 adjacency) or
`tools/ghost-tape-browser-smoke.mjs`. **No physics behaviour was changed** — this issue adds observation only.

## 2. Determinism — the premise the whole gate rests on

A zero-epsilon golden gate is worthless if two runs of the same tape differ. Two full-corpus recordings were
made back-to-back and compared byte-for-byte (`cmp -s`):

```
IDENTICAL bsod-attack.json
IDENTICAL bump.json
IDENTICAL cruise-points.json
IDENTICAL flip-edge.json
IDENTICAL hazard-transition.json
IDENTICAL long-airborne.json
IDENTICAL stall.json
```

That is why `DEFAULT_EPSILON` is 0 for every field: any difference is real, so a tolerance must be a reviewed
declaration, never a widened default.

**Wall-clock is frozen, and it has to be.** `RunScene` resolves a daily physics rule for *every* run, not just
dailies (`src/scenes/RunScene.js:196`: `daily = seedDayInfo ? … : DailyPatch.getDailyInfo()`), and that rule
rotates gravity/friction/air-control modifiers into `PhysicsTuner`. `run-canaries.mjs` therefore installs
`page.clock` at `CANARY_DATE` (default `2026-11-21T12:00Z`) **before** the bundle initialises, and stamps the
resolved rule into each record as `dailyRule: {asOfDate, id, modifiers}`. All seven goldens record
`id: "featherweight", gravityMul 0.8, airControlMul 0.9`. Without this the corpus silently re-baselines itself
at midnight, which is exactly the "cry wolf on a schedule" failure a regression gate cannot afford.

## 3. Each canary proves it reaches its named feature

A canary that never reaches its feature is a broken fixture that silently "passes". Each was measured against
real generator output (fresh 2026-11-21 records):

| canary | feature reached (evidence from the record) |
| --- | --- |
| `flip-edge` | lip x=18464, front flip @tick 357, lands `good` @tick 382, **24.36°**, 958 ms air |
| `bump` | crosses real launch lip x=4688 (startTick 186, 116.7 ms), lands `perfect` @tick 200 at **5.95°** — with the tape's only input being `push` 0–400 ms, so no hop |
| `cruise-points` | `airBrake`@318 + `frontflip`@427, lip x=1024 with 2158.3 ms of air landing x=1873 @540, highBandwidth zone x=2639–3229 @708, score 0→481 |
| `long-airborne` | lip x=18464 @196 with **2350 ms** airborne, landing @478 with 2358 ms air; `parachute`@276, `helicopterCW`@313, `airBrake`@366 all register |
| `hazard-transition` | chunk biome `null` sector 5 (x=50003) → `pyramid-peak` sector 6 (x=50944) @260, thermalUpdraft zone x=51951–52627 @547, then `cause='hazard'`, `hazardId='glitchChasm'` @580 |
| `bsod-attack` | deletion wall catches the stalled sled: `minBsodGapPx=1.27`, `bsodCaughtTick=6891`, `crashed=true`, `cause='bsod'` |
| `stall` | two 2500 ms display frames measured **per stall**: `+6 ticks / 50.000 ms` of sim each, `stallCount=2`, `droppedMs=0` |

The `flip-edge` boundary claim was established by **sweep**, not assertion: the committed tape releases `tilt` at
3100 ms → `good` @24.36°; an otherwise identical tape releasing at **3200 ms** (one 100 ms input step later)
lands **`sloppy` @68.91°** with score 312→285. Both variants land; this is a landing-*grade* boundary, and the
corpus `notes` say so explicitly so nobody "fixes" it toward a clean landing.

## 4. The gate itself, exercised end to end

Fresh recording against the committed goldens:

```
$ node tools/canaries/feel-diff.mjs
recorded 7/7 canaries -> tools/canaries/out
…
canaries=7 PASS=7          # exit 0
```

Negative controls, each run for real and then reverted:

| control | expected | observed |
| --- | --- | --- |
| perturb one `angle` by `1e-4` at t=2000 ms | DIVERGED, right tick + field, exit 2 | `angle 0.631212 -> 0.631312 (abs delta 0.0001) at tick 240 (2000 ms)`, `exit 2` |
| same perturbation + narrow `expected/` entry (`maxAbs 0.0001`) | EXPECTED_DIFF, exit 0 | `EXPECTED_DIFF`, `exit 0` |
| same, but `expected/` bound `maxAbs 0.00001` (narrower than the delta) | DIVERGED (fail closed) | `DIVERGED` |
| delete one golden | MISSING_BASELINE, exit 2 | `MISSING_BASELINE bump` |
| restore everything | 7/7 PASS | `canaries=7 PASS=7` |

`EXPECTED_DIFF` never becomes `PASS`: the difference stays in the report and the JSON summary, and
`expected/<id>.json` must name a concrete field, a finite numeric `maxAbs`, a written reason, a named reviewer
and a timestamp — `validateExpected` throws on anything else (including `null`/`""`/`true`/`"2"`, which
`Number()` would have coerced into a bound nobody wrote). Tolerance is applied to the **raw** delta; the 6-dp
`absDelta` is display-only, so rounding can never approve a difference larger than the declared bound.

## 5. Tests

```
$ node --experimental-vm-modules node_modules/jest/bin/jest.js tests/canaries
PASS tests/canaries/stall.test.js
PASS tests/canaries/compare.test.js
Test Suites: 2 passed, 2 total
Tests:       32 passed, 32 total
```

24 comparator tests + 8 stall-invariant tests. They `require` the **real** `tools/canaries/lib/*.cjs` — they do
not reimplement the rules — and they include regression tests for each defect fixed in review (rounded-away
deltas, non-numeric `maxAbs`, mismatched time axes, malformed records, `hazardId`-only outcome changes).

## 6. What this is NOT

- Not a fairness or anti-cheat proof, and not an official ruleset. Local replay records from one machine do
  not establish that a public score was earned legitimately.
- Not visual-fidelity coverage: headless Chromium + SwiftShader only covers *simulation* handling.
- Not audio coverage: this checkout has no OGG packs, so Music Lab and all audio paths are untested here.
- Not a physics change. Nothing in `src/` moves; any handling change needs its own issue and its own review.
- **The `stall` canary covers the frame-delta clamp, not SimClock's backlog cap.** `RunScene.update()` clamps
  `delta` to 50 ms (`src/scenes/RunScene.js:1167`) before `SimClock.advance()` sees it, and 50 ms / 8.333 ms
  never exceeds `SIM_MAX_TICKS_PER_FRAME`, so `droppedMs` stays 0 and the *cap* path is unexercised. Covering
  the cap needs a canary that stubs a delta past the clamp. The README and the corpus `notes` say this plainly
  rather than claiming more than was measured.

## 7. Overlap check (reconciled against live GitHub + worktrees)

- **Team A** (#152/#116/#118/#123 → PRs #163/#164/#165/#166): untouched. No replay-manifest, frame-hashing or
  time-capsule file is read or written.
- **Team B** (#119/#140/#120/#115 → PRs #159/#160/#161/#162): untouched.
  `tools/replay-determinism-browser-probe.mjs` is theirs-adjacent and was deliberately **not** edited; this
  harness is a separate directory with its own recorder.
- **#68 / #76**: no branch, no PR, no assignee at time of writing — nothing to collide with. #76 (exploit
  factory) would *consume* this corpus, and does not touch `tools/canaries/**`.
- Open-PR sweep at HEAD time: 20+ open PRs, none touching `tools/canaries/**` or `tests/canaries/**`.

## 8. Residual risk / open items for the reviewer

1. **Goldens are environment-specific.** Recorded with Node v22.22.3 / Playwright 1.65.0 / Chromium 1254 on
   Linux. A bump to any of those may legitimately move records. There is no CI job pinning the browser version —
   adding one was out of scope.
2. **`startX` teleports.** Several tapes set `startX` to reach distant features, so distance in a record is
   relative to the canary origin, not a world position. Worth confirming the reviewer is comfortable this cannot
   be mistaken for real gameplay distance.
3. **No CI wiring.** The gate is runnable (`node tools/canaries/feel-diff.mjs`, no npm needed) but not invoked by
   a workflow. Adding one was explicitly out of scope; the exit codes are the seam for it.
4. **The harness trusts `window.__bbGame`.** It reaches into the scene to install tape input. Deliberate and
   read-only w.r.t. gameplay state, but it means canaries run the *built bundle*, so goldens are only valid for
   the build that produced them.
5. **`bsod-attack` asserts the minimum gap, not the starting gap.** The record stores only `minBsodGapPx`; the
   earlier "11345 px → 1.27 px" phrasing was not reproducible from the artifact and has been removed.

## 9. Ask

Marvin: please have **Gal Friday** review PR #158. This PR is intentionally left at the review gate — no merge
will happen from my side. On approval I merge, verify the landed diff and confirm issue #117 closes.

**Open question for Gal Friday (not a blocker I can resolve myself):** §8.4 and the absence of CI wiring mean
`feel-diff` is a manual gate. If review wants it enforced rather than runnable, that is a small follow-up issue
(a job that runs `--use-out` against committed goldens) and it needs a workflow file, which this issue's scope
excluded.

## 10. Corrections made during orchestration (so the reviewer sees what changed)

1. **`npx jest tests/canaries` did not work.** The package is ESM (`"type": "module"`), so the tests' bare
   `require` threw `ReferenceError: require is not defined` — 0 tests ran, and the earlier "16 passed" claim in
   this file was not reproducible. Fixed with `createRequire(import.meta.url)` in both test files; the real
   result is **32 passed** (24 + 8), not 16.
2. **The committed goldens were stale** relative to the recorder's new final-checkpoint sampling: 5/7 DIVERGED
   on a fresh record purely on `checkpointCount` (e.g. `bump 3 -> 4`). Re-recorded deliberately with
   `--record-golden`, then re-verified with a *second* independent fresh record → 7/7 PASS.
3. **Two corpus notes stated numbers the records do not support** (`bump` lip `startTick:64` where the record
   says 186 and the tick-64 event is the start drop; `cruise-points` "three airborne episodes over the lip"
   where only one crosses the lip). Both notes rewritten from the actual record.
4. **`bsod-attack` "gap 11345 px → 1.27 px"** is not in the artifact (only the minimum is stored). Claim
   narrowed in both the corpus note and the README table.
5. **`stall` mechanism claim corrected** to the clamp (not SimClock's cap) in §6, the README and the corpus note.

`.friday/canary-diff.md` is the committed markdown table produced by the gate itself.
