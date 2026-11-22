> **Release addendum (2026-11-22, v2.19.2):** This document preserves the E1/E2 experiment results from the pre-v2.19.1 source as historical research evidence. Since the tests, camera-dependent warning planning was fixed in #155 (v2.16.1), and #140 (v2.19.1 / SIM_REVISION 3) removed cosmetic palette/biome collider rebuilds; Team A separately released Kodiak shove physics as SIM_REVISION 2 in v2.19.0. These fixes reduce causal coupling but **do not** establish production-grade savestates or exact snapshot restore in the new ruleset. The independent **canonical static collider geometry** change and stable-id TelegraphTracker serialization are still pending Phase 2 work; do not conflate #140's redraw fix with canonical collider reconstruction. The project still needs fresh browser tests on current source. This is a conditional **GO for Phase 2 experiments**, not acceptance of the end-to-end feature.

# Trusted savestates: Phase 1 feasibility study (issue #119)

Status: **research, Phase 1 only.** Nothing here ships a savestate. No `src/` file changed. Owner: Team B.
Base: `origin/main` `b51ab36` (Phaser 3.90.0, bundled Matter **0.20.0**).

All digests in this study are **diagnostic and non-authoritative**. They exist only so the experiments can
name the first divergent tick and subsystem. Team A's #152 owns the replay manifest and the canonical state
hashes. A savestate is **not** a replay manifest (see "Interaction with #152").

## 1. Answer first

**Can a run be saved at a tick boundary, restored into a fresh scene and world, and continue bit-identically
for the same input suffix? Yes, in the real game.** Both fixtures held exact equality for every compared tick
after restore, across every captured subsystem. That includes Matter's pair table and cached impulses, all
body ids, the world order and the RNG streams. The fixtures are a contact-heavy run on terrain, and a run with
Gear Gates, two Kodiak packs and absorbed hazard hits. The pure-Matter experiment shows the same: exact after a
restore into worlds built with a different id history.

One caveat: a rerun on 2026-11-22 found one non-physics field, `Hazard.teleAtMs`, re-stamped after restore. The
cause is the non-serializable TelegraphTracker (section 6).

**Restoring only the GhostTape checkpoint (sled pose, velocity and score) does not work.** It diverges on the
first tick after restore in every fixture. Restoring all game state while restoring Matter by pose alone also
diverges on the first tick. Section 6 shows which items close each gap.

Exactness costs much more than a pose. A trusted snapshot of today's game must carry:

- Matter's private solver state, which no public Matter API exposes or restores: pair contacts, cached
  impulses, the stale support slot, `positionImpulse`, `positionPrev` and `anglePrev`, `deltaTime`, raw
  vertices, timing, ids and world order.
- Raw static collider geometry. Terrain colliders are pooled, so their vertex bits depend on history.
- The terrain generator's internal caches.
- Presentation state that the tick reads today: the camera, through #155.

All of this was found and closed in the experiment. None of it is cheap or stable across a Matter upgrade.

**Recommendation: GO for Phase 2, scoped and gated** (section 11). The owner has also set the savestate product
contract (section 11). This study named three items that should land before any savestate counts as "trusted":

1. ~~#155 removes the camera read from the tick.~~ **Done**: fixed on main in v2.16.1 (#208 / #155).
2. ~~The terrain collider pool stops changing collider bits.~~ **Done**: v2.19.7 / SIM_REVISION 4 (#119, PR #222).
3. Telegraph state stops being keyed by object identity. **Remaining.**

The experiments in this study ran before items 1 and 2 landed. Their numbers describe the old physics.

Exact savestates are feasible. A savestate format that does not grow and break silently is the hard part.

## 2. Method

| Experiment | Where | Harness |
| --- | --- | --- |
| E1 pure Matter | Node, the game's own Matter build (`phaser/src/physics/matter-js/CustomMain.js`) plus the game's `installTerrainContactFix`, `positionIterations=8`, `velocityIterations=6`, gravity 0.9 and a 120 Hz tick of two 4.1667 ms sub-steps | `tools/savestate-experiment/matter-node-experiment.mjs`, pinned by `tests/determinism/savestate-matter.test.js` |
| E2 real game | Chromium, the production `vite build` served on port 8414 | `tools/savestate-experiment/browser-experiment.mjs` with the in-page kits `matter-snapshot-kit.js` and `game-state-kit.js` |

Each case follows the same protocol. Run A plays ticks 1..K without interruption. A snapshot is captured and
round-tripped through `JSON.stringify` and `JSON.parse`, which proves it really serializes. Run B is a **fresh**
world: in E1 a new engine, in E2 a new browser context with its own storage, Phaser game, RunScene and Matter
world, created from the same seed and held at tick 0. The snapshot is restored into B at a chosen level. A and
B then step K+1..N in lockstep with the identical tick-indexed input tape. Every tick, both sides compute a
digest of every subsystem. The first tick where any subsystem differs is reported, with the differing leaf
fields.

In E2, each frame is `game.step(t, 1000/120)`: exactly one sim tick per display frame. A frame boundary is
therefore a tick boundary. `renderFrame` still runs every tick, so the #155 camera read stays in play.

## 3. Matter 0.20 internals that decide what "complete" means (verified in source)

Paths are relative to `node_modules/phaser/src/physics/matter-js/lib/`.

- **Verlet integration** (`body/Body.js` `Body.update`). Velocity is `(position - positionPrev) * correction`,
  with `correction = deltaTime / body.deltaTime` (`Body._timeCorrection`). Angular velocity comes from `anglePrev`
  the same way. So `positionPrev`, `anglePrev` and `body.deltaTime` are state. `velocity` is not: it is
  re-derived after every step (`Body.updateVelocities`). `Body.setVelocity` recomputes `positionPrev` from
  `position - v * deltaTime / baseDelta`, which does not reproduce the original bits.
- **Geometry is integrated incrementally.** Every step translates and rotates `part.vertices`, `part.axes` and
  `part.position`, and updates `bounds`. Vertices are therefore **not** a function of (position, angle).
  Rebuilding them with `setPosition`/`setAngle` gives different low bits (E1 ablation `rawGeometry`).
- **Pairs and warm starting** (`collision/Pairs.js`, `Pair.js`, `Resolver.js`). `engine.pairs.table` and
  `pairs.list` persist across steps:
  - `Resolver.preSolveVelocity` applies each contact's cached `normalImpulse` and `tangentImpulse` before
    solving.
  - `pairs.list` order is the Gauss-Seidel order.
  - `Pair.update` keeps each cached impulse with its contact by comparing `contact.vertex` **by identity**
    against the new supports. It also reads `collision.supports[1]` even when `supportCount === 1`: a **stale
    slot left from an earlier step** (E1 ablation `staleSupport` diverges on tick 1).
  - Pairs not updated this step are ended by comparing `timeUpdated` against `engine.timing.timestamp`, so
    timing is state.
- **Collision records are reused** (`collision/Collision.js`). `Collision.collides` looks up the existing pair
  by `Pair.id`, which is built from body ids, and reuses its `collision` object. For a **new** pair,
  `collision.bodyA` is always the **lower-id** part. That choice sets the normal's sign, which body's supports
  are searched first, and the contact slot order. **Relative id order is physics state for every new pair**
  (E1 `permuted`: exact until a new pair forms 43 ticks after restore, then diverges).
- **Position warming** (`Resolver.postSolvePosition`). `body.positionImpulse` decays by 0.8 and carries into the
  next step (E1 ablation `positionImpulse`).
- **Broadphase** (`collision/Detector.js`). Matter 0.20 has no grid: `engine.grid` and `broadphase` are empty
  back-compat stubs, so there are no buckets. `detector.bodies` is **sorted in place** by `bounds.min.x` every
  step with a stable sort, so ties keep the previous order. It is re-copied from `Composite.allBodies(world)`
  whenever `world.isModified`. `Composite.allBodies` is **cached** in `world.cache.allBodies`, and the engine
  iterates that cache, not `world.bodies`. A restore that reorders bodies must drop the cache without setting
  `isModified`.
- **Ids.** `Common._nextId` is one global counter for bodies, parts, composites and constraints, and it is
  shared by every Phaser scene in the page. `Pair.id` is `min(idA,idB):max(idA,idB)` in base 36.
- **Sleeping.** `enableSleeping` is false at runtime, so `sleepCounter`, `motion` and `isSleeping` stay inert.
  They are captured anyway because they are cheap. `Pairs.update` reads `sleepCounter` when it ends pairs.
- **Constraints and composites: none at runtime** (verified: `allConstraints = 0`, `allComposites = 0`).
- **Events.** `collisionStart` fires for new pairs and `collisionActive` for continuing ones. RunScene handles
  both with the same `handlePair` and does not listen to `collisionEnd`. Losing the pair table would turn
  "active" into "start". Gameplay would see no difference, but the solver would (warm start lost).
- **`installTerrainContactFix`** (`src/systems/TerrainContact.js`) wraps `Collision.collides` in place and is
  idempotent per Matter module. It is code, not state, but it **mutates the collision record** (normal,
  tangent, penetration, depth) that the pair stores. The snapshot must therefore store the post-snap record.
- **Orphan pairs.** A body removed after the last `Engine.update` (hazard despawn, chunk drop) keeps its pairs in
  `pairs.list` until the next update ends them. They are never solved; their only effect is a `collisionEnd`
  event, which RunScene ignores. They can be dropped on restore, but the snapshot records how many there were.

## 4. State inventory

Classes:

- **R**: required for exact equivalence; must be in the snapshot.
- **D**: rebuildable deterministically from seed, registry and profile; verified, not stored.
- **P**: presentation only.
- **R\***: presentation state the tick reads today. Required until the read is removed.

The RunScene column is machine-checked. `game-state-kit.js` classifies every own property of RunScene, and
capture fails on an unclassified one. At tick K (hazard fixture) the counts were SIM 89, CONFIG 26,
PRESENTATION 23, PRESENTATION_READ_BY_SIM 7, NON_SERIALIZABLE 1, METADATA 5, INFRA 30, unclassified **0**.

### 4.1 Matter engine and world

| Item | Class | Evidence |
| --- | --- | --- |
| `position`, `angle` (body and parts) | R | trivially |
| `positionPrev`, `anglePrev` | R | Verlet. Pose-only restore diverges at K+1 (E1, E2) |
| `velocity`, `angularVelocity`, `speed`, `angularSpeed` | D | re-derived each step. Read by game code between ticks, so restore them consistently |
| `body.deltaTime` | R | `_timeCorrection` (E1 ablation: K+1) |
| `force`, `torque` | R (zero at a tick boundary today) | cleared by `_bodiesClearForces`; capture anyway |
| `positionImpulse` | R (state-dependent) | position warming (E1 ablation: K+1 at K=300 and K=600, exact at K=450) |
| `constraintImpulse` | R (zero today, no constraints) | |
| raw `vertices`, `axes`, part `position`, `bounds` of dynamic bodies | R | incremental integration (E1 ablation `rawGeometry`: K+1) |
| raw geometry of **static** colliders | R today | the TerrainMesh pool makes vertex bits history-dependent (E1 `pooled`: 39 of 120 quads differ by up to 1.1e-13 px; diverges at K+5 unless captured) |
| `motion`, `sleepCounter`, `isSleeping` | R (inert, sleeping off) | |
| `pairs.list` order and `pairs.table` | R | Gauss-Seidel order and warm-start lookup |
| per pair: `contacts[i].vertex` (identity), `normalImpulse`, `tangentImpulse`, `contactCount`, `separation`, `isActive`, `isSensor`, `timeCreated`, `timeUpdated`, `inverseMass`, `friction`, `frictionStatic`, `restitution`, `slop` | R | E1 ablation `impulses`: K+1 |
| per collision record: `bodyA`/`bodyB` order, `normal`, `tangent`, `penetration`, `depth`, `supportCount`, **both** `supports` slots | R | E1 ablation `staleSupport`: K+1 |
| `engine.timing.timestamp`, `lastDelta`, `timeScale` | R (state-dependent) | ends pairs (E1 ablation `timing`: K+1 at K=300, exact at K=450) |
| body and part **ids**, `Common._nextId` | R | new-pair orientation (E1 `permuted`: K+43). Future bodies take ids from `_nextId` |
| world body order (`world.bodies` and `cache.allBodies`) | R (tie-break; **source reading only**) | broadphase ties after the next world change. Untested: no fixture with bounds ties. Cheap to keep |
| detector sort order | R (tie-break; **source reading only**) | same |
| orphan pairs | D (drop) | event-only |
| Matter module statics (`Common._seed` for `Common.random`, `Body` group/category counters, `Resolver`/`Sleeping`/`Constraint`/`Engine` constants) | R (`_seed`, counters) / D (constants) | captured and key-audited (`MODULE_STATICS`); restored at `contacts`+ |
| `enableSleeping`, iterations, gravity, `_timeCorrection`, `Resolver._*` constants, `installTerrainContactFix` | D | config/code; verify in the snapshot header |
| TerrainMesh `_bodyPool`: order, raw geometry and ids of pooled bodies | R today | a pooled body's next shape depends on its previous position (`Body.setVertices` then `setPosition`) |

### 4.2 Game state (RunScene and subsystems)

| Item | Class | Notes |
| --- | --- | --- |
| `SimClock`: `tick`, `accMs`, `droppedMs`, `_edges` | R (`tick`), R for live resume (`accMs`, `_edges`) | `_edges` holds carried one-shot inputs across 0-tick frames; `accMs` maps real time to ticks. Neither matters for a tick-indexed suffix, but both matter for resuming live play |
| `runRandom` streams (physics/scramble, visual/sled, visual/fx, visual/camera) | R | `uint32 state` each. `sled.random` **aliases** `scene.runRandom`; restore must keep the alias. visual/camera is consumed in `updateCamera` (presentation) but lives in the same object |
| `TerrainGenerator`: `rng`, active list, chunk cache, `_tempChunk`, `_lastChunk`, recycled chunk-array `pool`, `_pendingRelease`, scratch | R | Cosmetic reads (UIScene `RunMinimap` calls `terrain.heightAt`, the camera look-ahead) can build chunks early and change the cache. Colliders are gated by #59, so physics is safe, but the generator digest diverged (E2 `-camera`). Rebuilding by streaming to x gives different internals (E2 `ghost`) |
| `_chunkQueue` (chunks generated but not yet physical) | R | Map order is iteration order |
| chunk → colliders, pads, hazards, pickups, shards (`mesh.chunks` insertion order, `hazards`/`powerups` Map order) | D + R(order) | rebuilt by `takeChunk` in the snapshot's chunk order; Map iteration order feeds the per-tick hazard loop |
| `collectedPowerups`, `shardField.collected`/`byChunk` | R | `takeChunk` reads `collectedPowerups`, so restore it **before** the rebuild |
| Hazard instances: `hit`, `roll` (rolling state), `rolling`, `open` (gates), `spin`, `cx/cy`, `teleAtMs`, `_lastDraw`, `alert` | R (`_lastDraw`/`alert` are P inside a sim object) | per-class schemas are needed to separate them |
| PowerUp instances (`collected`, …), `_despawn` | R | |
| `sled` non-body fields (about 50: `msSinceContact`, `_contactFlag`, `airtimeMs`, `hopBufferMs`, `_playerHop*`, `pushCooldownMs`, `parachute*`, `geyserCooldownMs`, `invulnerableMs`, `_groundRunMs`, `_sinceLaunchMs`, `_landSettleMs`, `touchdownV*`, `_preV*`, `heliVel`, `heliPhase`, `_lastPad`, `_lastTilt`, `snapSteps`, `_crawlMs`, …) | R | `heliPhase`, `squash` and `pose` are visual but sit in the same object |
| ms timers: `runTimeMs`, `_hudMs`, `slowMs`, `scrambleMs`, `boostMs`, `slowmoMs`, `hitStopMs`, `blinkMs`, `resetCooldownMs`, `glideMs`, `stabilizeMs`, `blindMs`, `magnetMs`, `crashTimerMs`, `_safeTimer`, `_steepMs`, `gymReadyMs`, `gymBeatWaitMs`, `shardChainAt`, `_lastHopMs` | R | `_hudMs` only paces a HUD event, but it is cheap |
| effect parameters: `slowFactor`, `boostFactor`, `boostId`, `slowmoScale`, `shieldCharges`, `shieldSources`, `wards`, `glideMul`/`Id`, `stabilize*`, `blindVis`, `magnetEff`/`Id`, `openingGraces`, `activeZones` | R | |
| `pendingCrash`, `crashed`, `_crashHazard`, `bsodCaught`, `_contactQueue` | R | `pendingCrash` resolves inside the tick, so it is normally null at a boundary; `_contactQueue` is empty at a boundary |
| `ScoreManager` (`flow`, `flowRemainingMs`, `pending`, `paid`, `comboTricks`, `bonusByKind`, `counts`, `distanceM`, `lastMilestoneSector`, …), `trickCounts`, `bestCombo`, `maxAirtimeMs`, `lastTotal`, `shard*`, `nearMissCount`, `_airTricks`, `_landings`, `newBestDone` | R | |
| `TrickTracker` (`_air`, `_airStart`, `_prevAngle`, `_prevHeli`, `_tiltNet`, `_heliNet`, `_corkscrewNet`, `_brakeMs`, `_chuteMs`, `*Done`, …) | R | |
| `GlitchDirector` (`rng`, `next`, `active`, `_count`) | R | |
| `HintScheduler` (`cur`, `latched`, `shows`, `lastHideAt`, `startMs`), `tutShown`, `tutTimers`, `tutDone`, `tuckShows` | R | `tutDone`/`tuckShows` are loaded from storage at create and can change during the run |
| `BsodPursuit` (`active`, `wallX`, `wallSpeedPxS`), `bsodState`, `BsodBluffTracker` (`previousGapPx`, `chain`, `armed`, …) | R | |
| Kodiaks: `kodiaks[]` (`x`, `speed`, `phase`, `phaseMs`, `ageMs`, `feints`, `real`, `targetX`, `done`, `hit`, `sledAhead`, `groundY`, `def`, **per-bear `rng`** (Rng instance)), `kodiakNext` | R | the per-bear Rng is a class instance, so the restore must materialize it with its prototype |
| `currentPhys`, `_hopped`, `_pushed`, `_biomeId`, `gym*`, `_manual*`, `_leaving` | R | |
| `TelegraphTracker` (`teleTracker`) | **not serializable** | `WeakMap`/`WeakSet` keyed by Hazard identity. Drives audio cues and `h.teleAtMs` (crash-report metadata), not physics or score. Must be re-keyed by stable hazard ids before Phase 2 |
| `_teleMarks` | R (derived each tick) | |
| `_view`, `_camX`, `_camY`, `_zoom`, `_zoomKick`, `shakeAmp`, `_landingShake`, `cameras.main` scroll/zoom | **R\*** | `updateGroundTelegraph` reads `this._view.right` (#155). `updateCamera` lerps from history with **frame** dt. E2 `-camera` diverges at K+1 |
| seed, biomeMask, daily*, loadout, upgrades, boostFx, magnetsDrop, kodiaksOn, kodiakPackMode, startX, content, tuner, settings, bestM | D | verified equal on restore (`snap.config`; mismatch throws) |
| `look`, `palette` (and copies inside Hazard, ShardField and Sled) | P | re-resolved when the biome sector changes (RunScene ~L2383). The experiment first had them as CONFIG, and the config check caught it |
| references to despawned entities (`_crashHazard` and its removed body) | R (as dead refs) | crash-report data; the body can never collide again |
| `runId`, `startedAt` (wall clock), `ghostRecorder`, `tapePlayer` | metadata | a resumed run's ghost tape needs the recorder's inputs and checkpoints (see section 9) |
| Phaser timers/tweens that feed the sim | **none** | `run.time` active 0, tweens 0; no `this.time`/`delayedCall` in RunScene or its sim systems. `setTimeout` exists only in AudioSynth and SaveStore |
| cross-scene writes into RunScene | none found | UIScene `RunMinimap` and the billboard only **read** RunScene, but a generator read can mutate its cache (see TerrainGenerator) |
| InputRouter latched edges and held sets | outside the sim | a snapshot is taken between polls; live resume must clear them |

## 5. E1: pure Matter results

Fixture: the real Sled compound body (2 runners, deck, torso, head) and 24 dynamic boxes and circles on 120
static 16 px terrain quads. The input tape pushes, tilts and hops the sled. K=300, N=900. In the reference run,
74 non-sensor pairs were created after K.

Fresh-world histories:

- `same`: identical build order.
- `shuffled`: 37 ids consumed first, terrain built right to left, so the relative order between terrain and
  dynamic bodies flips.
- `permuted`: also builds the pile in reverse, so the relative order between dynamic bodies flips.
- `pooled`: terrain built through TerrainMesh's recycle path.

| Restore level | same | shuffled | permuted | pooled |
| --- | --- | --- | --- | --- |
| `pose` (GhostTape: sled pose and velocity only) | **K+1** | K+1 | K+1 | K+1 |
| `kinematic` (raw integrator state, no pairs) | **K+1** | K+1 | K+1 | K+1 |
| `contacts` (+ pairs, timing, detector) | exact | exact | **K+43** | **K+5** |
| `full` (+ ids, world order) | **exact** | **exact** | **exact** | K+5 |
| `full` + static geometry | | | | **exact** |

Ablations: each removes one item from `full` in the `same` world. The snapshot is taken at two ticks, K=300 and
K=450, and the suffix is 300 ticks long (N=K+300). Each cell is the first divergent tick, then the maximum
position error in that window. `npm test -- tests/determinism` pins both columns.

| Left out | K=300 | K=450 | Reading |
| --- | --- | --- | --- |
| cached contact impulses | K+1 (122 px) | K+1 (42 px) | needed in every tested state |
| stale `supports[1]` slot | K+1 (269 px) | K+1 (149 px) | needed in every tested state |
| `body.deltaTime` | K+1 (91 px) | K+1 (144 px) | needed in every tested state |
| raw geometry (rebuilt from pose) | K+1 (146 px) | K+1 (36 px) | needed in every tested state |
| `engine.timing` | K+1 (35 px) | **exact** | state-dependent |
| `positionImpulse` | K+1 (8.5 px) | **exact** | state-dependent (K+1 again at K=600) |
| detector order / world order | exact | exact | untested as a requirement (no bounds ties in this fixture) |

**State-dependent items.** `timing` and `positionImpulse` matter only when the snapshot tick falls in a state
that uses them: a pair ending during the suffix, or non-zero position warming. "Exact in one window" is
**not** evidence of "not needed". Both stay **R**: a Phase 2 implementer must not drop an item because a test
at a convenient tick passed.

**Detector and world order.** These are rated causal from **source reading only**: stable-sort ties, and
`Detector.setBodies` copying `allBodies`. No fixture here has bounds ties, so they are R by caution, not by
experiment. A fixture with ties is needed before treating them as proven.

**Incomplete snapshots fail visibly** (`incompleteChecks`; pinned in `tests/determinism/savestate-matter.test.js`,
16 tests):

- Set checks: a missing body throws "world body set differs". A pair that references an unknown part throws.
- A wrong snapshot version or Matter version throws.
- **Live key-set audit.** A new own key is injected, one at a time, into a root body, a pair, a collision record,
  a contact, the engine, `engine.timing`, the detector, and a `Matter.Resolver` static. Each injection appears in
  the capture audit, and a strict restore of that snapshot refuses. The audit is a generic key-set diff against
  per-object whitelists (`KEYSETS`, `MODULE_STATICS`).
  - Its limits: it sees **own enumerable keys** only, at **capture time**, on the objects it walks. It cannot
    see new state held in closures (for example `Collision`'s module-scoped scratch arrays), in a new kind of
    object, or a change in the **meaning** of an existing field.
  - The real guard for a Matter upgrade is therefore the **`matterVersion` equality check** in restore. The audit
    is a second line that catches additive changes.

## 6. E2: real game results

Fixtures (tick-indexed input tapes, one tick per frame):

- **contact**: seed `SAVE119`, with scramble forced on for the whole run so the physics RNG stream is
  exercised. The tape pushes, hops (×3), tilts, spins and tucks on terrain. K=600 and N=1100 (500 compared
  ticks). At K the world has 220 bodies and 3 active sled/terrain pairs; score is 135.
- **hazard**: seed `SAVE119H@2047` (all biomes). The sled is placed at x=107000 before tick 1, in a Gear Gate
  cluster, with Kodiaks forced on and 99 shield charges, so hits are absorbed instead of ending the run.
  K=480 and N=1000 (520 compared ticks). At K there are 3 hazards (2 moving gates), 2 Kodiaks out (`kodiakNext=1`),
  276 world bodies, 6506 pooled terrain colliders, a `_crashHazard` that points at a despawned hazard, and score 11045.

Levels:

| Level | What it restores |
| --- | --- |
| `ghost` | The GhostTape checkpoint only: sled pose and velocity, plus tick and run clock. Terrain is streamed to the sled. |
| `game` | All RunScene SIM state and the world rebuild. Matter is restored by pose only. |
| `kinematic` | Adds raw sled integrator state. |
| `contacts` | Adds pairs, timing, detector order, and the raw geometry of every body, statics included. |
| `full` | Adds ids, world order, `_nextId`, the collider pool, and the camera and view (#155). |

"Left out" rows remove one item from `full`. `control` compares two uninterrupted runs: the digest baseline.
"Max sled pos err" is rounded to 4 decimals, so `0` means below 0.0001 px. Those divergences still change
gameplay state within ticks: in `contact/game` the **score** digest diverges at tick 612 (K+12), and in
`hazard/game` at 482 (K+2).

| Fixture | Level | Left out | First divergent tick (after K) | First sled divergence | Max sled pos err (px) | Subsystems differing at the first divergent tick |
| --- | --- | --- | --- | --- | --- | --- |
| contact | control | - | **exact** (500 ticks) | exact | exact |  |
| contact | ghost | - | 601 (+1) | 601 | 5.0636 | runRandom, shardField, sled, runTimeMs, _hudMs, maxAirtimeMs, lastTotal, scrambleMs, openingGraces, safeSamples, shardChain, shardChainAt, shardTotal, shardCoun… |
| contact | game | - | 601 (+1) | 601 | 0 | sled, tricks, bsodState, bsodBluffs, matter.bodies, matter.worldOrder, matter.pairs, matter.ids, matter.timing, camera(#155) |
| contact | kinematic | - | 601 (+1) | 601 | 0 | sled, tricks, bsodState, matter.bodies, matter.worldOrder, matter.pairs, matter.ids, matter.timing, camera(#155) |
| contact | contacts | - | 601 (+1) | exact | exact | matter.worldOrder, matter.ids, camera(#155) |
| contact | full | - | **exact** (500 ticks) | exact | exact |  |
| contact | full | camera | 601 (+1) | exact | exact | camera(#155) |
| contact | full | ids | 601 (+1) | exact | exact | matter.worldOrder, matter.ids |
| contact | full | runRandom | 601 (+1) | 601 | 5.0499 | runRandom, sled, tricks, bsodState, bsodBluffs, matter.bodies, matter.pairs, camera(#155) |
| contact | full | impulses | 601 (+1) | 601 | 0 | sled, tricks, bsodState, matter.bodies, matter.pairs, camera(#155) |
| contact | full | staleSupport | **exact** (500 ticks) | exact | exact |  |
| contact | full | timing | 601 (+1) | 601 | 45.1217 | sled, tricks, bsodState, bsodBluffs, matter.bodies, matter.pairs, matter.timing, camera(#155) |
| contact | full | positionImpulse | **exact** (500 ticks) | exact | exact |  |
| contact | full | rawGeometry | 601 (+1) | 601 | 0 | sled, bsodState, bsodBluffs, matter.bodies, matter.pairs, camera(#155) |
| hazard | control | - | **exact** (520 ticks) | exact | exact |  |
| hazard | ghost | - | 481 (+1) | 481 | 7.6916 | runRandom, terrain, hazards, shardField, sled, runTimeMs, _hudMs, _crashHazard, maxAirtimeMs, lastTotal, shieldCharges, safeSamples, blinkMs, shardChain, shardC… |
| hazard | game | - | 481 (+1) | 481 | 0 | sled, tricks, bsodState, bsodBluffs, kodiaks, _teleMarks, matter.bodies, matter.worldOrder, matter.pairs, matter.ids, matter.timing, camera(#155), pool |
| hazard | kinematic | - | 481 (+1) | 481 | 0 | sled, tricks, bsodState, kodiaks, _teleMarks, matter.bodies, matter.worldOrder, matter.pairs, matter.ids, matter.timing, camera(#155), pool |
| hazard | contacts | - | 481 (+1) | exact | exact | matter.worldOrder, matter.ids, camera(#155), pool |
| hazard | full | - | **exact** (520 ticks) | exact | exact | Rerun 2026-11-22: `Hazard.teleAtMs` differs from K+1 (TelegraphTracker not serialized); all else exact, 280 ticks (see below) |
| hazard | full | camera | 481 (+1) | exact | exact | camera(#155) |
| hazard | full | ids | 481 (+1) | exact | exact | matter.worldOrder, matter.ids, pool |
| hazard | full | runRandom | 481 (+1) | exact | exact | runRandom |
| hazard | full | impulses | 481 (+1) | 481 | 0 | sled, tricks, bsodState, kodiaks, _teleMarks, matter.bodies, matter.pairs, camera(#155) |
| hazard | full | staleSupport | **exact** (520 ticks) | exact | exact |  |
| hazard | full | timing | 481 (+1) | exact | exact | matter.pairs, matter.timing |
| hazard | full | positionImpulse | **exact** (520 ticks) | exact | exact |  |
| hazard | full | rawGeometry | 481 (+1) | 481 | 0 | sled, bsodState, bsodBluffs, matter.bodies, matter.pairs |
| hazard | full | kodiaks | 481 (+1) | exact | exact | kodiaks |
| hazard | full | bsod | 481 (+1) | exact | exact | bsod, bsodState, bsodBluffs |
| hazard | full | hazardHit | **exact** (520 ticks) | exact | exact |  |
| hazard | full | pool | 481 (+1) | exact | exact | pool |

Reading the table:

- **GhostTape checkpoint restore (`ghost`) diverges at K+1 in both fixtures.** In `hazard/ghost`, these
  subsystems all differ at K+1: run clock, RNG streams, terrain generator, hazards, Kodiaks, BSOD, score,
  shields and tricks. Sled position error reaches 5.1 px (contact) and 7.7 px (hazard).
- **All game state with Matter restored by pose (`game`) still diverges at K+1**, in the sled's
  low bits (`positionPrev`/`anglePrev`, raw geometry, warm-start impulses). Score diverges at K+12 (contact)
  and K+2 (hazard).
- **`contacts` keeps the sled, score, Kodiaks and hazards exact for every compared tick.** Only ids and world
  order, the camera and the pool differ. In `hazard/contacts`, a hazard's `teleAtMs` diverges at 510 through
  the camera.
- **`full` is exact in every subsystem digest, every tick (500 and 520 ticks).** This covers Matter bodies,
  pairs, ids, timing, world and detector order, the pool, the camera, every RunScene SIM field, the generator,
  hazards, Kodiaks and RNG.
- **Ablations.**
  - In the game these break the sled at K+1: cached impulses, `engine.timing` (contact only, 45 px by the end),
    raw geometry, RNG (contact, because scramble is on).
  - The camera (#155) changes `h.teleAtMs` on hazards from tick 510. It is crash-report metadata, but it is
    stored on a sim object.
  - Some ablations diverge **only in the digest of the field that was left out**: `ids`, `camera`, `pool`,
    `kodiaks`, `bsod`, and `runRandom` in hazard. That shows the skip took effect, **not** that the item is
    causal. Their causality rests on elsewhere: source reading (Kodiak hits are crash hazards; the BSOD can
    catch the sled), E1 (ids K+43, pooled statics K+5), and the contact fixture (RNG through scramble, 5 px).
  - With only one dynamic body in the game, `staleSupport`, `positionImpulse`, ids, world order and the pool
    did not change the sled inside these windows. E1 shows each of them is real state that breaks exactness
    once multi-body contacts, new pairs or new pooled colliders occur.
- **Rerun on 2026-11-22 (after the review fixes): `hazard/full` is no longer exact on every digest.** It
  differs at K+1 in exactly one field: `Hazard.teleAtMs` on one hazard (A=3825 ms, B=4008 ms). The sled, score,
  Kodiaks, Matter state and every other subsystem stay exact for all 280 compared ticks. Rerunning with the
  previously committed Matter kit gives the same result, so the review fixes did not cause it.
  - Mechanism: the restored scene's `TelegraphTracker` is fresh, because its WeakMaps are not serialized. It
    re-warns a hazard that A had already warned, and stamps `teleAtMs` again.
  - Why the 2026-11-21 run did not hit this is **not yet explained**.
  - `teleAtMs` is crash-report and measurement metadata ("nothing in the game depends on it"), plus a repeated
    warning sound.
  - This is the TelegraphTracker prerequisite in section 11 showing up for real, not a new class of problem.
- **Game-level completeness checks fired for real:**
  - `_crashHazard.body: Matter body hazard has no stable key`: sim state referenced a despawned body. It is
    now encoded as an explicit dead reference.
  - `CONFIG look differs`: `look`/`palette` are re-resolved per biome sector, so they are presentation, not
    config.
  - Per-bear Kodiak `Rng` instances had to be **materialized with their prototype**, because the fresh scene
    has no live Kodiaks.
  - `TelegraphTracker`'s WeakMaps were flagged as non-serializable.
- **Size.** The JSON snapshot was 216 KB (contact) and **5.7 MB** (hazard). The hazard size comes from the
  6506 pooled colliders that teleporting to x=107000 left behind; TerrainMesh's `_bodyPool` never shrinks.
- **Digest hygiene.** An early control run differed only in **object key insertion order** inside the terrain
  generator (identical values) at tick 1141 of two uninterrupted runs. Generator object history is not
  identical even between identical runs (recycled chunk objects). The digests were made key-order-insensitive.
  Array, Map and Set order is still compared.

Raw results: `tools/savestate-experiment/results/{contact,hazard}.json` (per case: fixture stats, first
divergent tick, the subsystems and leaf fields at that tick, the first divergent tick of every subsystem,
restore log, field classification). Render with `node tools/savestate-experiment/results-table.mjs <files>`.

## 7. Findings worth knowing even without savestates

1. **GhostTape checkpoints cannot be used as restore points.** They are excellent desync detectors, which is
   their job. They hold a sled pose and a rounded score, and resuming from one diverges on the next tick.
2. **Matter private state is load-bearing**: the stale support slot, `positionImpulse` and `deltaTime`. A
   Matter upgrade can add state that a field-list serializer would silently miss; the audit catches that.
3. **The TerrainMesh collider pool made static geometry history-dependent** at the ULP level. **Resolved in
   v2.19.7 / SIM_REVISION 4:** colliders are now always built fresh and the pool is removed.
   - Before the fix, any scheme that rebuilds terrain had to carry raw collider bits or replay the pool history.
     That includes savestate, seek, rewind, and a server verifier rebuilding from chunk data.
   - The fix makes colliders a pure function of chunk data.
   - It changed tick outcomes, so it shipped as a physics-identity bump.
4. **#155 is confirmed as a savestate blocker**, beyond the frame-rate issue. The tick reads camera state, so a
   snapshot must carry the camera. The camera is history-dependent and integrated with frame dt.
5. **The terrain generator's cache is mutated by cosmetic reads**, including from UIScene's minimap on its own
   110 ms cadence. Physics is protected by #59's gate, but generator state is not a function of the tick.
6. **TelegraphTracker keys state by object identity** (WeakMap/WeakSet), so it cannot be serialized.
7. **The TerrainMesh `_bodyPool` is never trimmed.** After a jump, such as the fixture's teleport or a Gym
   reset, it can hold thousands of bodies (6506 here). Every pooled body is snapshot state while pooling
   changes collider bits.
8. **Sim objects hold references to despawned entities** (`_crashHazard` and its removed body). A serializer
   needs an explicit "dead reference" form.
9. **`Common._nextId` is page-global.** Any Matter body created by another scene, or by a ghost or preview,
   shifts every later id. The relative order of interacting bodies then matters for new pairs.

## 8. Serialization contract proposal (Phase 2 input, not a format decision)

Design rules:

- **Explicit schemas, not reflection.** The experiment's generic reflection walk was right for discovery and
  wrong for a contract. It captures presentation fields that live inside sim objects (`Hazard._lastDraw`,
  `sled.heliPhase`) and silently follows refactors.
- **Fail closed.** Restore throws on anything it cannot account for.

```
BbSavestateCacheV1 {   // working name; deliberately unlike any #152 manifest/fingerprint identifier
  kind: "bb-savestate-cache", version: 1,
  build: { gameVersion, physicsIdentity /* as defined by #152 v1.1 */, matterVersion: "0.20.0", savestateLayoutId },  // layout id = hash of the field tables below; NOT a state hash or fingerprint
  header: { seed, biomeMask, mode, loadout, upgrades, kodiaks, ... },           // CONFIG; restore rebuilds from it and verifies
  tick, runTimeMs,                                                              // tick boundary only (never mid-tick)
  rng: { [stream]: uint32 },                                                    // RunRandom + generator + glitch + per-Kodiak
  generator: TerrainGeneratorState,                                             // explicit fields incl. caches and array pool
  world: { chunkOrder: int[], chunkQueue: int[], collected: string[], hazards: HazardState[], powerups: PowerUpState[], shards },
  sim: { sled: SledState, score: ScoreState, tricks: TrickState, glitch, hints, bsod, bluff, kodiaks: KodiakState[], timers: {...}, effects: {...} },
  matter: {
    timing: { timestamp, lastDelta, timeScale }, nextId,
    worldOrder: key[], detectorOrder: key[],
    bodies: { [key]: { ids: int[], raw: BodyRaw } },                            // ALL bodies, incl. statics (pool) and the collider pool
    pairs: PairRaw[],                                                           // list order; vertex refs as [partKey, vertexIndex]
  },
  presentationReadBySim: { camera, view } | null,                              // must become null once #155 lands
  completeness: { fields: string[] }                                           // every field name written, for the audit
}
```

- **Numbers.** Plain JSON doubles round-trip exactly. `NaN`, `±Infinity` and `-0` need tagged encoding:
  `sled.airEtaMs` is `Infinity` and `shardChainAt` is `-1e9`.
- **Identity.**
  - Bodies are keyed by stable gameplay identity (`sled`, `terrain:<chunk>:<i>`, `pad:…`, `hazard:<chunk>:<i>`,
    `powerup:<key>`, `pool:<i>`), never by Matter id. Ids are data.
  - Object aliases (for example `sled.random === scene.runRandom`) are written once and referenced.
  - WeakMap state is forbidden in the snapshot domain.
- **Versioning.** `version` bumps on any schema change. `savestateLayoutId` is a hash of the per-class field
  tables, never of state. It is named so it cannot be mistaken for a #152 fingerprint or `causalDigest`. Changing a
  table changes it. Adding state without updating a table is caught by the capture-time audit instead. Restore
  refuses on any mismatch of
  version, physics identity, matterVersion or savestateLayoutId. There are no migrations: a savestate is a cache.

### Completeness checks: incomplete snapshots must fail visibly

1. **Capture-time audit.** Every own property of every snapshotted object must be listed in its class table as
   SIM, CONFIG, PRESENTATION or INFRA, and an unlisted property throws. The experiment does this for RunScene
   (0 unclassified) and for every Matter object (section 5). Known blind spots of the experiment's version,
   which Phase 2's explicit schemas should close:
   - It runs **once, at capture time**, over `Object.keys`. A field created lazily after the capture point is
     not seen until the next capture.
   - Classification is **by name only**. Fields classed INFRA, PRESENTATION or CONFIG are trusted, not checked.
     `content` and `tuner` are excluded from the CONFIG equality check.
   - The generic encoder **skips by name at every depth**: sub-fields named `palette`, `look`, `gfx` or `color`,
     plus every function and Phaser object. A sim field with one of those names would be invisible.
2. **Restore-time set checks.** The live world's body-key set must equal the snapshot's. Every pair must
   resolve to live parts. Every SIM field present in the fresh scene must be either in the snapshot or deleted
   with a log entry. CONFIG must match the header.
3. **Unrepresentable state is an error, not a skip**: WeakMap, WeakSet, accessors, class instances with no
   materializer, contact vertices on unknown parts.
4. **Self-test on save (Heavy Mode).** After capturing at tick K, restore into a scratch world, step one tick in
   both, and compare all subsystem digests. A mismatch marks the savestate untrusted. The experiment shows a
   single tick catches every missing Matter item (all K+1). It does **not** catch slow ones like id order
   (K+43) or the collider pool (K+5); those need checks 1 to 3.

## 9. Interaction with other work

- **#152 (Team A).** A savestate is a *cache of derived state*: large, tied to one build, and with no
  migrations. It is not a manifest: it neither proves nor replaces the run's history (seed, ruleset and input
  tape). "Trusted" here means "restores to the same simulation", never "this run was legitimately played".
  Public claims still need #152's verifiable ruleset and state. Digests here are diagnostic. If #152 publishes
  a canonical state hash, a savestate could embed it as `expectedStateHashAtTick` so a restore can be checked
  against the authoritative replay. That is optional and does not define the hash. No GhostTape or TapePlayer
  interface was changed.
- **Replay Contract v1.1** (#152, published 2026-11-22, canonical file at `dafb5ca`). It states that its
  fingerprint field lists are by design a **subset** of what a restorable snapshot needs. It asks #159 to send
  hidden causal variables through #152 change control, so fingerprints and savestates share one inventory.
  Its classifications agree with this study:
  - generator internals are non-causal (section 7.5);
  - telegraph and camera state are presentation (the camera only reached `Hazard.teleAtMs`, never physics or
    score, in E2);
  - relative id order and detector order are causal.

  This study adds candidates for a future subsystem schema bump, posted to #152:
  - the stale `collision.supports[1]` slot and the contact-slot vertex identity;
  - raw static collider bits (pool history);
  - pair `timeUpdated` relative to `engine.timing.timestamp`.

  None of these breaks v1.1; they matter for restore, not for detecting divergence. Savestates must reuse the
  contract's subsystem names and field ownership for the shared parts.
- **#56 GhostTape.** A run resumed from a savestate cannot produce a valid ghost tape unless the snapshot also
  carries the recorder (inputs and checkpoints so far). Per the owner's product contract (section 11):
  - a tier (a) suspend/resume keeps the tape from tick 0 and stays eligible;
  - a tier (b) reload marks the run tool-assisted.
- **#59 fixed tick.** Savestates are only defined at tick boundaries. `SimClock.accMs` and `_edges` are needed
  only for live resume.
- **#155.** Blocker for dropping camera state from the snapshot (section 7.4).

## 10. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Matter upgrade adds or renames private state | silent divergence | matterVersion pin, field audit, one-tick self-test |
| Game code adds state without updating a schema table | silent divergence | capture-time audit (unclassified field = error), savestateLayoutId |
| Presentation-to-sim leaks (#155, generator cosmetic reads, minimap) | snapshot must carry presentation | fix the leaks; until then capture camera and view |
| Pool and id history | exactness needs raw statics, the pool and ids | canonicalize collider construction (physicsVersion event) |
| Snapshot size (216 KB JSON in the contact fixture; 5.7 MB in the hazard fixture, which carries 6506 pooled colliders because `_bodyPool` never shrinks) | storage and perf for frequent saves | store chunk data by index plus a generator hash, binary encoding, delta vs a base |
| Slow divergences not caught by a one-tick self-test | false "trusted" | set checks plus longer verify on idle |
| Over-claiming trust | misuse as proof of a run | section 9: savestates are not manifests |

## 11. Phase 2: go/no-go and plan

**GO, conditional.** Exact equivalence is demonstrated in the real game, so the open questions are engineering,
not feasibility. The prerequisites for the production format:

1. ~~**#155** removes the `_view` read from the tick.~~ **Done** in v2.16.1 (#208).
2. ~~A **canonical terrain collider construction** lands as a physics-identity event.~~ **Done** in v2.19.7
   (SIM_REVISION 4, PR #222).
3. **TelegraphTracker** is re-keyed by stable hazard ids. **This is the remaining prerequisite.**

These cut the snapshot's R\* and "R today" rows and make the contract stable.

| Phase 2 work item | Estimate |
| --- | --- |
| Explicit per-class state schemas and serializers (Sled, Score, Tricks, Glitch, Hints, Bsod, Bluff, Kodiaks, Hazard, PowerUp, ShardField, TerrainGenerator, SimClock, RunRandom) with capture-time audit | 4-6 days |
| Matter layer (productionize `matter-snapshot-kit.js`: bodies, pairs, ids, order, pool) and a matterVersion gate | 2-3 days |
| World rebuild path (chunk order, collected sets, pool) and restore ordering | 2 days |
| Completeness checks and save-time self-test | 2 days |
| Differential test suite (contact, hazard, BSOD, Kodiak, crash, slow-mo/hit-stop, 30/60/120 Hz) in CI-runnable form | 3-4 days |
| Heavy Mode UX (save slot, resume, tool-assisted marking, ghost-tape continuation) | 3-5 days |
| **Total** | **about 3-4 engineer-weeks**, after the three prerequisites (#155 already assigned; canonical colliders about 1 day plus a tape migration decision; telegraph re-key about 1 day) |

**Coverage gaps in this study** (Phase 2 test suite must add them):

- **Gym and audio-timed paths are not exercised by any fixture.** `gymBeatSnapshot`, `gymReadyMs` and
  `gymBeatWaitMs` are in the SIM list, but a beat suggestion reads `AudioContext.currentTime`, so a Gym resume
  depends on audio state the snapshot cannot hold.
- **Mid-step events.** Snapshots exist only at tick boundaries, where `_contactQueue` is empty and
  `pendingCrash` is resolved. Collision callbacks inside a sub-step are covered only by that invariant, not by
  a snapshot taken inside a tick.
- **Frame-dt-dependent state** (the camera lerp) stays in the snapshot until #155 lands.
- **Slow-mo, hit-stop, crash beat, Gym retry, BSOD catch, and 30/120 Hz frame schedules** were not restored
  across.

**Phase 2 product contract** (owner decision, 2026-11-22)

- **Two tiers.**
  - **(a) Suspend/resume.** A suspend snapshot is single-use and is deleted on resume. The run stays
    leaderboard-eligible: the full input tape from tick 0 remains the proof, and verification never trusts the
    snapshot. A verifier replays the tape from tick 0, as #152 specifies.
  - **(b) Heavy Mode / practice save-load.** Players can save and reload at will. Any run that reloaded is
    marked **tool-assisted** and excluded from normal boards.
- **Build-bound.** A snapshot from a different build is rejected with "can't resume after update". There is no
  cross-version migration (consistent with section 8's version, physics identity, `matterVersion` and
  `savestateLayoutId` checks).
- **Future versioned runtimes, not now.** The owner plans to bundle earlier physics versions eventually, so old
  suspends and replays can resume on their original rules. That is explicitly **after the first release**. The
  first release has **no legacy physics, compatibility shims or migration code**. The only requirement now is not
  to preclude it: the snapshot header keeps the build and physics identity (`build.gameVersion`,
  `build.physicsIdentity`, `build.matterVersion`) so a future versioned-runtime loader can route a snapshot to
  the right rules.
- **Known gap, accepted pre-release.** Copying browser storage to retry a suspend is not defended. The future
  option is to record suspend events in the tape or manifest, so they are visible to verification.
- Implications for Phase 2:
  - The ghost recorder (inputs and checkpoints so far) must be part of the tier (a) snapshot, so the resumed
    run's tape is complete from tick 0.
  - The resume path must restore the recorder before the first resumed tick.

**Owner decisions**

| Decision | Status |
| --- | --- |
| Canonical terrain collider construction as a physics-identity-breaking change | **Decided YES** (owner, 2026-11-22: "pre-release, fewer than 3 players; now is the time for all breaking changes"). **Implemented in PR #222** (v2.19.7, SIM_REVISION 4; #140 had already shipped revision 3). All 7 golden canaries pass exactly, so none needs re-baselining. |
| Savestate purpose | **Decided** (owner, 2026-11-22): see "Phase 2 product contract" above |
| #155 (removing the camera read from the tick) | **Fixed on main** in v2.16.1 (#208 / #155) |

**No-go triggers:**

- ~~The owner rejects a physicsVersion bump for canonical colliders.~~ Resolved: the owner approved it on
  2026-11-22.
- #152 requires savestates to be authoritative evidence. That is out of scope by design.

## 12. Reproduce

```
node tools/savestate-experiment/matter-node-experiment.mjs        # E1 table (about 1 s)
npm test -- tests/determinism                                       # E1 pinned (16 tests)
npm run build && npx vite preview --port 8414 --strictPort &
GAME_URL=http://localhost:8414/ node tools/savestate-experiment/browser-experiment.mjs --json out.json   # E2 (about 30-40 min)
ONLY=contact:full node tools/savestate-experiment/browser-experiment.mjs --quick                         # one case
```

If Playwright's bundled Chromium revision is missing, set `CHROMIUM_PATH` (default
`/opt/pw-browsers/chromium_headless_shell`).
