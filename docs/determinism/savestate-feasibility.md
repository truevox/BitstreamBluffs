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

**Recommendation: GO for Phase 2, scoped and gated** (section 11). Three items should land before any savestate
counts as "trusted":

1. #155 removes the camera read from the tick.
2. The terrain collider pool stops changing collider bits.
3. Telegraph state stops being keyed by object identity.

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
capture fails on an unclassified one. At tick K the counts were SIM 88, CONFIG 28, PRESENTATION 20,
PRESENTATION_READ_BY_SIM 7, NON_SERIALIZABLE 1, METADATA 5, INFRA 30, unclassified **0**.

### 4.1 Matter engine and world

| Item | Class | Evidence |
| --- | --- | --- |
| `position`, `angle` (body and parts) | R | trivially |
| `positionPrev`, `anglePrev` | R | Verlet. Pose-only restore diverges at K+1 (E1, E2) |
| `velocity`, `angularVelocity`, `speed`, `angularSpeed` | D | re-derived each step. Read by game code between ticks, so restore them consistently |
| `body.deltaTime` | R | `_timeCorrection` (E1 ablation: K+1) |
| `force`, `torque` | R (zero at a tick boundary today) | cleared by `_bodiesClearForces`; capture anyway |
| `positionImpulse` | R | position warming (E1 ablation: K+1) |
| `constraintImpulse` | R (zero today, no constraints) | |
| raw `vertices`, `axes`, part `position`, `bounds` of dynamic bodies | R | incremental integration (E1 ablation `rawGeometry`: K+1) |
| raw geometry of **static** colliders | R today | the TerrainMesh pool makes vertex bits history-dependent (E1 `pooled`: 39 of 120 quads differ by up to 1.1e-13 px; diverges at K+5 unless captured) |
| `motion`, `sleepCounter`, `isSleeping` | R (inert, sleeping off) | |
| `pairs.list` order and `pairs.table` | R | Gauss-Seidel order and warm-start lookup |
| per pair: `contacts[i].vertex` (identity), `normalImpulse`, `tangentImpulse`, `contactCount`, `separation`, `isActive`, `isSensor`, `timeCreated`, `timeUpdated`, `inverseMass`, `friction`, `frictionStatic`, `restitution`, `slop` | R | E1 ablation `impulses`: K+1 |
| per collision record: `bodyA`/`bodyB` order, `normal`, `tangent`, `penetration`, `depth`, `supportCount`, **both** `supports` slots | R | E1 ablation `staleSupport`: K+1 |
| `engine.timing.timestamp`, `lastDelta`, `timeScale` | R | ends pairs (E1 ablation `timing`: K+1) |
| body and part **ids**, `Common._nextId` | R | new-pair orientation (E1 `permuted`: K+43). Future bodies take ids from `_nextId` |
| world body order (`world.bodies` and `cache.allBodies`) | R (tie-break) | broadphase ties after the next world change. No effect seen in these fixtures, cheap |
| detector sort order | R (tie-break) | same |
| orphan pairs | D (drop) | event-only |
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
| `currentPhys`, `_hopped`, `_pushed`, `_biomeSector`, `_lastBiome`, `gym*`, `_manual*`, `_leaving` | R | |
| `TelegraphTracker` (`teleTracker`) | **not serializable** | `WeakMap`/`WeakSet` keyed by Hazard identity. Drives audio cues and `h.teleAtMs` (crash-report metadata), not physics or score. Must be re-keyed by stable hazard ids before Phase 2 |
| `_teleMarks` | R (derived each tick) | |
| `_view`, `_camX`, `_camY`, `_zoom`, `_zoomKick`, `shakeAmp`, `_landingShake`, `cameras.main` scroll/zoom | **R\*** | `updateGroundTelegraph` reads `this._view.right` (#155). `updateCamera` lerps from history with **frame** dt. E2 `-camera` diverges at K+1 |
| seed, biomeMask, daily*, loadout, upgrades, boostFx, magnetsDrop, kodiaksOn, kodiakPackMode, startX, content, tuner, settings, palette, look, bestM | D | verified equal on restore (`snap.config`; mismatch throws) |
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

Ablations: each removes one item from `full` in the `same` world. Every row is the first divergent tick, then
the maximum position error over 600 ticks.

| Left out | First divergent tick | Max position error (px) |
| --- | --- | --- |
| cached contact impulses | K+1 | 400.5 |
| stale `supports[1]` slot | K+1 | 783.6 |
| `engine.timing` | K+1 | 46.5 |
| `positionImpulse` | K+1 | 71.3 |
| `body.deltaTime` | K+1 | 123.4 |
| raw geometry (rebuilt from pose) | K+1 | 909.5 |
| detector order / world order | exact (no ties in this fixture) | 0 |

Incomplete snapshots fail visibly (`incompleteChecks`):

- A missing body throws "world body set differs".
- A wrong version throws.
- A pair that references an unknown part throws.
- An uncaptured Matter field throws: the audit lists every own property of every body that is neither
  captured nor declared config. Adding `sled.myNewState` shows up at capture.

All of these are pinned in `tests/determinism/savestate-matter.test.js` (12 tests).

## 6. E2: real game results

<!-- BROWSER_RESULTS -->

## 7. Findings worth knowing even without savestates

1. **GhostTape checkpoints cannot be used as restore points.** They are excellent desync detectors, which is
   their job. They hold a sled pose and a rounded score, and resuming from one diverges on the next tick.
2. **Matter private state is load-bearing**: the stale support slot, `positionImpulse` and `deltaTime`. A
   Matter upgrade can add state that a field-list serializer would silently miss; the audit catches that.
3. **The TerrainMesh collider pool makes static geometry history-dependent** at the ULP level. Any scheme that
   rebuilds terrain (savestate, seek, rewind, a server verifier rebuilding from chunk data) must carry raw
   collider bits or replay the pool history. A one-line canonicalization fix (build each collider from
   absolute vertices, never translate a recycled body) would make colliders a pure function of chunk data. It
   changes tick outcomes of existing tapes, so it is a physicsVersion event; flagged, not done.
4. **#155 is confirmed as a savestate blocker**, beyond the frame-rate issue. The tick reads camera state, so a
   snapshot must carry the camera. The camera is history-dependent and integrated with frame dt.
5. **The terrain generator's cache is mutated by cosmetic reads**, including from UIScene's minimap on its own
   110 ms cadence. Physics is protected by #59's gate, but generator state is not a function of the tick.
6. **TelegraphTracker keys state by object identity** (WeakMap/WeakSet), so it cannot be serialized.
7. **`Common._nextId` is page-global.** Any Matter body created by another scene, or by a ghost or preview,
   shifts every later id. The relative order of interacting bodies then matters for new pairs.

## 8. Serialization contract proposal (Phase 2 input, not a format decision)

Design rules:

- **Explicit schemas, not reflection.** The experiment's generic reflection walk was right for discovery and
  wrong for a contract. It captures presentation fields that live inside sim objects (`Hazard._lastDraw`,
  `sled.heliPhase`) and silently follows refactors.
- **Fail closed.** Restore throws on anything it cannot account for.

```
SavestateV1 {
  kind: "bb-savestate", version: 1,
  build: { gameVersion, physicsVersion, matterVersion: "0.20.0", schemaHash },  // schemaHash = hash of the field tables below
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
- **Versioning.** `version` bumps on any schema change. `schemaHash` is a hash of the per-class field tables, so
  a code change that adds state without updating a table changes it. Restore refuses on any mismatch of
  version, physicsVersion, matterVersion or schemaHash. There are no migrations: a savestate is a cache.

### Completeness checks: incomplete snapshots must fail visibly

1. **Capture-time audit.** Every own property of every snapshotted object must be listed in its class table as
   SIM, CONFIG, PRESENTATION or INFRA. An unlisted property throws. The experiment does this for RunScene
   (0 unclassified) and for Matter bodies.
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
- **#56 GhostTape.** A run resumed from a savestate cannot produce a valid ghost tape unless the snapshot also
  carries the recorder (inputs and checkpoints so far). Heavy Mode should mark resumed runs as tool-assisted:
  local-first, and distinguishing human, AI and tool-assisted outcomes per the issue.
- **#59 fixed tick.** Savestates are only defined at tick boundaries. `SimClock.accMs` and `_edges` are needed
  only for live resume.
- **#155.** Blocker for dropping camera state from the snapshot (section 7.4).

## 10. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Matter upgrade adds or renames private state | silent divergence | matterVersion pin, field audit, one-tick self-test |
| Game code adds state without updating a schema table | silent divergence | capture-time audit (unclassified field = error), schemaHash |
| Presentation-to-sim leaks (#155, generator cosmetic reads, minimap) | snapshot must carry presentation | fix the leaks; until then capture camera and view |
| Pool and id history | exactness needs raw statics, the pool and ids | canonicalize collider construction (physicsVersion event) |
| Snapshot size (about 213 KB JSON at tick 600; dominated by generator chunk points and static colliders) | storage and perf for frequent saves | store chunk data by index plus a generator hash, binary encoding, delta vs a base |
| Slow divergences not caught by a one-tick self-test | false "trusted" | set checks plus longer verify on idle |
| Over-claiming trust | misuse as proof of a run | section 9: savestates are not manifests |

## 11. Phase 2: go/no-go and plan

**GO, conditional.** Exact equivalence is demonstrated in the real game, so the open questions are engineering,
not feasibility. Phase 2 should not start the production format until three things are done:

1. **#155** removes the `_view` read from the tick.
2. A **canonical terrain collider construction**, or pool-free construction, lands as a physicsVersion event
   with Team A sign-off.
3. **TelegraphTracker** is re-keyed by stable hazard ids.

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

**No-go triggers:**

- The owner rejects a physicsVersion bump for canonical colliders. Savestates must then carry and replay the
  pool forever.
- #152 requires savestates to be authoritative evidence. That is out of scope by design.

## 12. Reproduce

```
node tools/savestate-experiment/matter-node-experiment.mjs        # E1 table (about 1 s)
npm test -- tests/determinism                                       # E1 pinned (12 tests)
npm run build && npx vite preview --port 8414 --strictPort &
GAME_URL=http://localhost:8414/ node tools/savestate-experiment/browser-experiment.mjs --json out.json   # E2 (about 30-40 min)
ONLY=contact:full node tools/savestate-experiment/browser-experiment.mjs --quick                         # one case
```

If Playwright's bundled Chromium revision is missing, set `CHROMIUM_PATH` (default
`/opt/pw-browsers/chromium_headless_shell`).
