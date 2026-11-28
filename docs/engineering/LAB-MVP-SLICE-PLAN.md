# Lab MVP vertical slice: engineering plan (v2)

Reviewed with gstack `/plan-eng-review` (v1.58.5.0) on 2026-11-28 against `main @ 1ca95c3`, then
revised the same day after two outside-voice reviews (GPT Friday and Neon). Every decision was made
explicitly by Marv. v2 keeps most of the architecture and changes the **order**: prove learning, then
feasibility, then the hook with real players, and only then productize.

> Why v2: v1 reviewed the Lab as an ML engineering project. The product is "a little idiot on a sled
> that learns." Nobody had watched a brain learn yet, so v1 would have built validators, fuzzers and
> CI around an untested ABI and fitness function.

## Platform (decided 2026-11-28)

- **The Lab runs only on Chromium:** the Steam app (Electron, one pinned Chromium) and Chromium
  browsers (Chrome, Edge, ChromeOS). Firefox and Safari show a calm "The Lab needs Chrome or the Steam
  app" with no sales pitch. Sledding and Autopilot work everywhere.
- Premium = Steam, web unlock, honor button, schools (Chromebooks qualify). Free web players on
  Chromium get one guided Lab run.
- Consequences: no Firefox/WebKit training goldens or physics parity jobs; Chromium reports
  `deviceMemory`, so the unknown-memory worker ramp (v1 decision 4.1) is dropped.

## Phases and gates

```
 PHASE 0  prove learning      disposable spike on existing harness       GATE: Marv watches a champion
          (tools/lab/spike/)  bake-off, fitness, ABI candidates,               improve; algorithm,
                              champion replay viewer, 30 seeds                 ABI, fitness, cadence chosen
     │
 PHASE 1  prove feasibility   benchmark (setup/sim/heap, worker pool),   GATE: first milestone inside
                              real worker throttling + real Chromebook,        budget on weak hardware
                              Electron vs Node golden
     │
 PHASE 2  prove the hook      rough guided-run prototype, tested with    GATE: acceptance targets
                              unfamiliar players                               (below, adjustable)
     │
 PHASE 3  productize          T1-T13 below                               GATE: all tests green
```

Nothing from Phase 0 ships. Its code lives under `tools/lab/spike/` and may be deleted. Phase 3 rebuilds
the chosen pieces properly.

### Proposed acceptance targets (Phase 2 gate; proposals from Neon, Marv may adjust)

| Metric | Initial target |
|---|---|
| First visible learning milestone | within 60 s |
| Meaningful riding improvement | within 3 min |
| Guided experience complete | within 5 min |
| Success rate across independent training seeds | >= 90% |
| Unfamiliar playtesters | >= 20 |
| Players who choose to train again | >= 50% |
| Fake or prerecorded milestones | zero |

## Decisions (locked)

| # | Topic | Decision |
|---|---|---|
| 0 | Scope | Lab MVP vertical slice. Defer leases, Potions, forfeit accounting, extra algorithms, Autopilot economy, full Lab UI (#498) |
| OV1 | Order | Phase 0 → 1 → 2 → 3 as above (both reviewers) |
| OV3 | Hook proof | Champion replay viewer in Phase 0; rough guided-run prototype playtested with unfamiliar players before Phase 3 |
| OV4 | Engines | Lab on Electron + Chromium browsers only |
| 1.1 | Headless run | Promote harness into `src/` with strict stubs at **subsystem** granularity (sound, tweens, particles, cameras, `add.*`, textures allowed as no-ops); throw on an unknown subsystem or when game logic reads a value back from a stub; render-on/off parity gate on policy tapes; move RunScene toward a view-sink (`scene.fx`/`scene.hud`) gradually as it is touched |
| 1.2 | Model ABI | Locked **after** Phase 0. Candidate set below. Stamped with `abiVersion` + `SIM_REVISION` |
| 1.3 | Brain format | Feed-forward graph with a **forward-only ordering rule**: nodes ordered inputs → hidden → outputs, every connection goes from a lower to a higher index. Cycles impossible by construction; evaluation over flat typed arrays. NEAT-compatible by topological sort on save. Trainer algorithm chosen by the Phase 0 bake-off |
| 1.4 | Interrupts | Ranking and breeding atomic. Finished episode results (index-addressed) survive governor throttling and worker-count changes; remaining episodes drain on the resized pool. Discard only on cancel, unrecoverable crash, or tab/app close. Short generation-time budget. Checkpoint after each completed generation |
| 2.1 | Scheduler location | Move `episode-batch` + `worker-episode-batch` to `src/systems/lab/` (pure move), single copy; then persistent worker pool |
| 2.2 | Error names | `src/systems/lab/labErrors.js` table (code, retryable, messageKey); stability promised only for codes players or files can see |
| 2.3 | Formatting | Prettier + ESLint config enforced on **new and modified Lab/brain modules only**; repo-wide sweep deferred to an integration freeze (62 open PRs on 2026-11-28) |
| 3.1 | Goldens | Training golden on Node + Chrome (Playwright) + Electron; compare population and fitness hashes, not only the champion |
| 3.2 | Guided run | Fixed seed + starting population for onboarding and regression, **plus** 30 independent population seeds and held-out courses with a preset success bar (median and p90 time to milestone); weak-machine proof uses real worker-target throttling and a real low-end Chromebook |
| 3.3 | Brain files | ~15 targeted hostile-file tests + small fast-check fuzz, scheduled in Phase 3 |
| 4.1 | Worker cap | Existing Chromium memory rule stands; add a tab-kill sentinel |
| 4.2 | Verify | Re-verify only new milestone champions, cached by brain + course + ruleset hash; `VERIFY_MISMATCH` code |
| 4.3 | Episode setup | Measured in Phase 1; per-worker deep-frozen content cache allowed; scene reuse only behind a 1,000-reuse parity test (#510) |

### Accepted outside-voice additions

- **Fair courses:** every candidate in a generation rides the same course seeds; courses rotate across
  generations; champions are evaluated on held-out courses.
- **Per-generation RNG = hash(runSeed, gen)**, so retries and resumes cannot drift.
- **Normalize -0** to 0 on save and load (JSON writes -0 as 0).
- **Optimizer state is versioned separately** from the runnable brain file.
- **Checkpoint ownership:** campaign identity + compare-and-swap. Today `localBrainCheckpoints` rejects
  only older generations, so two tabs at the same generation can overwrite each other (verified).
- **IDB retention:** one latest checkpoint + pinned milestone snapshots.
- **Size budget:** measure worst-case population + optimizer size against the preflight limits
  (2 MiB, 80,000 JSON nodes); compact weight arrays; portable brain exports separate from resumable
  checkpoints.
- **Free-run accounting:** the one free guided run is consumed only after it was actually delivered,
  never by a crash, interruption or storage refusal.
- **Real worker throttling:** CDP page throttling does not slow dedicated workers (verified
  2026-11-28: main thread 453 → 3090 ms at 6x, worker 512 → 485 ms). Throttle worker targets
  explicitly and assert an in-worker calibration loop runs ~6x slower; also run on a real low-end
  Chromebook (Kompanio class).
- **Persistent worker pool:** the current transport creates and terminates workers every batch
  (verified); keep a pool, fresh simulation per episode.
- **Tab-kill sentinel:** write a "workers starting" marker before spawning; if the page dies hard,
  the next load steps the worker cap down permanently (with a version/TTL).
- **Background-training contract:** define and test training behavior during menus, riding, and a
  hidden tab or minimized app. The governor stops admitting new work but never kills in-flight work.
- **NEAT is a candidate, not a scheduled slice 2** (#508): Phase 0 results and player data decide.

## What already exists (reuse, do not rebuild)

| Existing | Where | Used as |
|---|---|---|
| Real RunScene physics in a worker, 300 s cumulative parity (#122/#134) | `tools/lab/qa-real-physics-*.mjs` | Phase 0 spike base; Phase 3 production runner |
| Render on/off parity | CI `headless-render-parity-qa` | extended to policy tapes |
| Deterministic index-ordered scheduler | `tools/lab/episode-batch.mjs` | spike, then moved to `src/systems/lab/` |
| Worker transport | `tools/lab/worker-episode-batch.mjs` | moved; becomes a persistent pool |
| Brain JSON preflight (#450) | `src/systems/brain/brainFilePreflight.js` | first intake stage |
| SIM_REVISION policy (#452) | `src/systems/brain/brainRevisionPolicy.js` | stamp + verdicts |
| Local checkpoints (#451) | `src/systems/brain/localBrainCheckpoints.js` | gains campaign identity + CAS |
| Play-aware governor (#453) | `src/systems/lab/LabResourceGovernor.js` | admission + tab-kill sentinel |
| Portable math (#121) + Matter patch | `src/systems/pmath.js`, `src/systems/MatterPortable.js` | policy runtime uses pmath |

## Phase 0: prove learning (disposable)

- **Spike harness** on the existing runner: a policy hook called every N ticks, pluggable observation
  sets, pluggable fitness functions, all under `tools/lab/spike/`.
- **Fitness candidates** (progressive objectives): controlled movement → stable landings → hazard
  survival → intentional tricks → competitive riding. Training fitness is separate from the
  player-facing score. Each candidate is tested for exploits (crawling to avoid crashes, bounce
  farming, suicidal trick spam, idling).
- **Observation candidates:** sled velocity in a slope-relative frame, angle as sin/cos (no
  discontinuity), angular velocity, grounded, **height above terrain**, terrain samples **relative to
  sled height** plus local slope, hazard **type + relative dx/dy (+ velocity)**, heli power and action
  cooldowns, BSOD proximity and closing speed, previous action. Everything normalized to about [-1, 1].
- **Button semantics:** specify held, pressed and released per action. The existing tape already
  separates `pressed.hop` / `pressed.airBrake` from held controls; a 4-tick hold must not jam or
  double-trigger edge actions.
- **Cadence:** compare 15, 30 and 60 Hz decisions at equal compute.
- **Algorithm bake-off** at equal simulation budget, on common course seeds: linear policy + mutation;
  small fixed network + elitist evolution; small fixed network + diagonal Gaussian evolution strategy.
  Baselines: random search and an independently written heuristic controller. No AI-generated
  demonstration runs feed the population. Pick the simplest method that shows visible improvement
  reliably.
- **Champion replay viewer** (dev-only route): Gen 1 vs Gen N champion riding in the real rendered
  RunScene with an input overlay. Marv watches the milestone before anything is locked.
- **Generalization:** 30 population seeds, held-out courses, preset success bar, median and p90 time
  to milestone.

## Phase 1: prove feasibility

- **Benchmark:** per-episode setup vs sim time, heap growth over 500 episodes, persistent vs
  per-batch workers, train vs verify mode.
- **Weak hardware:** worker-target throttling with in-worker calibration, plus a real low-end
  Chromebook run: cold start to first milestone, peak memory, responsiveness while training.
- **Electron golden:** the Phase 0 winner produces identical population/fitness hashes in Node,
  Chrome and Electron.
- If setup dominates or heap grows, decide on #510 (scene reuse behind its parity test) here.

## Phase 2: prove the hook

A rough guided-run prototype on Chromium web and Electron: name your rider, watch it flop, start
training, watch it improve, race or spectate it, keep or export it. No full Lab UI. Test with
unfamiliar players against the acceptance targets. DESIGN.md §10 rules apply (honest milestones, no
unlock pitch in the guided run).

## Phase 3: productize

### Architecture

```
 MAIN THREAD                                   PERSISTENT WORKER POOL (governor-admitted)
 ┌──────────────────────────────┐              ┌────────────────────────────────────┐
 │ Trainer (generation loop)    │  episode     │ headlessRun(mode)                  │
 │  pop[gen] on common courses ─┼─{idx,seed,──►│  subsystem-strict stubs + RunScene │
 │       ▲   (index order)      │   brain}     │  every N ticks:                    │
 │       │                      │              │    obs = observe(scene)  (physics) │
 │  results[idx] kept across    │◄─{idx,fit,───┤    act = policyRuntime(brain, obs) │
 │  throttle / pool resize      │   code}      │    held / pressed semantics        │
 │       │                      │              │  mode=train : fitness only         │
 │  rank (atomic)               │              │  mode=verify: + fingerprints       │
 │  verify NEW milestone champ  │              └────────────────────────────────────┘
 │   (cached by brain+course+ruleset hash)
 │  checkpoint(gen) ──► LocalBrainCheckpoints (campaign id + CAS; latest + milestones)
 │  breed (RNG = hash(runSeed, gen)) ──► pop[gen+1]
 └──────────────────────────────┘
```

Brain file intake:

```
 file bytes ─► brainFilePreflight (#450)
           ─► abiValidator: abiVersion, SIM_REVISION verdict, forward-only index rule,
              finite weights, node/edge/fan-in caps, -0 normalized
           ─► ok {brain}  |  labErrors code (ABI_MISMATCH, SIM_REVISION_MISMATCH,
                                               BRAIN_TOO_LARGE, BAD_EDGE_ORDER, ...)
```

Generation state machine:

```
 IDLE ─start─► EVALUATING ──all results in──► RANKED ─► (VERIFIED if new milestone) ─► CHECKPOINTED ─► BRED ─┐
   ▲             │   ▲                                                                                      │
   │  throttle / │   │ drain remaining episodes                                                             │
   │  pool resize└───┘ (finished results kept)                                                              │
   │             │                                                                                          │
   │             └─cancel / unrecoverable crash / tab or app close─► INTERRUPTED (results dropped)          │
   │                           resume: reload last CHECKPOINTED gen, re-run that generation                 │
   └──────────────────────────────────────── next generation ◄─────────────────────────────────────────────┘
```

Inline ASCII diagrams required in code: the generation loop (trainer) and the main-thread ↔ worker
message flow (worker pool).

### Tasks

- [ ] **T1 (P1, CC ~30 min)** — repo — Prettier + ESLint config enforced on new/modified Lab and brain modules only
- [ ] **T2 (P1, CC ~1 hr)** — lab — Move scheduler + transport to `src/systems/lab/` (pure move), then persistent worker pool
- [ ] **T3 (P1, CC ~30 min)** — lab — `labErrors.js` (public codes stable), migrate existing strings
- [ ] **T4 (P1, CC ~3 hr)** — brain — Lock ABI v1 from Phase 0; `observe()`; `abiValidator` with forward-only rule, caps, -0 normalization; optimizer version separate from brain format
- [ ] **T5 (P1, CC ~45 min)** — brain — ~15 hostile-file tests + fast-check fuzz in `brain-hostile-file-qa`
- [ ] **T6 (P1, CC ~1 hr)** — brain — Policy runtime on flat typed arrays, pmath activations, held/pressed semantics
- [ ] **T7 (P1, CC ~2 hr)** — lab — headlessRun: subsystem-strict stubs, train/verify modes, frozen content cache, render parity on policy tapes
- [ ] **T8 (P1, CC ~5 hr)** — lab — Trainer v1 (Phase 0 winner): common courses + rotation + held-out eval, RNG = hash(runSeed, gen), atomic selection with results kept across throttle/resize, generation-time budget, milestone-only verify cache, `VERIFY_MISMATCH`
- [ ] **T9 (P1, CC ~2 hr)** — brain — Checkpoints: campaign identity + compare-and-swap, retention (latest + milestones), size budget vs preflight limits, exports separate from checkpoints
- [ ] **T10 (P1, CC ~1 hr)** — CI — Training golden: Node + Chrome + Electron; 1 vs 4 workers; resume at gen 4; population + fitness hashes
- [ ] **T11 (P1, CC ~2 hr)** — lab — Free-run accounting, background-training contract tests, tab-kill sentinel, browser gate ("The Lab needs Chrome or the Steam app")
- [ ] **T12 (P1, CC ~2 hr)** — CI — Guided-run regression: fixed-seed milestone ladder (per PR), 30-seed generalization + real worker throttle (nightly)
- [x] **T13 (P2, CC ~10 min)** — issues — #24 platform note, #508 relabel, #510 trigger moved to Phase 1

Phase 0-2 effort: CC ~2-4 days plus playtest calendar time. Phase 3: CC ~3-4 days.

### Test plan (Phase 3)

```
CODE PATHS                                     REQUIRED TEST
[=] src/systems/lab/episodeBatch (moved)        repoint tests/lab/episode-batch.test.js
[+] worker pool                                 lab-real-worker-qa: reuse, crash → WORKER_CRASHED, resize
[+] headlessRun
  ├── allowed subsystems are no-ops             unit
  ├── unknown subsystem / value read → throws   unit, named error
  ├── render on/off parity (policy tapes)       headless-render-parity-qa
  └── train vs verify                           unit: same fitness/crash/distance
[+] observe(scene)                              golden vectors; normalized range; stubRender on/off identical
[+] abiValidator                                ~15 named-rejection tests + fast-check fuzz (never throws/hangs, time cap)
[+] policyRuntime                               golden outputs; held/pressed edge cases; sim-math-boundary
[+] trainer
  ├── common courses + held-out eval            unit
  ├── results survive throttle/resize           unit + E2E
  ├── resume                                    E2E: kill at gen 4 + resume == 10 straight gens
  └── worker-count independence                 E2E: 1 vs 4 workers, population + fitness hashes
[+] checkpoints                                 CAS conflict (two tabs), retention, size budget
[+] golden training                             Node + Chrome + Electron identical
[+] free-run accounting                         crash/refusal mid-run does not consume the free run
[+] background contract                         menus, riding, hidden tab, minimized app
[+] tab-kill sentinel                           simulated hard kill steps cap down
[+] browser gate                                Firefox/Safari see the gate, sledding unaffected
USER FLOWS
[+] Guided run                                  ladder golden (PR) + 30 seeds + real throttle (nightly)
[+] Interrupted training                        "resumed from generation N"
[+] Import a friend's brain                     valid loads; hostile rejected with a public code
```

### Failure modes

| Codepath | Realistic failure | Test? | Handling? | User sees |
|---|---|---|---|---|
| Phase 0 | no algorithm learns visibly in budget | bake-off + replay | gate stops Phase 3 | n/a (caught before productizing) |
| headlessRun | gameplay starts depending on a stubbed subsystem | strict stubs + parity CI | throws in CI | n/a |
| observe() | reads a render-only field | stubRender on/off unit | test gate | n/a |
| abiValidator | brain with huge fan-in pins CPU | caps + fuzz | BRAIN_TOO_LARGE | clear rejection |
| trainer | player starts riding mid-generation | throttle E2E | results kept, drain on smaller pool | training slows, never resets |
| trainer | app closed mid-generation | resume E2E | re-run generation from checkpoint | "resumed from generation N" |
| trainer | verify disagrees with train | unit | VERIFY_MISMATCH, milestone withheld | honest "couldn't confirm" notice |
| checkpoints | two tabs write the same generation | CAS test | second writer refused | "training continues in another tab" |
| storage | IDB refuses durable write | existing tests | STORAGE_REFUSED, export kept | warning + download offer |
| worker pool | Chromebook kills the tab under memory | sentinel test | cap steps down on next load | fewer workers, no crash loop |
| guided run | slow device misses milestone | real throttle + Chromebook | honest progress-kept path | real progress, no fake result |
| free run | crash during the one free run | accounting test | run not consumed | can try again |

Critical gaps (no test AND no handling AND silent): none.

## NOT in scope

- Firefox/Safari Lab support: decided out; gate screen instead.
- Sim-Slot leases, Power Potions, Stop & Reconfigure forfeit accounting (#509).
- NEAT (#508, candidate only), MAP-Elites, Novelty, PBT, RL.
- Autopilot earnings/economy and offline Autopilot.
- Full Lab UI (#498): Phase 2 is a rough prototype only.
- Remote/server workers and tournament server.
- Player-tape contribution to training ("YOU TAUGHT THAT").
- Public Bazaar; local import/export only.
- Repo-wide formatting sweep: waits for an integration freeze.
- Scene reuse (#510): only if Phase 1 says setup dominates, behind a 1,000-reuse parity test.

## Parallelization

- Phase 0 is one lane (spike + bake-off + replay viewer), with the 30-seed run after the winner is picked.
- Phase 1: benchmark, weak-hardware proof, Electron golden can run in parallel (tools/, CI, electron/).
- Phase 3: T1 → (Lane A: T2 → T7) ‖ (Lane B: T3 → T4 → T5 → T6) ‖ (Lane C: T9) → T8 → T10 + T11 + T12.
- Conflict flag: lanes A and B both touch `src/systems/lab/`; land T3 first (tiny).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | monetization + Lab premium-only (2026-11-27) |
| Outside voice | GPT Friday + Neon | Independent 2nd opinion | 1 | CLEAR | order, fitness, ABI, hook proof, 4 verified bugs/claims; all decided |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN, v2) | 13 issues + 7 cross-model tensions + 16 additions, all decided |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | DESIGN.md + mockups (2026-11-27) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | n/a | |

- **CROSS-MODEL:** both outside reviewers independently put learnability first, flagged the
  unspecified fitness function and under-observed ABI, and rejected the repo-wide format pass.
- **VERDICT:** CEO + DESIGN + ENG CLEARED. Start Phase 0.

NO UNRESOLVED DECISIONS
