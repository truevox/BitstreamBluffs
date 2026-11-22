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
| Seed plan + record validation (pure) | `tools/exploits/lib/seed-plan.cjs` | 29 unit tests; added to fix the PR #187 blocker (§9) |
| Record completeness audit (pure) | `tools/exploits/lib/record-audit.cjs` | 26 unit tests; added because completeness used to be self-reported (§11) |
| Harness docs | `tools/exploits/README.md` | policies, thresholds, `--seeds` contract, unmeasured-arm rule, completeness rule, honest limits |
| Generated comparison report | `docs/exploit-factory-2026-11-21.md` | real 8-seed run, committed (regenerated through the fixed path, §9) |
| Unit tests | `tests/exploits/exploit-stats.test.js`, `tests/exploits/seed-plan.test.js`, `tests/exploits/record-audit.test.js` | `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/exploits` → **109 passed** |
| End-to-end CLI wiring tests | `tests/exploits/runner-cli.test.js` | real CLI against a stub sim in a temp root; 27 tests |

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

Negative controls, each asserted in `tests/exploits/exploit-stats.test.js` (27 tests, all passing). Seed identity and
record-completeness controls live beside them in `tests/exploits/seed-plan.test.js` (29 tests) and
`tests/exploits/runner-cli.test.js` (8 tests, real CLI path) — see §9:

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
(27 passed at that head, scope confirmed clean) and they are reported in §1 and §6. The current count at this head
is 73 across three suites (§9, §10).

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
4. **`node_modules` in this worktree is a symlink** to the #117 worktree's install (disk was at 93% when re-checked,
   9.5 G free). It is gitignored and not part of the diff, but a fresh clone needs `npm install` before the harness
   runs.
5. **`tools/sim/browser.js` gained an optional fatigue path on `origin/main` after this branch's base** (`8657962`):
   `makeHopNoise(..., { fatigue })` and a version string, both reachable only when `o.noiseProfile !== undefined`.
   The exploit runner never passes `--noiseProfile` (verified in `run-exploits.mjs`: it passes `--seeds`, `--policy`,
   `--maxM`, `--maxSec`, `--workers`, `--out`, `--biomeMask` and per-policy args only), so there is no semantic
   conflict. But the 8-seed report was generated against the base, not against current `main` — re-running it on a
   rebased head would be a fresh measurement, not a reproduction of the committed one.

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

**Versioning note:** this is the first commit on this branch with a `CHANGELOG` and `package.json` entry — `v2.15.2`.
Earlier commits here and the tooling-only PRs (`#190`, `#195`, `#196`) shipped without one because they changed no
player-visible behaviour; §11 changes the documented exit-code contract of the harness, which the repo's commit rules
count as behaviour-changing, so it gets an entry rather than another open question.

## 10. Second pass: three more ways a failed arm could be read as a result (FIXED)

Gal Friday's fix request ended with *"ensure partial/failed arms can never be called valid/dominant."* The §9 work
made the *record gate* fail closed, but the report layer still had three ways to present an unmeasured arm as a
measurement. All three reproduced first, then fixed.

| # | defect | how it was reproduced | fail-open? |
| --- | --- | --- | --- |
| 1 | `--reuse` exited **0** on an incomplete record | re-reported a record with a dropped `flip` arm: `EXIT=0`, report said "incomplete" only in prose | Yes — `&&` chains, CI steps and scripts saw success |
| 2 | FAILURES printed `exited incomplete: \`undefined\`` | validation failures carry `detail`, but the template read only `f.stderr` | Not a false pass, but it made the failure unactionable — a report that names a failure and cannot say why |
| 3 | a failed arm got a **statistical verdict** ("Not dominant. only 0 paired seed(s)") instead of being called unmeasured | re-used a record with a failed `flip` arm | Yes — reads as *no exploit found* when nothing was measured |

Defect 3 was the substantive one. "Not dominant" is a claim about a completed comparison; an arm with no record has
not been compared at all. A failed **baseline** was worse: every candidate still received a "Not dominant" verdict
rendered against an absent baseline — a statistical statement about nothing.

**Fix:**

- `--reuse` sets `exitCode = 2` when the record it reads already carries failed arms, and says so on stderr. A
  re-reported partial run is still partial.
- The FAILURES block prefers `detail`, falls back to `stderr`, and prints `no reason recorded` rather than
  `undefined` when neither is present.
- A failed arm gets **no verdict, no metrics-table row and no engagement line** — only an *Unmeasured* block naming
  which side was missing (the arm, or the baseline). `baselineRuns.length === 0` counts as a failed baseline even
  without an explicit failure entry, so a truncated record cannot slip through.
- The `_No candidate policies were run; only the baseline._` note now only appears when that is actually true,
  instead of contradicting the Unmeasured block above it.

**Evidence at this head:**

```
$ node tools/exploits/run-exploits.mjs --reuse <clean record>          -> EXIT=0
$ node tools/exploits/run-exploits.mjs --reuse <record with 1 failed arm>
                                                                       -> EXIT=2
   re-reported record carries 1 failed arm(s); this report is incomplete

## FAILURES
- `flip` failed (incomplete): `expected 4 run(s), record has 2`

### `flip` vs `handsOff`
**Unmeasured — the arm did not produce a usable record.** No dominance verdict is offered: a missing
measurement is not evidence of absence. See FAILURES below.
```

Metrics table in that run lists `handsOff` only — the failed `flip` arm has no row, instead of `| flip | 0 | n/a |`.

`jest tests/exploits`: **73 passed** (27 + 29 + 17). Nine new tests cover the three defects through the real
`--reuse` CLI path, including a positive case (`DOMINANT on score` still appears for a genuinely dominant
candidate) so the guard cannot degrade into "always say unmeasured".

**Self-inflicted error worth recording:** my first attempt at the metrics-table guard declared `failedPolicies`
twice in the same function scope, and a follow-up patch deleted the `if (baselineFailed) {` opener while keeping its
body. Both were caught by `node --check` and the test suite before commit — but they are why the suite is run at the
end of each edit round rather than once at the end.

## 11. Third pass: incompleteness was self-reported (FIXED)

The §10 work made a record's *stated* failures fail closed. It still trusted the record to state them. Four
incomplete records re-reported through `--reuse` as complete measurements (exit 0, full table, verdicts rendered)
because `failures[]` was empty:

| # | shape | reproduced (evidence) | old behaviour |
| --- | --- | --- | --- |
| 1 | an arm missing entirely, no failure entry | `24 runs, failures=0` from the 32-run record with `flip` dropped | exit 0, full table, `flip` silently absent |
| 2 | every arm cut to 4 of the 8 planned seeds | `16 runs, failures=0`, `seedList` still claiming 8 | exit 0, 4-run medians in an "8-seed" table |
| 3 | a duplicated seed inside one arm | `32 runs`, `flip` runs on sim-01 twice | `exit 1` + a **usage** banner (it threw inside `aggregate`) |
| 4 | a seed nobody planned inside one arm | `32 runs`, `hop` on sim-99 | exit 0, that arm compared anyway |

The reproducer is reproduced verbatim below; it clones the committed 32-run record and re-reports each variant.

**Root cause:** completeness was read from `record.failures`, which is the record's *self-report*. Before the audit,
the only thing that ever populated that list was the fresh run path; `--reuse` never re-derived anything.

**Fix** — new pure `tools/exploits/lib/record-audit.cjs`:

- `auditRecord(record)` derives completeness from the data. Every arm the record claims to have run must carry
  **exactly the planned seed identities, once each**. A missing arm, a shrunken arm, a duplicated seed and an
  unplanned seed are all per-arm findings, so the report can call that arm *unmeasured* and keep the rest.
- Defects that make every count ambiguous **reject the whole record**: a run attributed to no arm, an unnamed or
  duplicated `policySpec`, a plan that lists one seed twice, a numeric count outside the runner's 1–64 range, no
  `runs[]`. The report then prints `## RECORD REJECTED — no comparison is offered` with the reasons and no table.
- The exit code and the verdicts now come from the same audit, on both the fresh and `--reuse` paths, so the status
  cannot disagree with the printed report.
- The plan is recovered strongest-first: `args.seedList` (exact), then a numeric `args.seeds` expanded exactly as the
  sim expands it, then — only if neither exists — the union of what the arms ran, flagged `unverifiableSeeds` and
  stated in the report's limits. **A numeric-count legacy record is therefore fully verifiable**, which is most of
  the pre-`seedList` files. A uniformly-truncated record with *neither* a `seedList` nor a count can still pass;
  that is stated in the README and by the report, not hidden.
- `mergeAuditFailures` folds the audit into `failures` before the record is written, so the file on disk always
  agrees with itself. The fresh path refuses to write a record whose data is internally inconsistent.

**Evidence at this head:**

```
full arm dropped, no failure entry       24 runs, failures=0  ->  EXIT=2
every arm truncated to 4 of 8 seeds      16 runs, failures=0  ->  EXIT=2
one arm has a duplicated seed            32 runs, failures=0  ->  EXIT=2  (was exit 1 + usage banner)
one arm carries an unplanned seed        32 runs, failures=0  ->  EXIT=2
committed 32-run clean record (--reuse)                        ->  EXIT=0, report identical to the committed file
legacy 8-seed record, no seedList, count=8 (--reuse)           ->  EXIT=0, plan recovered from the count
same legacy record truncated to 4 seeds (--reuse)              ->  EXIT=2, all four arms named
```

`jest tests/exploits`: **109 passed** (27 + 29 + 17 + 26 new audit tests + 10 new CLI tests). The clean-case tests
exist specifically so the guard cannot decay into "always say incomplete": a full record still exits 0, still
renders `DOMINANT on score` for a genuinely dominant candidate, and the committed report is byte-identical.

**A fixture bug this caught:** the four older `fabricatedRecord` fixtures claimed `seeds: 8` while carrying two runs.
They were only ever meant to exercise a failed-arm path, but they were themselves the inconsistency the audit now
rejects — so the audit was right to flag them and the fixture was wrong. It now derives the plan from the runs.

`npm run test`: 2718 passed, 8 failed in the same 7 suites that fail with these changes stashed (`env-detection`,
`memory-usage`, `multi-chunk-terrain`, `terrain-interaction`, `input-playback`, `combo-scoring`, `start-scene` —
pre-existing, none in `tools/exploits/**` or `tests/exploits/**`). `npm run build`: ✓ built. Reproducer after the
fix: `node tools/exploits/repro-reuse-incomplete.mjs` → all 4 shapes exit 2, reproducer exit 0; the same script at
`HEAD` before this change → `3/4 … CLEAN — fail-open`, exit 1.

Version: `v2.15.2` (`CHANGELOG.md` + `package.json`). Behaviour-changing by the repo's own rule because it changes the
harness's documented exit-code contract; no gameplay, physics or balance change, `tools/sim/**` untouched.

## 12. Fourth pass: the review's exact shape, and three neighbours (FIXED)

Gal Friday's `645a5c6` finding was correct and is fixed here. Her shape — `args.policies: ['handsOff','flip']`,
`seedList: ['sim-01','sim-02']`, both `policySpecs`, `runs` carrying only the two `handsOff` records, `failures: []` —
exited 0 at `645a5c6` with a fabricated `| flip | 0 |` metrics row and an *Unmeasured* note but no failure entry and no
nonzero status. At this head it exits 2, prints no `flip` row, renders no verdict, and names the arm in FAILURES.

Rather than fix only the reported shape, I drove twelve defective records through the real CLI at both heads. Eleven of
the twelve failed open at `645a5c6`; all twelve are refused here:

| # | shape | `645a5c6` | this head |
| --- | --- | --- | --- |
| 1 | an arm missing, no failure entry | exit 0 | exit 2 |
| 2 | every arm cut to 3 of 6 seeds | exit 0, verdict rendered | exit 2 |
| 3 | duplicated seed inside an arm | exit 1 + usage banner | exit 2 |
| 4 | seed nobody planned | exit 0, arm compared | exit 2 |
| 5 | **the review's exact shape** | exit 0, fake `\| flip \| 0 \|` row | exit 2, no row, no verdict |
| 6 | same, `failures` key absent entirely | exit 0 | exit 2 |
| 7 | **the BASELINE arm missing** | exit 0, candidates unpaired | exit 2, no verdicts |
| 8 | candidate right name, too few seeds | exit 0, verdict rendered | exit 2 |
| 9 | candidate right COUNT, wrong identities | exit 0, verdict rendered | exit 2 |
| 10 | run attributed to no `policySpec` | exit 0, verdict rendered | exit 2, record rejected |
| 11 | **record names no baseline at all** | exit 0, verdict rendered | exit 2, record rejected |
| 12 | **legacy record with no recoverable plan** | exit 0, verdict rendered | exit 2, record rejected |

Rows 7, 11 and 12 are the ones the first audit pass still let through, and they are the substantive additions here:

- **Baseline presence is now a whole-record rule.** A record with no `args.baseline`, or whose baseline has no
  `policySpec`, is rejected: this harness exists to answer "does a candidate beat the baseline", so a record that names
  none cannot support any comparison. Previously it produced candidate rows with nothing to pair them against.
- **A record must carry a recoverable seed plan.** `args.seedList`, a numeric `args.seeds`, or a comma-list
  `args.seeds` — all three are exact identities. A record with none is now **rejected** rather than cross-checked
  arm-against-arm. That fallback was the last fail-open: every arm agreeing on a short seed set is precisely what a
  uniformly truncated record looks like, so "the arms agree" is not evidence and is no longer accepted as such. This
  removes the residual limit §11 disclosed instead of documenting it a second time.
- **A comma-list `args.seeds` is now a plan, not a hint.** It is treated as exact identities (with duplicate
  detection), so older records written with `--seeds sim-01,sim-03,...` are fully verified rather than downgraded.

The two branch-only tests that pinned the old `union` behaviour were rewritten to pin the rejection instead.

**Evidence at this head** (`node tools/exploits/repro-reuse-incomplete.mjs`, committed):

```
12 defective shapes  -> every one exits 2, 0 statistical verdicts
POSITIVE full valid record                  -> exit 0, table, verdict
POSITIVE genuinely dominant record          -> exit 0, "DOMINANT on score"
same script at 645a5c6                      -> "11 case(s) behaved wrongly", exit 1
```

The positive cases are there so the guard cannot quietly become "always say incomplete": a full record still exits 0
and a genuinely dominant candidate still renders `DOMINANT on score`.

Real CLI, non-reuse, both seed forms (the dispatch's "preserve numeric and comma-list" requirement):

```
--seeds sim-01,sim-02 --policies handsOff,flip  -> EXIT 0, 2 arms × 2 seeds, record written
--seeds 3            --policies handsOff,flip  -> EXIT 0, seedList [sim-01..sim-03], 6 runs, 0 failures
all 7 committed tools/exploits/out/run-*.json  -> unchanged behaviour (6× exit 0; the one pre-existing
                                                  failed-arm record still exit 2)
```

`npm test -- --runInBand tests/exploits`: **115 passed**, 4/4 suites. `npm run build`: ✓. Reproducer: exit 0.

Rebased onto `origin/main` (`v2.15.3`, the PWA slice) before handoff: the branch had a `CHANGELOG.md`/`package.json`
conflict in the version line only. The two exploit-factory commits are consolidated under a single **`v2.15.4`**
entry; no file outside `tools/exploits/**`, `tests/exploits/**`, `CHANGELOG.md`, `package.json` and
`.friday/issue-76-review.md` is touched, and `CHANGELOG.md`/`package.json` are edited only to add that entry.

## 13. Ask

Marvin: please have **Gal Friday** review PR #187 at the new SHA, including §12. Left at the review gate — no merge
from my side, and I am not claiming her review passed. On her approval I merge, verify the landed diff and confirm
#76's acceptance criteria (a repeatable seed suite and a cross-policy metrics report, with no recommendation attached).

