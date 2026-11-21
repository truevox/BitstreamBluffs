# Issue #76 — Exploit Factory — review report

**Status:** implementation complete, at the review gate. **Do not merge without Gal Friday's approval.**
**Orchestrator:** Home Friday (CT223) · **Branch:** `friday/issue-76-home-exploits-20261121` · **PR:** #187
**Base:** `origin/main` @ `8657962`
**Implementer:** Home Friday (direct); independent review not yet performed (see §7)

Every number below came from a command run in this worktree on 2026-11-21. The committed report
`docs/exploit-factory-2026-11-21.md` is generated output, not prose I typed.

---

## 1. What this delivers

| Deliverable | Path | State |
| --- | --- | --- |
| Policy-matrix runner | `tools/exploits/run-exploits.mjs` | runs 5 named policies through the real sim; exit 0/2/1 |
| Judgement rules (pure) | `tools/exploits/lib/exploit-stats.cjs` | 17 unit tests |
| Harness docs | `tools/exploits/README.md` | policies, thresholds, honest limits |
| Generated comparison report | `docs/exploit-factory-2026-11-21.md` | real 8-seed run, committed |
| Unit tests | `tests/exploits/exploit-stats.test.js` | `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/exploits` → 17 passed |

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

**Verdict: no policy is dominant**, and the harness says why rather than leaving it as a vibe:

| candidate | verdict | the actual reason |
| --- | --- | --- |
| `flip` | not dominant | won 5/8 paired seeds (63%, need 75%), tied on 3/8 |
| `flipLate` | not dominant | same shape, 5/8 |
| `hop` | not dominant | won 4/8 (50%), tied on 4/8 |

Two things worth flagging to a reviewer, because they are *findings* and not test noise:

1. **`flip` and `flipLate` are nearly indistinguishable** (median 950.5 vs 949, identical win/tie pattern, only
   sim-01 differs: 1668 vs 1332). That is the sensitivity control doing its job: a 120 ms sloppier release barely
   changes the outcome, so the gain on those seeds comes from *taking the flip at all*, not from timing it well.
   A fixture that measured only `flip` would have invited the wrong conclusion.
2. **`hop` buys the most raw score (median 941, max 3975) but wins only half its seeds** — on sim-03/04/07/08 it is
   identical to hands-off, meaning the policy never engaged. This is exactly the case where a naive
   "highest median score = exploit" claim would be wrong, which is why the engagement diagnostic exists (§4).

## 4. The judgement rules, and the negative controls that pin them

`judgeDominance` requires **all** of: ≥6 paired seeds · ≥75% of paired seeds won · median paired gain ≥ the
baseline's own p25–p75 spread · ≤20% ties. Pairs are matched **on the same seed**; unpaired seeds are dropped, not
counted as ties.

Thresholds are conservative on purpose. An early draft used a 3-seed minimum and this same 8-seed run called
`flip` "DOMINANT" off 4 paired seeds (3 wins, 1 tie). That is too thin to be called a reproduction, so the
minimum was raised to 6 before anything was committed — the stricter rule is what produced the verdict above.

Negative controls, each asserted in `tests/exploits/exploit-stats.test.js` (17 tests, all passing):

| control | asserted |
| --- | --- |
| fewer paired seeds than the minimum | never dominant |
| one huge win + three losses | wins counted per seed, not summed |
| gain inside the baseline's own p25–p75 spread | not dominant ("indistinguishable from seed noise") |
| wins only half the seeds despite a big median | not dominant |
| too many ties | not dominant |
| median gain of exactly zero | not dominant |
| non-finite / missing scores | dropped, never coerced to 0 |
| unknown metric name | hard error, not a silent fallback to `score` |
| a *consistent, clearly larger* gain | **is** dominant (positive case, so the judge can still say yes) |

The engagement diagnostic is **post-hoc only** and never widens the verdict. It exists because a tie has two
meanings — "both scored the same" and "the policy found no opportunity" — and the second one measures the terrain,
not the policy.

## 5. What this is NOT

- **Not adversarial search.** Scripted policies only. Absence of dominance here is not proof the game is
  unexploitable; only ~1 of 4 patterns in the issue ("airbrake-parachute-flip loop", "stall", "unbounded airtime")
  has any direct policy, and the airbrake/parachute *canopy* combinations are not covered at all.
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

## 7. Residual risk / open items for the reviewer

1. **No independent review yet.** This code was written by the orchestrator directly, so the skill's "separate
   author and reviewer" rule is *not* satisfied. A Deep Think read-only pass is the intended next step; flagging
   rather than pretending it happened.
2. **Seed set is small (8).** The verdicts are correspondingly blunt: everything reads "not dominant". A 24-seed
   run would make the `flip` question sharper (5/8 → is it really ~63%?). Runtime is roughly 4 min for 4 policies
   × 8 seeds at 3000 m on 3 workers, so 24 seeds is cheap — but it was not run in this bounded session.
3. **`stallProbe` was written but not exercised in the committed report.** It reports recovery behaviour rather
   than a score, and its 90 s/3000 m parameters need a shorter, gentler run to be meaningful. The spec exists and
   is wired; the evidence for it does not yet.
4. **`minBsodGapPx` is in `METRICS` but the sim does not emit it** (it is a canary-harness field), so its column
   is always `n/a`. Left in deliberately so the metric can be wired when the sim reports it; worth confirming the
   reviewer prefers that to removing it.
5. **`node_modules` in this worktree is a symlink** to the #117 worktree's install (disk is at 89%, 16 G free).
   It is gitignored and not part of the diff, but a fresh clone needs `npm install` before the harness runs.

## 8. Ask

Marvin: please have **Gal Friday** review PR #187. Left at the review gate — no merge from my side. On approval I
merge, verify the landed diff and confirm #76's acceptance criteria are met (they are: a repeatable seed suite and a
cross-policy metrics report, with no recommendation attached).
