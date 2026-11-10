# Bitstream Bluffs - Architecture Contract

Source of truth for the game: `docs/DESIGN-DOC.md`. This file is the source of truth for **how the pieces connect**.
Four engineers work in parallel on disjoint files. **Public signatures (class/function names, method params, event
names and payload shapes, data shapes, registry keys) are a contract.** If you must change one, edit this file and
the stub's JSDoc in the same change and tell the others in your hand-off. Additive changes (new optional fields, new
methods) are fine. Everything is plain JS ES modules + JSDoc; Phaser 3.90, Matter, Vite.

The legacy implementation in `js/` is untouched and unrelated; do not import from it.

## 1. File ownership

| Owner | Files (all under `src/` unless noted) |
|---|---|
| **Foundation (frozen, change only additively)** | `main.js`, `events.js`, `constants.js`, `services.js`, `data/index.js`, `data/schemas.js`, `ARCHITECTURE.md`, root `index.html`, `tests/src/contract.test.js` |
| **Core-logic** (NO Phaser imports) | `systems/Rng.js`, `systems/TerrainGenerator.js`, `systems/ScoreManager.js`, `systems/TrickTracker.js`, `systems/SaveStore.js`, `systems/DailyPatch.js`, `data/chunks/*.json`, `data/terrainMods/*.json`, `tests/src/**` (except `contract.test.js`) |
| **Gameplay** | `scenes/RunScene.js`, `entities/*` (`Sled`, `TerrainMesh`, `Hazard`, `PowerUp`, `TrailParticles`, plus new ones), `systems/PhysicsTuner.js`, `data/hazards/*.json`, `data/powerups/*.json` |
| **Input/audio/glitch** | `systems/InputRouter.js`, `systems/VirtualPad.js`, `systems/AudioSynth.js`, `systems/GlitchDirector.js` (no Phaser imports), `shaders/glitch.frag`, `shaders/GlitchPipeline.js` |
| **UI** | `scenes/PreloadScene.js`, `TitleScene.js`, `UIScene.js`, `PauseScene.js`, `GameOverScene.js`, `data/palettes.json`, `ui/*` (`ui/Palette.js` exists and works; extend, don't rename) |

Rules: never edit a file you do not own (ask via the hand-off). New helper files are fine inside your own area
(e.g. gameplay may add `entities/Camera*.js`). New pure-logic helpers needed by two owners go in `systems/` and are
registered in the table by whoever creates them. Pure-logic modules **must not** import `phaser` (Jest cannot load
it) and must not use `import.meta`, `window`, or `Math.random`/`Date.now` for anything seed-dependent.

Terrain-mod JSON lives in `data/terrainMods/` (core-logic owns it because the generator places the zones; gameplay
reads `physics` from it at runtime).

## 2. Boot and scene flow

```
main.js (Phaser.Game, WEBGL, 480x270 FIT, matter autoUpdate:false, GlitchPipeline registered in postBoot)
  PreloadScene --createServices()--> TitleScene --start--> RunScene (+ UIScene launched in parallel)
                                                              | Esc            ^ resume
                                                              v                |
                                                         PauseScene (on top; RunScene paused)
  RunScene --crash--> RUN_END --> GameOverScene --Space/tap (instant retry, same seed)--> RunScene
  GameOverScene / PauseScene(quit) --> TitleScene
```

* `PreloadScene.create()` calls `createServices(game)` then `scene.start(TITLE)`.
* `TitleScene` writes the chosen seed to `registry REG.SEED`, calls `audio.unlock()` on first input, starts `RUN`.
* `RunScene.create()` launches `UIScene`; on crash it stores the record in `REG.LAST_RECORD`, emits `RUN_END`, waits
  <= `TIMING.crashToGameOverMs`, then `scene.start(GAME_OVER)` (this also shuts RunScene down; it must stop `UIScene`).
* Pause: RunScene reacts to `pad.pressed.pause`: emit `GAME_PAUSE`, `scene.pause()`, `scene.launch(PAUSE, {runTimeMs})`.
  PauseScene resume: `scene.stop()`, `scene.resume(RUN)`, emit `GAME_RESUME`. Quit: emit `RUN_ABORT`, stop RUN+UI+PAUSE,
  start `TITLE` (nothing is saved for an aborted run).
* Retry keeps the **same seed**. Title screen can pick a new/daily seed.

### Restart-in-under-10-seconds budget (pillar 3)
No assets are loaded, so: page load -> first interactive title <= `TIMING.maxBootToPlayMs` (3 s); crash -> GameOver
<= 1.2 s; GameOver retry key -> first RunScene frame <= 0.5 s. Therefore: `RunScene.create()` must be synchronous and
fast (generate only the first buffer of chunks), GameOverScene must accept retry input **immediately** (not wait for
IndexedDB/leaderboard queries), and nothing may `await` network. Never rebuild services on retry.

## 3. Data shapes

Authoritative typedefs: `src/data/schemas.js` (terrain/content), `src/events.js` (payloads),
`systems/SaveStore.js` (`Settings`, `RunRecord`), `systems/TrickTracker.js` (`SledFrameState`, `TrickEvent`,
`LandingResult`), `systems/VirtualPad.js` (`VirtualPadState`). Read them; the key points:

* **Coordinates / units**: world px, x right (downhill), **y down**; angles in **degrees, clockwise positive**;
  velocities px/s in all *interfaces* (Matter-native units only inside gameplay code, see section 7);
  distance metres = `px / PIXELS_PER_METER` (20). Time ms.
* **TerrainChunk**: `{index, defId, kind, startX, endX, points[{x,y}], zones[{modId,x0,x1}], gaps[{x0,x1}],
  bouncePads[{x,y,width,boost}], hazards[{defId,x,y,rotationDeg}], powerups[{defId,x,y}]}`. Guarantees the generator
  must keep and gameplay may rely on: `x` strictly increasing; spacing between consecutive points in
  `[TERRAIN.minPointSpacingPx, maxPointSpacingPx]`; chunk borders share the exact same point; `|slope| <
  TERRAIN.maxSlopeDeg` on spline chunks; gap spans start and end exactly on polyline points and have **no collider and
  no mesh** between them; hazards sit on the surface (`y` = ground height at `x`); power-up `y` is already lifted above
  ground. Chunk 0 starts at `x = 0` with a gentle run-in.
* **Chunk templates** (`data/chunks/*.json`, `ChunkDef`): `kind: 'spline'` (bezier control points + seeded jitter),
  `'noise'` (1-D noise params, used for difficulty spikes), `'bridge'` (wireless bridge: gap + bounce pads). Adding a
  JSON file adds content; nothing is hard-coded.
* **Hazards** (`HazardDef`): `{id, shapeKey, size{w,h}, onHit{effect: crash|slow|scramble, durationMs?, speedFactor?},
  weight, minDistanceM, placement, colorKey}`. Ids: `glitchChasm`, `overflowFirewall`, `packetSpike`,
  `garbageDataVent`. **Power-ups** (`PowerUpDef`): ids `clockPulse` (slowmo), `packetBurst` (speedBoost), `hashedBackup`
  (shield); spawn chance per candidate slot = `baseChance / (1 + distanceM / distanceDecayM)`. **Terrain mods**
  (`TerrainModDef`): ids `highBandwidth` (frictionMul), `compression` (gravityMul), `wirelessBridge` (bounceMul).
  Colours are palette keys (`colorKey`), never raw hex.
* **TrickTracker input** `SledFrameState`: `{timeMs, dtMs, x, y, vx, vy, angleDeg (UNWRAPPED, continuous),
  angularVelDegS, grounded, groundAngleDeg, input{heli, airBrake, parachute}, crashed}`. Output `TrickUpdate`:
  `{tricks: TrickEvent[], landing: LandingResult|null, airborne, airtimeMs, rotationDeg}`. Trick types:
  `backflip` (CCW body rotation), `frontflip` (CW), `helicopterCCW/CW` (arrow-key driven spin), `airBrake`, `parachute`.
  Landing quality `perfect|good|sloppy|crash` from angle-vs-slope and impact speed (thresholds are the core engineer's;
  expose them as named constants in `TrickTracker.js`).
* **VirtualPadState** (design doc 4.1 wins over section 12: **S = brake, A+D together = tuck**):
  `push` (W) , `tilt` (-1..1; A = -1 = tilt back/CCW, D = +1 = forward/CW; both = 0), `tuck`, `brake` (S),
  `hop` (Space), `reset` (Shift), `heli` (-1 left arrow CCW / +1 right arrow CW), `airBrake` (Up), `parachute` (Down),
  `pause` (Esc/Start), `pressed{hop,reset,pause,airBrake,parachute,confirm}` one-shot edges, `lastSource`.
  Gamepad: left stick X = tilt, RT = push, face buttons = tricks; touch overlay maps to the same fields.
* **Settings**: `{version, masterVolume, musicVolume, sfxVolume (0..1), screenShake, palette: 'default'|'colorblind',
  touchOverlay: 'auto'|'on'|'off', touchRotate90, lastInitials}`. Live copy at `registry REG.SETTINGS`.
* **RunRecord**: `{version, id, seed, dailyRuleId, startedAt, endedAt, durationMs, score, distanceM, trickPoints,
  tricks{type:count}, bestCombo, maxAirtimeMs, cause: 'crash'|'quit', ledgerHash, initials?}`.
  `ledgerHash = SaveStore.computeLedgerHash(record)`. RunScene builds it and calls `saveRun` (no initials);
  GameOverScene later calls `setInitials(id, initials)` (3+ chars). Leaderboard = runs with initials.
* **DailyRule.modifiers** (multipliers, default 1): `tuckSpeedMul, tuckSteerMul, gravityMul, frictionMul,
  airControlMul, pushForceMul`. The daily rule (chosen from the UTC date) applies to **every** run that day and its id is
  stored in every RunRecord. RunScene reads `DailyPatch.getDailyInfo()` once at run start and feeds `rule.modifiers`
  to `PhysicsTuner`.
* **Scoring** (`ScoreManager`): distance +1/m (whole metres, monotonic); trick value = `SCORING.trickBase[type] x
  rotation x airtime modifier` (core engineer defines the two factors, documents them in the file header); combo x1,
  +0.25 per *unique* trick type before landing; tricks are **provisional until landing** and are discarded on crash;
  perfect landing +20; Shift reset = drop pending combo + `resetPenaltyPoints` (doc says "-1 combo"/"-score"; we do both).

## 4. Services and registry (who creates what, and when)

| Registry key (`REG.*`) | Created by | When | Lifetime |
|---|---|---|---|
| `SAVE_STORE`, `SETTINGS`, `CONTENT`, `INPUT`, `AUDIO` | `createServices(game)` (`services.js`), called by `PreloadScene.create()` | once, at boot | whole session |
| `SEED` | `createServices` (random default); overwritten by `TitleScene` | boot / title | until changed |
| `LAST_RECORD` | `RunScene` | on run end | until next run end |

Per-run objects (**not** in the registry; created by `RunScene.create()` and dropped on shutdown): `Rng`-seeded
`TerrainGenerator`, `ScoreManager`, `TrickTracker`, `GlitchDirector`, `PhysicsTuner`, `Sled`, `TerrainMesh`, entity
pools. Inject content as `new TerrainGenerator({seed, chunkDefs: content.chunks, hazardDefs: content.hazards,
powerupDefs: content.powerups, modDefs: content.terrainMods})`. Pure modules never read the registry.

`updateSetting(game, key, value)` (services.js) is the only way to change settings (persists + emits
`SETTINGS_CHANGED`). Palette colours: `getPalette(game)` / `getPaletteCss(game)` from `ui/Palette.js`; re-read on
`SETTINGS_CHANGED`. Nobody hard-codes colours.

Seeding: `Rng(seed)` hashes the seed string with xxHash32; use `rng.fork('terrain' | 'glitch' | 'music' | ...)` so
subsystems have independent deterministic streams. Same seed => identical terrain, spawns and glitch schedule.

## 5. Events

All on `scene.game.events` (global emitter), one payload object each. Names are in `EVT` (`events.js`), payload
typedefs are next to it. **Always remove listeners on scene shutdown.** Pure-logic modules never emit; RunScene is the
only gameplay emitter.

| Event | Emitter | Listeners |
|---|---|---|
| `RUN_START` | RunScene | AudioSynth (start music), UIScene (reset HUD), GlitchPipeline |
| `RUN_END` | RunScene | AudioSynth (stop music), UIScene |
| `RUN_ABORT` | PauseScene | AudioSynth (stop music) |
| `CRASH`, `RESPAWN`, `LANDING`, `TRICK`, `HAZARD_HIT`, `POWERUP_COLLECTED`, `POWERUP_EXPIRED`, `EFFECT_END` | RunScene | AudioSynth (SFX), UIScene (popups/indicators) |
| `COMBO_CHANGED`, `SCORE_CHANGED`, `DISTANCE_CHANGED` | RunScene (from ScoreManager results) | UIScene |
| `ZONE_ENTER`, `ZONE_EXIT` | RunScene (compares `getZonesAt(sled.x)` each frame) | UIScene (indicator), AudioSynth |
| `GLITCH_START`, `GLITCH_END` | RunScene (from `GlitchDirector.update`) | GlitchPipeline (shader intensity), AudioSynth (glitch bus), UIScene (flicker) |
| `GAME_PAUSE` | RunScene | AudioSynth (duck), UIScene |
| `GAME_RESUME` | PauseScene | AudioSynth, RunScene (re-enable input) |
| `SETTINGS_CHANGED` | `updateSetting()` | AudioSynth, InputRouter, UIScene, RunScene (screenShake), anything cached from palette |
| `INPUT_ACTION` | InputRouter | Title/Pause/GameOver scenes (menus), AudioSynth (unlock on first) |

Gameplay input is **polled**: `inputRouter.poll()` once per frame in `RunScene.update` (it consumes one-shot edges).
Menu scenes use `INPUT_ACTION` (or Phaser keyboard, since menus are simple) - but menus must work with gamepad + touch
too, so prefer `INPUT_ACTION`.

Glitch interval: doc section 2 says 3-6 s, section 9 says 5-15 s. Decision: start in `GLITCH.earlyGapMs` (5-15 s) and
blend to `GLITCH.lateGapMs` (3-6 s) as distance passes `TERRAIN.difficultyRampStartM`. Event duration 50-200 ms.
`GlitchDirector.update(runTimeMs, distanceM)` is pure; `runTimeMs` excludes paused time so glitches are deterministic.

## 6. Who does what in one frame (RunScene.update, gameplay owner)

1. `pad = inputRouter.poll()`; handle `pressed.pause` / `pressed.reset`.
2. `stepWorld(this.matter.world, delta, beforeStep)` - sub-steps <= 8 ms; apply controls/forces inside `beforeStep`.
3. Build `SledFrameState`, `trickTracker.update()`; for each trick `scoreManager.addTrick()` then emit `TRICK` and
   `COMBO_CHANGED`; on landing `scoreManager.onLanding()` then emit `LANDING`, `COMBO_CHANGED`, `SCORE_CHANGED`.
4. `scoreManager.setDistance(x / PIXELS_PER_METER)` -> emit `DISTANCE_CHANGED` / `SCORE_CHANGED` when it returns true.
5. `terrain.update(sled.x)` -> `TerrainMesh.addChunk` / `removeChunk`, spawn/despawn hazards and power-ups from chunk
   lists (spawn lists are already deterministic; do not re-roll).
6. `glitchDirector.update(runTimeMs, distanceM)` -> emit `GLITCH_START/END`.
7. Camera: lerp follow X with look-ahead; Y keeps the rider ~1/3 from top. Shake only if `settings.screenShake`.

## 7. Physics: design-doc units -> Phaser Matter

Doc values live in `constants.PHYSICS` in px / s / degrees. Phaser 3.90 Matter integrates in **px per step** with a step
delta in ms. Conversions (helpers in `PhysicsTuner.js`, gameplay may fix them but keep names):

| Doc quantity | Matter | Formula |
|---|---|---|
| Gravity 900 px/s^2 | `world.gravity.y` with default `gravity.scale = 0.001` | `g / 1000` => **0.9** (already set in `main.js`) |
| Velocity v px/s | `Body.setVelocity` is px **per step** | `v * stepMs / 1000` (`pxPerSecToStep`); inverse `stepToPxPerSec` |
| Tilt torque 420 deg/s^2 | change of `angularVelocity` (rad/step) per step | `deg2rad(420) * (stepMs/1000)^2` (`angAccelToStep`); air control multiplies by `0.7` |
| Drag 0.015 | `body.frictionAir` | use 0.015 directly (Matter scales it by step time; verify at 8 ms steps, tune in `PhysicsTuner`) |
| Tuck -15% gravity | one dynamic body only | multiply `world.gravity.y` by `tuckGravityMul` while tucked (set it each sub-step) |
| Parachute (gravity x0.5 for 0.8 s) | same | gravity multiplier + steer lock timer |
| Air brake (-25% horizontal speed) | velocity scaling | `vx *= 1 - 0.25 * stepMs/1000 * k` or one-shot; gameplay tunes feel |
| Slo-mo (Clock Pulse) | `world.timeScale`/engine timing | scale the delta passed to `stepWorld`, **not** the 8 ms limit |

* **Sub-stepping**: `autoUpdate` is `false` in `main.js`. `RunScene` must advance physics only via
  `stepWorld()` (<= `MAX_PHYSICS_STEP_MS` = 8 ms per `matterWorld.step`). Clamp frame delta to <= 50 ms first.
* **Rotation sign**: Matter angle is radians, clockwise positive on screen (y down). Interfaces use degrees; convert at
  the Matter boundary only. `SledFrameState.angleDeg` must be unwrapped.
* **Collision**: sled + rider = one compound body (`Matter.Body.create({parts:[...]})`; get the namespace from
  `Phaser.Physics.Matter.Matter`). Terrain colliders: static, **thick** convex quads per polyline segment (>= 24 px deep) so
  fast sleds (~800 px/s = 6.4 px per 8 ms step) never tunnel; skip `gaps`. Hazards and power-ups are **sensors**.
* **Terrain mods** are applied by multiplying effective physics from `TerrainModDef.physics` (`frictionMul`,
  `gravityMul`, `bounceMul`) - `PhysicsTuner.getEffective(ctx)` is the single place that combines base, tuck, zones, daily
  rule, and effects.
* `Hashed Backup` negates one crash: `CRASH` is emitted with `negated: true` and the run continues (respawn
  reason `'backup'`, then `POWERUP_EXPIRED` reason `'consumed'`).

## 8. Persistence

* `localStorage` key `STORAGE.settingsKey` -> `Settings` JSON (versioned; unknown keys ignored, missing keys defaulted).
* IndexedDB `STORAGE.dbName`, object store `runs` keyed by `id`. All run APIs are async. Must fall back to memory if
  IndexedDB/localStorage is unavailable (tests run in jsdom, which has no `indexedDB`).
* Sharecode = leaderboard exported as a copy/paste string; import dedupes by run id and never throws.

## 9. Tooling notes

* Vite resolves `import frag from './glitch.frag?raw'` - only `GlitchPipeline.js` uses it. `data/index.js` uses
  `import.meta.glob`. **Neither can be imported from Jest**; pure modules and tests must stay clear of them. Tests that
  need content read JSON via `fs.readFileSync` and inject it.
* Jest config: `package.json` -> `testMatch **/tests/**/*.test.js`, ESM via `--experimental-vm-modules`, jsdom env,
  `moduleNameMapper` strips `.js` extensions. New tests go in `tests/src/**/*.test.js`.
* Phaser 3.60+ API only: particles are `scene.add.particles(x, y, texture, config)` (no `createEmitter`); post-FX via
  `PostFXPipeline` + `camera.setPostPipeline`.
* A block comment cannot contain `*/` - writing `FOO_*/BAR` in JSDoc breaks the Vite build.
* Dev: `npm run dev` (vite, port 5173); headless boot check exposes `window.__bbGame`.
