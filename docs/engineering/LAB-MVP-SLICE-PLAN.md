# Lab MVP vertical slice: engineering plan

Reviewed with gstack `/plan-eng-review` (v1.58.5.0) on 2026-11-28 against `main @ 1ca95c3`.
Scope chosen: **Lab MVP vertical slice** (Step 0 scope reduction of #24). Every decision below was
made explicitly by Marv; the option letter is recorded so nobody re-litigates it by accident.

Product context: the Lab is **premium-only** (Steam, web unlock, honor button, schools). Free web
players get one guided Lab run. That makes #24's "Web 1 slot" wording obsolete (see T13).

## Goal

Prove the hook before building the economy around it: a player-owned brain trains on the **real**
game, deterministically, in background workers, on Chromium, Firefox and WebKit, and the guided
first run reaches a real milestone inside its time budget on a weak machine.

## Decisions (locked)

| # | Topic | Decision |
|---|---|---|
| 0 | Scope | A: Lab MVP vertical slice. Defer leases, Potions, forfeit accounting, extra algorithms, Autopilot economy, Lab UI (#498) |
| 1.1 | Headless run | A: promote harness into `src/` with **strict** stubs (explicit allow-list of graphics-only no-ops; anything else throws in CI) + render-on/off fingerprint parity gate on policy-driven tapes |
| 1.2 | Model ABI v1 | A: brain decides every 4 sim ticks (30 Hz at `SIM_TICK_HZ = 120`) and holds its buttons in between; one pure `observe()` reads physics state only; action set = gamepad fields (push, tilt -1/0/+1, heli, hop, airBrake); brain files stamped with `abiVersion` + `SIM_REVISION` |
| 1.3 | Trainer | A: brain format + runtime = general feed-forward **graph** (NEAT-ready); v1 trainer = fixed-shape network + seeded evolution, in-house; NEAT is slice 2 on the same format |
| 1.4 | Interrupts | A: generations are atomic; checkpoint after every completed generation; interrupted generation re-runs from its checkpoint; UI says "resumed from generation N" |
| 2.1 | Scheduler location | A: move `episode-batch` + `worker-episode-batch` to `src/systems/lab/` (pure move PR), single copy |
| 2.2 | Error names | A: one frozen `src/systems/lab/labErrors.js` table (code, retryable, messageKey); test fails on unknown codes |
| 2.3 | Readability | B: Prettier + ESLint repo-wide, plus src-style Lab modules and two ASCII diagrams in code (guardrails below) |
| 3.1 | Browsers | A: golden training test + 300 s physics parity on Chromium, Firefox, WebKit, all matching the Node baseline |
| 3.2 | Guided run | A: fixed seed + starting population, pinned milestone ladder, Playwright proof on 6x CPU throttle, 1 worker |
| 3.3 | Hostile files | A: named-rejection unit tests + fast-check property fuzzing (dev-only dep) with a time cap |
| 4.1 | Worker cap | A: when memory is unknown (Firefox/Safari), measured ramp: +1 worker while per-worker speed >= 80% of solo and no errors, cap min(CPU cap, 4), remembered per device, drop to 1 on failure or play |
| 4.2 | Train mode | A: runner modes `train` (no fingerprints/recorder) and `verify` (full); champion re-verified each generation; benchmarked |
| 4.3 | Episode setup | A: measure setup vs sim time; per-worker deep-frozen content cache allowed; scene reuse forbidden unless a 1,000-reuse parity test passes |

### Prettier/ESLint guardrails (decision 2.3)

- One **format-only** PR, nothing else in it; add its commit to `.git-blame-ignore-revs`.
- ESLint autofix limited to non-semantic rules; anything that could change behavior is report-only.
- That PR must pass the full Jest suite, determinism goldens (pmath, matter-portable, savestate,
  sim-math-boundary) and `headless-render-parity-qa` / `real-runscene-worker-physics-qa` unchanged.
- Exclude vendored/generated files and recorded fixtures/goldens.
- Land it when the open-PR queue is near-empty and coordinate with Morgan's checkpoint, because it
  conflicts with every in-flight branch. Land it **before** Lab code starts so new code is born formatted.
- Title starts with `[skip netlify]` (AGENTS.md).

## What already exists (reuse, do not rebuild)

| Existing | Where | Used by this plan as |
|---|---|---|
| Real RunScene physics in a worker, 300 s cumulative parity (#122/#134) | `tools/lab/qa-real-physics-*.mjs`, CI `real-runscene-worker-physics-qa` | the base of the production headless runner (promoted, stubs made strict) |
| Render on/off parity | CI `headless-render-parity-qa` | extended to policy-driven tapes |
| Deterministic index-ordered scheduler, per-index seeds, all-or-nothing batches | `tools/lab/episode-batch.mjs` | moved to `src/systems/lab/`, drives each generation |
| Worker transport with abort/timeout | `tools/lab/worker-episode-batch.mjs` | moved; error strings mapped to `labErrors` |
| Brain JSON preflight (#450) | `src/systems/brain/brainFilePreflight.js` | first stage; ABI validator runs after it |
| SIM_REVISION policy (#452) | `src/systems/brain/brainRevisionPolicy.js`, `replay/ruleset.js` | stamp + compatibility verdicts |
| Local checkpoints + download (#451) | `src/systems/brain/localBrainCheckpoints.js` | per-generation checkpoints |
| Play-aware governor (#453) | `src/systems/lab/LabResourceGovernor.js` | admission; gains the unknown-memory ramp |
| Portable math + boundary test (#121) | `src/systems/pmath.js`, `tests/determinism/sim-math-boundary.test.js` (scans all of `src/`) | policy runtime uses pmath; automatically covered |
| Platform capability adapter (#441) | src | unchanged |

Nothing in this plan rebuilds physics, seeding, storage or admission.

## Architecture

```
 MAIN THREAD                                   WORKER (x N, governor-admitted)
 ┌──────────────────────────────┐              ┌────────────────────────────────────┐
 │ Trainer (generation loop)    │  episode     │ headlessRun(mode)                  │
 │  pop[gen] ──► episodeBatch ──┼─{idx,seed,──►│  strict stubs + real RunScene      │
 │       ▲        (index order) │   brain}     │  every 4 ticks:                    │
 │       │                      │              │    obs = observe(scene)  (physics) │
 │  rank by fitness             │◄─{idx,fit,───┤    act = policyRuntime(brain, obs) │
 │       │                      │   code}      │    hold act for 4 ticks            │
 │  verify champion (1 ep,      │              │  mode=train : fitness only         │
 │   mode=verify, fingerprints) │              │  mode=verify: + fingerprints       │
 │       │                      │              └────────────────────────────────────┘
 │  checkpoint(gen) ──► LocalBrainCheckpoints (IDB)
 │       │
 │  breed (seeded RNG from checkpoint state) ──► pop[gen+1]
 └──────────────────────────────┘
```

Brain file intake:

```
 file bytes ─► brainFilePreflight (#450: size, structure, no prototype poison)
           ─► abiValidator (#24): abiVersion, SIM_REVISION verdict, graph checks
                (DAG/no cycles, no dangling refs, finite weights, node/edge/fan-in caps)
           ─► ok {brain}  |  labErrors code (ABI_MISMATCH, SIM_REVISION_MISMATCH,
                                               BRAIN_TOO_LARGE, GRAPH_CYCLE, ...)
```

Generation state machine (atomic):

```
 IDLE ─start─► EVALUATING ─all episodes ok─► RANKED ─► VERIFIED ─► CHECKPOINTED ─► BRED ─┐
   ▲               │                                                                     │
   │               └─abort / worker crash / governor throttle / tab sleep─► INTERRUPTED  │
   │                                     (no partial results kept)            │          │
   │                     resume: reload last CHECKPOINTED gen ◄────────────────┘          │
   └──────────────────────────── next generation ◄──────────────────────────────────────┘
```

Inline ASCII diagrams required in code: the trainer generation loop (trainer module) and the
main-thread <-> worker message flow (worker transport).

## Model ABI v1 (summary for #24)

- Cadence: decide on ticks where `tick % 4 === 0`; hold the action until the next decision.
- Observation: fixed-length numeric vector from physics state only, via a single pure `observe(scene)`:
  sled velocity (x, y), angle, angular velocity, grounded flag, K terrain height samples ahead at
  fixed spacing, distance to nearest hazard ahead. K and spacing are part of `abiVersion` 1.
- Actions: push (bool), tilt (-1/0/+1), heli (bool), hop (bool), airBrake (bool), decoded from
  output nodes by fixed thresholds.
- Brain: feed-forward graph (nodes, connections with weights, fixed evaluation order), activation
  functions from pmath only.
- Stamp: `abiVersion`, `simRevision`, trainer id, generation, seed lineage.

## Test plan

```
CODE PATHS                                     REQUIRED TEST
[=] src/systems/lab/episodeBatch (moved)        repoint tests/lab/episode-batch.test.js
[=] src/systems/lab/workerEpisodeBatch (moved)  lab-real-worker-qa repointed
[+] headlessRun
  ├── allow-listed no-op graphics calls         unit: each is a no-op
  ├── unknown stub access → throws              unit: fails loudly with a named error
  ├── render on/off parity (policy tapes)       extend headless-render-parity-qa
  └── train vs verify modes                     unit: same fitness/crash/distance in both modes
[+] observe(scene)
  ├── fixed length, finite values               unit + golden vectors at fixed ticks
  └── physics-only                              unit: identical with stubRender on/off
[+] abiValidator
  ├── abiVersion / SIM_REVISION mismatch        unit → labErrors codes
  ├── cycle, dangling ref, NaN/Inf weight       unit → labErrors codes
  ├── node/edge/fan-in caps                     unit → BRAIN_TOO_LARGE
  └── anything else                             fast-check fuzz: ok-or-known-code, never throws/hangs, time cap
[+] policyRuntime
  ├── fixed eval order, pmath activations       golden outputs for fixed brains + inputs
  └── 4-tick hold                               unit
[+] trainer
  ├── loop evaluate→rank→verify→checkpoint→breed unit with a fake fitness fn
  ├── resume                                    E2E: kill at gen 4 and resume == 10 straight gens
  └── worker count independence                 E2E: same champion hash at 1 and 4 workers
[+] golden training test                        Node + Chromium + Firefox + WebKit, all equal Node
[+] cross-engine physics parity                 300 s parity on Firefox + WebKit (new CI jobs)
[+] labErrors                                   unit: every module emits only table codes
[+] governor unknown-memory ramp                unit: ramp, cap 4, back-off on error/play, remembered
[+] Prettier/ESLint PR                          full existing suite unchanged
USER FLOWS
[+] Guided run (headless, pre-UI)               golden milestone ladder + 6x-throttled 1-worker run hits
                                                first milestone inside budget
[+] Interrupted training                        E2E: resumes, reports "resumed from generation N"
[+] Import a friend's brain                     E2E: valid loads; hostile rejected with a code
```

## Failure modes

| Codepath | Realistic failure | Test? | Handling? | User sees |
|---|---|---|---|---|
| headlessRun | RunScene gains a stub-dependent gameplay call | strict-stub unit + parity CI | throws in CI | n/a (caught pre-merge) |
| observe() | reads a render-only field, live vs headless diverge | stubRender on/off unit | test gate | n/a |
| abiValidator | brain with 500k fan-in pins CPU | caps unit + fuzz | BRAIN_TOO_LARGE | clear rejection message |
| policyRuntime | native Math.tanh slips in, cross-engine drift | sim-math-boundary + cross-engine golden | test gate | n/a |
| trainer | tab sleeps mid-generation | resume E2E | re-run gen from checkpoint | "resumed from generation N" |
| trainer | IDB refuses durable write | existing checkpoint tests | STORAGE_REFUSED, pending export kept | clear warning + download offer |
| worker transport | worker OOM crash | lab-real-worker-qa | WORKER_CRASHED, generation re-runs, governor backs off | calm retry notice |
| governor ramp | Safari memory pressure kills tab at 4 workers | unit only | ramp stops on error | **risk: tab death is not catchable in-page**; mitigated by cap 4 and remembered result |
| guided run | slow device misses first milestone | 6x throttle E2E | honest "progress kept" path | real progress, no fake result |

Critical gaps (no test AND no handling AND silent): **none** after the decisions above. The Safari
tab-kill row is the one residual risk.

## NOT in scope (this slice)

- Sim-Slot leases, Power Potions, Stop & Reconfigure forfeit accounting: economy around the hook; build after the hook is proven (#509).
- NEAT (#508), MAP-Elites, Novelty, PBT, RL: slice 2+; the graph format makes NEAT a drop-in.
- Autopilot earnings/economy and offline Autopilot: separate slice; needs frozen-snapshot rules from #24.
- Lab UI (#498) and guided-run screens: built on top of this slice's headless proof.
- Remote/server workers and tournament server: not needed for local training.
- Player-tape contribution to training ("YOU TAUGHT THAT"): needs a measured provenance channel; later slice.
- Public Bazaar: decided out for Early Access; local import/export only.
- Scene reuse between episodes: forbidden until a 1,000-reuse parity test exists and the benchmark says it is worth it (#510, conditional).

## Parallelization

| Step | Modules | Depends on |
|---|---|---|
| T1 Prettier/ESLint | whole repo | — |
| T2 move scheduler | src/systems/lab, tools/lab, tests/lab | T1 |
| T3 labErrors | src/systems/lab | T1 |
| T4-T6 ABI, validator, fuzz, runtime | src/systems/brain, tests | T3 |
| T7 headlessRun | src/systems/lab, tools/lab, CI | T2, T3 |
| T11 governor ramp | src/systems/lab (governor only) | T1 |
| T14 cross-engine physics CI | .github, tools/lab | T1 |
| T8 trainer | src/systems/lab | T4-T7 |
| T9, T10, T12 goldens, guided run, benchmark | tests, CI, tools | T8 |

- Lane 0: T1 alone, first.
- Lane A: T2 → T7 (src/systems/lab runner).
- Lane B: T3 → T4 → T5 → T6 (errors, brain format, runtime).
- Lane C: T14 (CI only). Lane D: T11 (governor).
- Then T8, then T9 + T10 + T12 in parallel.
- Conflict flag: Lanes A, B (T3) and D all touch `src/systems/lab/`. Land T3 first (tiny), then A and D touch different files.

## Implementation tasks

- [ ] **T1 (P1, human ~1 day / CC ~1 hr)** — repo — Prettier + ESLint format-only PR with guardrails above
  - Surfaced by: Code quality 2.3
  - Verify: full Jest + determinism goldens + headless/worker parity CI unchanged
- [ ] **T2 (P1, human ~4 hr / CC ~20 min)** — lab — Move episode-batch + worker-episode-batch to `src/systems/lab/`
  - Surfaced by: Code quality 2.1
  - Verify: tests/lab/episode-batch.test.js, lab-real-worker-qa, lab-episode-scheduler-qa green
- [ ] **T3 (P1, human ~1 day / CC ~30 min)** — lab — `labErrors.js` table; migrate existing string codes
  - Surfaced by: Code quality 2.2
  - Verify: unit test rejects unknown codes from any Lab module
- [ ] **T4 (P1, human ~1 wk / CC ~3 hr)** — brain — ABI v1 spec, `observe()`, `abiValidator` after preflight
  - Surfaced by: Architecture 1.2; unblocks #450
  - Verify: golden observation vectors; stubRender on/off identical; validator unit tests
- [ ] **T5 (P1, human ~2 days / CC ~45 min)** — brain — Hostile-file unit tests + fast-check fuzz in brain-hostile-file-qa
  - Surfaced by: Tests 3.3
  - Verify: fuzz run of >= 10k cases, never throws/hangs, time cap holds
- [ ] **T6 (P1, human ~3 days / CC ~1 hr)** — brain — Graph policy runtime (fixed order, pmath, 4-tick hold)
  - Surfaced by: Architecture 1.2, 1.3
  - Verify: golden outputs; sim-math-boundary green
- [ ] **T7 (P1, human ~3 days / CC ~2 hr)** — lab — Promote headlessRun with strict stubs, train/verify modes, frozen content cache; extend render parity to policy tapes
  - Surfaced by: Architecture 1.1, Performance 4.2, 4.3
  - Verify: strict-stub tests; train vs verify same fitness; headless-render-parity-qa
- [ ] **T8 (P1, human ~1.5 wk / CC ~5 hr)** — lab — Trainer v1: fixed shape + seeded evolution, atomic generations, per-gen checkpoint, champion verify
  - Surfaced by: Architecture 1.3, 1.4
  - Verify: loop unit tests; resume E2E
- [ ] **T9 (P1, human ~2 days / CC ~1 hr)** — CI — Golden training test (1 vs 4 workers, resume at gen 4) on Node + Chromium + Firefox + WebKit
  - Surfaced by: Tests 3.1, Architecture 1.4
  - Verify: identical champion hash everywhere
- [ ] **T10 (P1, human ~3 days / CC ~2 hr)** — lab — Guided-run headless proof: fixed seed/population, milestone ladder golden, 6x-throttled 1-worker run inside budget
  - Surfaced by: Tests 3.2
  - Verify: Playwright throttled run hits first milestone inside budget
- [ ] **T11 (P2, human ~2 days / CC ~1 hr)** — lab — Governor unknown-memory measured ramp (cap 4, remembered, back-off)
  - Surfaced by: Performance 4.1
  - Verify: governor unit tests; Firefox/WebKit worker QA
- [ ] **T12 (P2, human ~1 day / CC ~30 min)** — tools — Benchmark: setup vs sim time, train vs verify
  - Surfaced by: Performance 4.2, 4.3
  - Verify: script prints per-mode ms/episode on Chromium
- [ ] **T13 (P2, human ~1 hr / CC ~10 min)** — issues — Update #24: premium-only Lab, MVP split, link deferred items
  - Surfaced by: Step 0
  - Verify: issue body no longer says "Web 1 slot"
- [ ] **T14 (P1, human ~1 day / CC ~45 min)** — CI — 300 s physics parity on Firefox + WebKit
  - Surfaced by: Tests 3.1
  - Verify: new CI jobs green and equal to Node baseline

Effort for the slice: human ~6-8 weeks / CC ~4-6 days.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | monetization + Lab premium-only (2026-11-27) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | PENDING | outside voice sent to GPT Friday/Neon instead |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 13 issues, all resolved; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | DESIGN.md + mockups (2026-11-27) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | n/a | |

- **VERDICT:** CEO + DESIGN + ENG CLEARED, ready to implement after the outside-voice pass.

**UNRESOLVED DECISIONS:**
- Outside-voice (GPT Friday/Neon) findings not yet received; any cross-model tension gets its own decision before T4/T8 start.
