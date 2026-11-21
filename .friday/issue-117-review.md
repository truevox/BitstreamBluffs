# Issue #117 — Golden Canary Tapes + Feel-Diff Dashboard — review report

**Status:** ready for external review (Gal Friday gate). **Do not merge without Gal Friday's approval.**
**Orchestrator:** Home Friday (CT223) · **Branch:** `friday/issue-117-home-canaries-20261121` · **PR:** #158
**Implementers:** OpenCode WALL-E (3 bounded attempts, 3600 s each) + Home Friday direct fixes
**Independent reviewer:** pending (OpenCode Deep Think read-only, requested below)

This file is the durable artifact for the review gate: every claim below is backed by a command whose real
output is quoted, not summarised.

---

## 1. What this delivers

| Deliverable | Path | State |
| --- | --- | --- |
| Curated input tapes (7) | `tools/canaries/corpus/*.json` | verified, each with recorded evidence in `notes` |
| Recorder (drives the real game) | `tools/canaries/run-canaries.mjs` | working; 7/7 records |
| Comparator (pure, no browser) | `tools/canaries/lib/compare.cjs` | working; 24 unit tests |
| Feel-diff gate | `tools/canaries/feel-diff.mjs` | working; exit 0/2/1 per spec |
| Golden baselines (7) | `tools/canaries/golden/*.json` | recorded, 7/7 PASS against themselves |
| Expected-difference schema | `tools/canaries/expected/README.md` | documented; **no approvals shipped** |
| Harness docs | `tools/canaries/README.md` | coverage, workflow, honest limitations |
| Unit tests | `tests/canaries/compare.test.js` | `npx jest tests/canaries` |

**Scope discipline:** only `tools/canaries/**` and `tests/canaries/**` (+ this `.friday/` artifact). No change
to `src/**`, `js/**`, `public/**`, `package.json`, `.github/workflows/**`,
`tools/replay-determinism-browser-probe.mjs` (shared with Team B #120) or `tools/ghost-tape-browser-smoke.mjs`.
**No physics behaviour was changed** — this issue adds observation only.

## 2. Determinism — the premise the whole gate rests on

A zero-epsilon golden gate is worthless if two runs of the same tape differ. Two full-corpus runs were
recorded back-to-back and compared byte-for-byte:

```
IDENTICAL-C-D bsod-attack.json
IDENTICAL-C-D bump.json
IDENTICAL-C-D cruise-points.json
IDENTICAL-C-D flip-edge.json
IDENTICAL-C-D hazard-transition.json
IDENTICAL-C-D long-airborne.json
IDENTICAL-C-D stall.json
```

That is why `DEFAULT_EPSILON` is 0 for every field: any difference is real, so a tolerance must be a reviewed
declaration, never a widened default.

## 3. Each canary proves it reaches its named feature

A canary that never reaches its feature is a broken fixture that silently "passes". Each was
measured against real generator output:

| canary | feature reached (evidence from the record) |
| --- | --- |
| `flip-edge` | lands `good` at 24.4°; the same tape released **100 ms later** lands `sloppy` at 69° — i.e. one input step from the bail-out side |
| `bump` | crosses real launch lip x=4688 (no hop input), then lands `perfect` at 5.9° |
| `cruise-points` | `airBrake`@318 + `frontflip`@427, 2158 ms of air over lip x=1024, highBandwidth zone x=2639–3229, score 0→481 |
| `long-airborne` | lip x=18464 with 2350 ms airborne; `parachute`@276, `helicopterCW`@313, `airBrake`@366 all register |
| `hazard-transition` | chunk biome `null` sector 5 → `pyramid-peak` sector 6 (x=50944), thermalUpdraft zone, then `cause='hazard'`, `hazardId='glitchChasm'`@580 |
| `bsod-attack` | deletion-wall gap 11345 px → **1.27 px**, `crashed=true`, `cause='bsod'`@6891 |
| `stall` | two 2500 ms display frames, `stallCount=2`, **`droppedMs=0`** — the fixed clock caps instead of fast-forwarding, so the tick sequence is unchanged |

The `flip-edge` boundary claim is the one that most needed proving, so it was established by sweep rather than
assertion: `tilt` released at 3000/3100 ms → `good` @24.4°; at 3200 ms → `sloppy` @69°; 3300 ms and later
→ the same `sloppy`. The tape sits on the boundary by construction, not by luck.

## 4. The gate itself, exercised end to end

```
$ node tools/canaries/feel-diff.mjs --record-golden     # fresh recording, then baseline
…
canaries=7 PASS=7
recorded goldens -> tools/canaries/golden
```

Negative controls (each restored afterwards):

| control | expected | observed |
| --- | --- | --- |
| perturb one `angle` by `1e-4` at t=2000 ms | DIVERGED, right tick + field, exit 2 | `angle -0.211031 -> -0.210931 (abs delta 0.0001) at tick 240 (2000 ms)`, `exit 2` |
| same perturbation + narrow `expected/` entry | EXPECTED_DIFF, exit 0 | `EXPECTED_DIFF`, `exit 0` |
| `expected/` entry **narrower** than the delta | DIVERGED (fail closed) | `DIVERGED`, `exit 2` |
| delete one golden | MISSING_BASELINE, exit 2 | `MISSING_BASELINE stall`, `exit 2` |
| restore everything | 7/7 PASS again | `canaries=7 PASS=7`, `exit 0` |

`EXPECTED_DIFF` never becomes `PASS`: the difference stays in the report and in the JSON summary, and the
`expected/<id>.json` must name a concrete field, a finite `maxAbs`, a written reason, a named reviewer and a
timestamp — `validateExpected` throws on anything else.

## 5. Tests

```
$ npx jest tests/canaries
PASS tests/canaries/compare.test.js
Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

The tests require the real `tools/canaries/lib/compare.cjs`; they do not reimplement the rules.

## 6. What this is NOT

- Not a fairness or anti-cheat proof, and not an official ruleset. Local replay records from one machine do
  not establish that a public score was earned legitimately.
- Not visual-fidelity coverage: headless Chromium + SwiftShader only covers *simulation* handling.
- Not audio coverage: this checkout has no OGG packs, so Music Lab and all audio paths are untested here.
- Not a physics change. Nothing in `src/` moves; any handling change needs its own issue and its own review.

## 7. Overlap check

- **Team A** (#152/#116/#118/#123): untouched. No replay-manifest/hashing/time-capsule files are read or written.
- **Team B** (#119/#140/#120/#115): untouched. `tools/replay-determinism-browser-probe.mjs` is theirs-adjacent
  and was deliberately **not** edited; this harness is a separate directory with its own recorder.
- **#68 / #76**: neither has a branch or PR; #76 (exploit factory) would consume this corpus rather than
  conflict with it, and does not touch `tools/canaries/**`.

## 8. Residual risk / open items for the reviewer

1. **Goldens are environment-specific.** A Node/Playwright/Chromium bump may legitimately move records. The
   README says to re-baseline deliberately; there is no CI job pinning the browser version (no workflow file is
   in scope for this issue).
2. **`startX` teleports** stream terrain to an offset to reach distant features. Distance in a record is
   relative to the canary origin, not a world position — worth confirming the reviewer is comfortable that this
   cannot be mistaken for real gameplay distance.
3. **No CI wiring.** The gate is runnable (`npm`-free, `node tools/canaries/feel-diff.mjs`) but not yet invoked
   by a workflow. Adding a workflow was explicitly out of scope; the testable exit codes are the seam for it.
4. **The harness trusts `window.__bbGame`.** It holds `RunScene.update` and replaces `inputRouter.poll` to
   inject a tape. That is deliberate and read-only w.r.t. gameplay state, but it does mean the canaries run the
   *built bundle*, so goldens are only valid for the build that produced them.

## 9. Ask

Marvin: please have **Gal Friday** review PR #158. This PR is intentionally left at the review gate — no merge
will happen from my side. On approval I merge, verify the landed diff and confirm issue #117 closes.
