# Issue #76 — Exploit Factory — review report

**Status:** implementation complete, at the review gate. **Do not merge without Gal Friday's approval.**
**Orchestrator:** Home Friday (CT223) · **Branch:** `friday/issue-76-home-exploits-20261121` · **PR:** #187
**Base:** `origin/main` @ `8657962`
**Implementer:** Home Friday (direct) · **Independent review:** Deep Think read-only — verdict **REJECT**, findings
fixed (see §7). No files were edited by the reviewer.

Every number below came from a command run in this worktree on 2026-11-21. The committed report
`docs/exploit-factory-2026-11-21.md` is generated output, not prose I typed.

---

## 1. What this delivers

| Deliverable | Path | State |
| --- | --- | --- |
| Policy-matrix runner | `tools/exploits/run-exploits.mjs` | runs 5 named policies through the real sim; exit 0/2/1 |
| Judgement rules (pure) | `tools/exploits/lib/exploit-stats.cjs` | 27 unit tests |
| Harness docs | `tools/exploits/README.md` | policies, thresholds, honest limits |
| Generated comparison report | `docs/exploit-factory-2026-11-21.md` | real 8-seed run, committed |
| Unit tests | `tests/exploits/exploit-stats.test.js` | `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/exploits` → 27 passed |

**Scope:** `tools/exploits/**`, `tests/exploits/**`, `docs/exploit-factory-*.md`, `.gitignore` (one entry for the
regenerable `tools/exploits/out/`). **No** `src/**`, `js/**`, `public/**`, `package.json` or workflow changes.
**No balance change, no physics change** — the issue says balancing waits for approval, and this delivers the
"report metrics across competing policies" half of its acceptance criteria and stops there.

## 2. Why this builds on `tools/sim` instead of a second browser harness

There is already a deterministic headless simulator (`tools/sim/run.mjs`) that pins `Math.random`, `Date`, the
daily rule, `localStorage` and audio, and exposes switchable policies (`handsOff | flip | hop | stallProbe |
terrain`). Writing another browser driver would have duplicated a solved problem and created a second definition of
"deterministic run". So the factory is a **layer on top**: same sim, same pinned conditions, comparing policies
against each other rather than a run against a golden.

Verified the base actually works before building on it:
```
$ node tools/sim/run.mjs --seeds 2 --policy handsOff --maxM 400 --maxSec 30 --workers 1
sim-01  crash:hazard  312.3m ... sim-02  crash:hazard  398.3m
runs 2  end {"crash:hazard":2}
```

## 3. The real result (8 seeds, 4 policies, 3000 m / 90 s cap)

Full generated report: `docs/exploit-factory-2026-11-21.md`.

| policy | runs | score median [p25–p75] | distM median | maxAirtimeMs | end reasons |
| --- | --- | --- | --- | --- | --- |
| handsOff | 8 | 315.5 [279.8–322.8] | 316.1 | 921 | crash:hazard×8 |
| flip | 8 | 950.5 [325.8–1572.8] | 581.6 | 967 | badLanding×3, hazard×5 |
| flipLate | 8 | 949 [325.8–1384.3] | 548.5 | 967 | badLanding×3, hazard×5 |
| hop | 8 | 941 [317–3840.5] | 721.8 | 1133 | hazard×6, timeout×2 |

**Verdict: no policy is dominant**, and the harness states why per candidate:

| candidate | verdict | the actual reason |
| --- | --- | --- |
| `flip` | not dominant | won 5/8 paired seeds (63%, need 75%), tied on 3/8 (38% > 20% cap) |
| `flipLate` | not dominant | same shape, 5/8 |
| `hop` | not dominant | won 4/8 (50%), tied on 4/8 |

Note the correct reading of "not dominant": it means **not demonstrated on this seed set**, which is a weaker claim
than "proven to be noise". The report says so explicitly.

Three findings worth a reviewer's attention:

1. **`flip` and `flipLate` are nearly indistinguishable** (median 950.5 vs 949, identical win/tie pattern). Two
   seeds differ, not one: sim-01 (1668 vs 1332) and sim-03 (1318 vs 1315). Aggregates converge because a 120 ms
   sloppier release rarely changes the confrontation, which is the sensitivity control working — but "identical
   aggregate" is not proof of "timing-independent mechanism", and an earlier draft of this report overstated it as
   "only sim-01 differs". Corrected by the reviewer.
2. **`hop` has the highest maximum (3975) and the highest median paired gain (621), yet wins only half its seeds.**
   That is exactly the case where "biggest number in the table = exploit" is wrong.
3. **All four policies show extra recorded activity on 8/8 seeds**, including `hop` on the seeds where it ties the
   baseline. So `hop`'s ties are **actions that earned nothing**, not idleness. My earlier claim that it "never
   engaged" was contradicted by my own diagnostic and is false — see §7.

## 4. The judgement rules, and the negative controls that pin them

`judgeDominance` requires **all** of: ≥6 paired *distinct* seeds · ≥75% of paired seeds won · median paired gain ≥
the baseline's own p25–p75 spread · ≤20% ties. Pairs are matched **on the same seed**; unpaired seeds are dropped,
not counted as ties.

Thresholds are conservative on purpose. An early draft used a 3-seed minimum and this same 8-seed run called
`flip` "DOMINANT" off 4 paired seeds (3 wins, 1 tie). That is too thin to be called a reproduction, so the
minimum was raised to 6 before anything was committed.

Negative controls, each asserted in `tests/exploits/exploit-stats.test.js` (27 tests, all passing):

| control | asserted |
| --- | --- |
| **one seed repeated six times** | **hard error** — a repeated seed is the same trial, not six |
| a repeated baseline seed | hard error |
| a run with no seed | hard error |
| fewer paired seeds than the minimum | never dominant |
| one huge win + three losses | wins counted per seed, not summed |
| gain inside the baseline's own p25–p75 spread | not dominant (cannot be separated from variation) |
| wins only half the seeds despite a big median | not dominant |
| too many ties | not dominant |
| median gain of exactly zero | not dominant |
| non-finite / missing scores | dropped, never coerced to 0 |
| one-sided pair (baseline score missing) | **no gain priced**, never `candidate - null` |
| unknown metric name | hard error, not a silent fallback to `score` |
| zero baseline spread | `zeroSpread` flag raised, not presented as tested evidence |
| a *consistent, clearly larger* gain on 6 distinct seeds | **is** dominant (positive case) |

## 5. What this is NOT

- **Not adversarial search.** Scripted policies only. Absence of dominance here is not proof the game is
  unexploitable; only ~1 of 4 patterns in the issue has any direct policy, and the airbrake/parachute *canopy*
  combinations are not covered at all.
- **Not a balance recommendation.** Explicitly none. Any change needs its own issue and review.
- **Not live gameplay.** The sim neutralises the daily rule, audio and UI. Live runs differ.
- **Not a fairness proof.** "Dominant on score" is a statistical statement about this seed set and this build.
- **`hop`'s two `timeout` outcomes** are runs that hit the 90 s sim cap at 3–4 km, not crashes; they inflate its
  score distribution and should be read as "survived longer", not "scored better per metre".

## 6. Overlap

- `tools/canaries/**` / `tests/canaries/**` (issue #117, PR #158): untouched, not imported, not modified.
- `tools/sim/**` (#70 / #127 / #131 PRs #181/#183/#184 all touch it): **not modified** — this only *invokes*
  `tools/sim/run.mjs` as a subprocess. That was deliberate precisely because three open PRs are editing that
  directory right now.
- Team A (#152/#116/#118/#123) and Team B (#119/#140/#120/#115): nothing read or written.
- `.friday/issue-76-start.md` starter is deleted in the final commit, as the lifecycle requires.

## 7. Independent review — verdict REJECT, and what it caught

A Deep Think read-only pass was run against this worktree. It returned **REJECT** with three blocking findings. All
three were real; I reproduced each before fixing rather than taking the reviewer's word.

| # | finding | reproduced? | fix |
| --- | --- | --- | --- |
| 1 | **Duplicate seeds masquerade as independent trials.** One seed repeated six times returned `dominant: true` — six "wins" from one trial. Fail-OPEN. | **Yes** — `judgeDominance` returned `dominant=true, paired=6, wins=6` from a single seed. | `uniqueBySeed()` now throws on any duplicate or seedless run in either arm, and `aggregate()` refuses too. Verified: now throws. |
| 2 | **Engagement misreported activity as intent.** It compared air-phase *totals* and *distinct trick names*, then the report translated "quiet" into "found no opportunity". A policy that acts, crashes earlier and scores less was called idle. | **Yes** — committed diagnostic said hop acted on 8/8 seeds while my report claimed it "never engaged". | Counts trick **occurrences**; renamed to `active`/`quiet`; report text now says "measures recorded activity, NOT whether the policy tried". |
| 3 | **Zero-exit subprocess mistaken for a complete measurement.** Runner accepted empty/short/duplicated records and could still exit 0. | **Yes** — validation gate rejects short (6/8), duplicate-seed and missing-seed records; accepts clean 8/8. | Runner validates count + seed uniqueness before an arm may influence a verdict; README exit contract corrected. |

Non-blocking findings also fixed: `medianGainWhenActed` coerced a missing score to 0 via `?? 0` (now requires both
sides numeric); "not distinguishable from seed noise" overstated a failed threshold (now "cannot be separated from
variation", and "not demonstrated" ≠ "proven noise"); `zeroSpread` now surfaced; `stallProbe` noted as wired but not
exercised.

**Reviewer's arithmetic check passed:** flip 5/8, flipLate 5/8, hop 4/8; paired median gains 506 / 504.5 / 621 —
all matching the committed report. Its corrections to my prose (§3 items 1 and 3) were accurate and are now fixed.

**Reviewer limitation, stated honestly:** it could not execute commands (`approval policy is never`), so it ran
neither Jest nor `git diff`. Its test-count and scope claims are therefore unverified by it — I ran both myself
(27 passed; scope confirmed clean) and they are reported in §1 and §6.

## 8. Residual risk / open items

1. **Seed set is small (8).** The verdicts are correspondingly blunt: everything reads "not dominant". A 24-seed run
   would sharpen the `flip` question (5/8 → is it really ~63%?). Runtime is roughly 4 min for 4 policies × 8 seeds
   at 3000 m on 3 workers, so 24 seeds is cheap — but not run in this bounded session.
2. **`stallProbe` was written but not exercised in the committed report.** It reports recovery behaviour rather than
   a score, and its 90 s/3000 m parameters need a shorter, gentler run to be meaningful. The spec exists and is
   wired; the evidence for it does not yet.
3. **`minBsodGapPx` is in `METRICS` but the sim does not emit it** (it is a canary-harness field), so its column is
   always `n/a`. Left in deliberately so the metric can be wired when the sim reports it; worth confirming a
   reviewer prefers that to removing it.
4. **`node_modules` in this worktree is a symlink** to the #117 worktree's install (disk is at 89%, 16 G free). It is
   gitignored and not part of the diff, but a fresh clone needs `npm install` before the harness runs.

## 9. PR #187 blocker: `--seeds a,b` marked valid runs incomplete (FIXED)

Gal Friday's review found the runner's own seed handling reproduced wrongly. Reproduced first, then fixed.

```
$ node tools/exploits/run-exploits.mjs --seeds sim-01,sim-02 --policies handsOff --maxM 100 --maxSec 5 --workers 1
=== handsOff (policy handsOff)
  FAILED (expected sim-01,sim-02 run(s), record has 2)
...
| handsOff | 0 | n/a | n/a | n/a | n/a |
EXIT=2
```

**Root cause:** one line —

```js
const seeds = a.seeds && String(a.seeds).includes(',') ? String(a.seeds) : intArg(...);
...
if (got.length !== seeds) { /* "incomplete" */ }
```

For a list, `seeds` stayed the raw CLI **string**, so `2 !== 'sim-01,sim-02'` was always true. Two good runs were
thrown away, the arm contributed nothing, and the harness exited 2 on a valid command. The same line also silently
lost every identity check: the count was the only thing compared, so a record with the right number of runs and the
wrong seeds passed.

**Fix** — new pure `tools/exploits/lib/seed-plan.cjs`:

- `planSeeds(raw)` resolves the value **once**, before anything runs: `--seeds 8` → `sim-01..sim-08` (the sim's own
  naming, pinned by a test that extracts `expandSeeds` out of `tools/sim/run.mjs` and compares), `--seeds a,b` →
  exactly `['a','b']`. The runner then always passes the sim an **explicit list**, so the two expansions cannot
  drift apart.
- `validateRecord(rec, {seeds, policy})` requires **exactly** the planned identities, once each, from the requested
  policy. Count, membership, duplication and provenance are all checked.
- Fail-closed usage errors (exit 1, before a browser starts): duplicate seeds, empty entries (`a,,b`, `a,`, `,a`),
  bare `--seeds` (which parses as the string `true`), non-integer counts, and names that would break the report
  table or the quoting round trip.

`tools/sim/run.mjs` is **not modified** — the fix is entirely on the calling side, which matters because three other
PRs are editing that directory.

**Evidence (all commands run in this worktree):**

| check | result |
| --- | --- |
| reviewer's exact command, after | `EXIT=0`, `2 run(s)`, report table `handsOff \| 2 \| 100 [100-100] \| 100.2 …` |
| `--seeds 2` (numeric, unchanged behaviour) | `EXIT=0`, `args.seedList = ['sim-01','sim-02']` |
| `sim-01,sim-01` / `sim-01,,sim-02` / `sim-01,` / `true` / `0` / `8.5` | each `EXIT=1` with a named reason, no subprocess, no record |
| real headless 4-seed list, 2 policies (`sim-01,sim-03,sim-05,sim-07`, 600 m/40 s) | `EXIT=0`, 8 runs, `failures: []`, pairs on sim-01/03/05/07 only |
| regenerated 8-seed committed report | **byte-identical** to the committed one except the header line |
| `jest tests/exploits` | **64 passed** (was 27): 27 existing + 29 `seed-plan` + 8 `runner-cli` |
| `npm run test` | 2672 passed, 9 failed — the same 7 suites / 9 tests fail with my changes stashed (pre-existing) |
| `npm run build` | ✓ built (217 modules) |

`tests/exploits/runner-cli.test.js` is the wiring proof, not just a rule proof: it copies the real CLI into a temp
root with a **stub** `tools/sim/run.mjs`, so the full path (parse → plan → subprocess → validate → exit code) runs
with no browser and no game physics, and it drives records the real sim should never produce — short, duplicated,
substituted, `no results[]` — each asserted to be a failed arm with exit 2 and zero runs counted. The unit file also
pins the **before** comparison itself (`2 !== 'sim-01,sim-02'` is `true`) so the defect cannot return as a
"simplification".

**Versioning note:** no `CHANGELOG`/`package.json` bump. This branch and the tooling-only PRs already merged
(`#190`, `#195`, `#196`) all ship without one — there is no gameplay or player-visible change here. Flagging it
explicitly rather than deciding it quietly: if Gal Friday wants a `v2.15.2` tooling entry, say so and I will add it.

## 10. Ask

Marvin: please have **Gal Friday** review PR #187. Left at the review gate — no merge from my side. On approval I
merge, verify the landed diff and confirm #76's acceptance criteria are met (a repeatable seed suite and a
cross-policy metrics report, with no recommendation attached).
