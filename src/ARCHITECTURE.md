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

## Input/Audio/Glitch addenda

All additive; no existing signature or payload changed.

* **VirtualPad**: `setTilt(value, source = 'gamepad')` has an optional 2nd arg (analog sources `'gamepad'` / `'device'`;
  largest magnitude wins; output is rescaled outside the 0.15 dead-zone). New: `releaseSource(source)`,
  `setOverlayContext(visible)`. New helper file `systems/TouchOverlay.js` (DOM only). The touch overlay is shown only
  while a run is active (InputRouter listens to `RUN_START` / `RUN_END` / `RUN_ABORT` / `GAME_PAUSE` / `GAME_RESUME`), in
  mode `touchOverlay: 'on'`, or `'auto'` on touch devices. `touchRotate90` = device roll (steering-wheel style, screen-orientation
  aware, +-30 degrees = full tilt) feeds the analog tilt; on iOS the permission prompt is requested on the first touch.
* **InputRouter INPUT_ACTION mapping**: Esc and gamepad Start emit `'pause'` only (menus treat it as back); `'cancel'` =
  Backspace / gamepad B. Space and gamepad A emit `'hop'` + `'confirm'`; Enter `'confirm'`; W/A/S/D and arrows also emit
  `'up'/'left'/'down'/'right'` (direction actions auto-repeat); Up/Down arrows additionally `'airBrake'`/`'parachute'`.
  `'anyKey'` fires on every first press of any key / gamepad button / touch pointer (touch taps do NOT emit `'confirm'`:
  scenes needing tap-to-confirm should use Phaser pointer events or `'anyKey'` with `source === 'touch'`).
  Keys typed into `input`/`textarea` are ignored; Ctrl/Meta/Alt combos are ignored.
* **Gamepad** (standard mapping, Steam Deck): left stick X analog tilt, RT push, LT tuck, A hop(+confirm), B brake(+cancel),
  X air brake, Y parachute, LB/RB (or right stick X) helicopter CCW/CW, Back reset, Start pause, d-pad = menu + digital tilt.
* **AudioSynth** additive methods: `setSpeed(pxPerSec)` (wind whoosh + music intensity; RunScene should call it every frame),
  `setIntensity(0..1)`. Music intensity also follows `DISTANCE_CHANGED`. There is **no event for push or hop**, so RunScene
  must call `audio.playSfx('push')` / `playSfx('hop')` itself. Everything else is event driven (also `COMBO_CHANGED`
  reason `'trick'` -> `combo` SFX, `ZONE_ENTER` -> soft blip). It never throws without WebAudio.
* **GlitchDirector**: event ids are `g<n>-<4 hex>`; the hex tag is the seed-derived pattern that `GlitchPipeline` uses
  (RunScene just forwards `id/kind/durationMs/intensity`). Extra exports: `glitchRamp`, `glitchGapRange`, `preview(count)`.
  The gap blend runs from 0.5 x to 1.0 x `TERRAIN.difficultyRampStartM` (early 5-15 s below 500 m, 3-6 s from 1000 m).
* **GlitchPipeline**: also self-expires an event `durationMs + 60 ms` after start (pause-safe), runs in "safe" mode
  (weaker, no inversion flicker) when `settings.screenShake === false`, and composites transparent camera pixels over the
  game's clear colour. Extra uniforms: `uKind`, `uSeed`, `uSafe`, `uCrt`, `uBg`. The always-on CRT layer exists only on
  cameras where `install()` was called (RunScene).

## Core-logic addenda

All additive; no public signature changed.

* **Geometry conventions** (TerrainGenerator): `hazards[].x` and `bouncePads[].x` are the **centre** of the object
  (pads are `width` wide around it, always on solid ground ending before the gap). Points are evenly spaced at 16 px
  (`SPACING_PX`); a bridge chunk's polyline also has interior points inside the gap, which gameplay must skip (no
  collider/mesh between `gaps[i].x0` and `.x1`; falling into the gap is a miss, handle as a fall/crash). Hazards never
  appear on bridge chunks, inside gaps, on steep ground, within 700 px of the start, or closer than 480 px to each other
  (also across chunk borders). Power-ups are never within 90 px of a hazard.
* **Chunk lifetime**: `update()` returns `removed` indices; the chunk *objects* are recycled one `update()` later, so
  do not keep references to removed chunks past the frame you receive them (key your meshes/entities by `chunk.index`).
  Do not mutate chunk objects. `getChunk(i)` returns the live object when active, otherwise a fresh copy.
* **Extra TerrainGenerator members** (optional): `getChunkAt(x)`, `stats`, `difficultyAt()` extended values. `heightAt`,
  `slopeDegAt`, `getZonesAt` work for any x >= 0 (slightly ahead of the window they extend it and the new chunks are
  reported in the next `update().added`; far outside the window they rebuild a temporary chunk, which is slower, so
  call them with positions near the sled).
* **Difficulty**: flat until 1000 m; then `slopeVariance` 1->2, `hazardDensity` 0.8->2.1 per 1000 px, `glitchFrequency`
  1->1.9, `noiseWeightMul` 1->4 over the following ~3000-6000 m. Chunk template `jitterPx` is an optional extra field.
* **TrickTracker**: `TrickEvent.count` is the **cumulative** rotation count in the current air phase (a double flip
  emits count 1 then count 2). `ScoreManager.addTrick` pays only the increase, so call it for every event. `LandingResult`
  gains optional `rotationDeg`. On `state.crashed` while airborne the tracker returns a landing with `quality:'crash'`
  (so `scoreManager.onLanding(landing)` forfeits the combo) and resets itself; call `tracker.reset()` after Shift reset /
  respawn. Thresholds are exported constants (`PERFECT_ANGLE_DEG` 12, `GOOD_ANGLE_DEG` 28, `SLOPPY_ANGLE_DEG` 55,
  `HARD_IMPACT_PX_S` 520, `CRASH_IMPACT_PX_S` 1500, flip tolerance 20 deg, air brake 250 ms, parachute 300 ms).
  Trick value = base x (2^count - 1) x (1 + min(airtime,2500)/2500).
* **ScoreManager**: snapshot gains `penaltyPoints`; reset penalty is tracked separately so `trickPoints` stays >= 0.
  A `crash` landing quality banks nothing (no separate `onCrash` call needed, though it is harmless).
* **SaveStore**: `init()` never rejects (memory fallback, `store.backend` is `'idb'` or `'memory'`). Records are
  sanitised on save/load/import (unknown keys dropped). Sharecode = `BB1:` + base64(UTF-8 JSON `{app,v,runs}`), importer
  also accepts bare base64 / raw JSON, skips runs whose `ledgerHash` does not match their contents, and never throws.
  `setInitials` throws `RangeError` for < 3 chars (after trim) and clamps to 12; unknown run ids are ignored.
* **DailyPatch**: 8 rules; index = whole UTC days since epoch modulo `RULES.length`. Added `msUntilNextRule(date)`.
* **Rng**: `fork(label)` derives from the *initial* seed (independent of how much the parent has been consumed). New
  export `hashInts(a, b)`. Real xxHash32 (reference vectors tested).

## UI addenda (UI engineer; all additive, nothing in sections 1-9 changed)

1. **Optional HUD speed event** `'bb:hudSpeed'` (exported as `HUD_SPEED_EVENT` from `scenes/UIScene.js`, payload `{speedPxS:number}`).
   The contract has no speed event, so UIScene derives km/h from `DISTANCE_CHANGED` timing. If RunScene emits `bb:hudSpeed`
   (about 10 Hz) the HUD uses the exact value instead. Not required.
2. **Optional PauseScene launch data** `runId` (`scene.launch(PAUSE, {runTimeMs, runId})`), used for the `RUN_ABORT` payload.
   If absent PauseScene reads `UIScene.runId` (set from `RUN_START`), else sends `''`.
3. **Pause / restart / quit semantics** (PauseScene): Restart emits `RUN_ABORT`, stops RUN + UI and starts RUN again (same seed).
   Quit emits `RUN_ABORT`, stops RUN + UI, starts TITLE. Resume follows section 2 exactly, then polls `INPUT` a few times to
   consume the stale `pressed.pause` edge of the key that resumed. RunScene should additionally call `inputRouter.poll()` once on
   `GAME_RESUME` so that edge can never re-pause the run.
4. **UIScene may miss `RUN_START`** (launched in the same frame it is emitted); it initialises seed/daily rule from `REG.SEED` and
   `DailyPatch.getDailyInfo()` and resets on any later `RUN_START`. It listens to everything in the events table and removes
   every listener on shutdown.
5. **GameOverScene** shows the initials entry only when `qualifiesForTop10(score)` is true AND `score > 0` AND `cause !== 'quit'`.
   Initials length is `INITIALS_LENGTH` in `ui/Format.js` (default 3; the widget supports any length, SaveStore allows 3..12).
   Space/Enter/A/tap retry immediately with `registry REG.SEED` reset to `record.seed`; a pending, unsaved entry is saved
   fire-and-forget (prefilled from `settings.lastInitials`, default `AAA`) so a retry never loses a top-10 score.
6. **Menu input**: UI scenes accept `EVT.INPUT_ACTION` (`up/down/left/right/confirm/cancel/hop/pause`) AND fall back to Phaser
   keyboard + `navigator.getGamepads()`; duplicates from different sources within 60 ms are merged (`ui/MenuInput.js`). While typing
   initials, keyboard-sourced `INPUT_ACTION`s are ignored (typing "A" must not move a cursor).
7. **DOM text boxes** (seed entry, sharecode export/import) are real `<input>`/`<textarea>` elements stopped from propagating
   key events (`ui/DomTextBox.js`), so InputRouter's window listeners never see typed keys. InputRouter must not use
   capture-phase listeners that `preventDefault` Space/arrows, or those keys cannot be typed in the box.
8. **HUD slots** (`UIScene._layout`, `ui/HudLayout.js`): the centre banners (effect warnings, BOOST, PERFECT LANDING, sector strip, bank line,
   CRASH banner, trick popups) are stacked top to bottom from their classic y (`SLOT`), so simultaneous ones take separate rows instead of
   overlapping, and are pushed under any fixed HUD row, the zone chip or touch button they would touch (rows are measured live; wide values
   such as a 7-digit score, shards in the thousands or a long combo name cannot collide). Pop animations are capped (about 25 %) so they
   stay inside the 3 px gap; the speed pop stays above the shard row (y 53); the shard chain chip follows the popping counter. The bottom
   row (power-ups, tutorial chip) is placed with `placeX`: power-ups move right of the touch buttons, the chip moves above the power-up row
   when it would touch them, the seed lines or the buttons. Touch boxes come from the overlay's `.bb-cl` clusters mapped through the canvas
   rectangle. Screenshots: `node tools/sim/shots.mjs hud <outDir>` (scenarios in `tools/sim/shots-hud.js`, with an overlap probe).

## Gameplay addenda (gameplay engineer; all additive)

* **Matter 0.20 units**: `Body.setVelocity/getVelocity/AngularVelocity` are normalised to a 1000/60 ms base step, NOT the
  sub-step (section 7's `v * stepMs / 1000` is only right for stepMs = 16.67). Gameplay uses `BASE_STEP_MS` (PhysicsTuner).
  `world.step(delta)` handles variable deltas itself (`Body._timeCorrection`).
* **Matter friction must be 0 on the sled**: any `friction >= 0.0005` jams the sled on slopes below ~15 deg (verified in node and
  in-game). Runner drag, braking and High Bandwidth zones are applied manually (`TUNING.groundResist`, `brakeResist`,
  `frictionMul`). Terrain bodies get `frictionStatic = 0` (Matter combines static friction with max()).
* **Feel tunables beyond the doc** (all in `PhysicsTuner.TUNING`, doc values in `constants.PHYSICS` untouched):
  `dragFeelMul` 0.3 (written frictionAir = 0.015 x 0.3 = 0.0045; literal 0.015 caps an 8 deg slope at ~120 px/s) and
  `airTiltFeelMul` 1.6 (air tilt = 420 x 0.7 x 1.6; literal needs ~2.1 s for 540 deg, now ~1.6 s). Set both to 1 for the literal doc.
  `EffectivePhysics` gained optional fields `steerMul`, `tiltSign`, `groundResist`, `quadDrag`, `pushForceMul`,
  `scrambleJitterDegS2`, `restitution`; `TunerContext` gained `slowFactor`, `timeMs`, `parachute`, `airBrake`, `airborne`,
  `braking`. `stepWorld()` has an optional 4th arg `afterStep`.
* **Spawn**: the sled spawns `SPAWN_RUNIN_PX` (44) px past `getStartPosition().x` so the rear runner has ground; distance is
  measured from the spawn x. Camera X is clamped to >= -30 so the world edge is never shown.
* **Crash rules**: head/torso touching terrain, `LandingResult.quality === 'crash'`, crash hazards, or falling
  `TUNING.voidDepthPx` (320) below the interpolated ground line (gaps) all crash. Hashed Backup negates any of them
  (`CRASH negated:true`); for non-hazard causes the sled is also respawned (`RESPAWN reason 'backup'`, pending combo dropped).
  Manual Shift reset: `RESPAWN reason 'manual'`, ends timed power-ups with `POWERUP_EXPIRED reason 'respawn'`.
* **Extra emissions**: `HUD_SPEED_EVENT` ~10 Hz; `audio.playSfx('hop'|'push')` and `audio.setSpeed()` from RunScene.
* **Entity files added**: `entities/Background.js` (parallax), `entities/Fx.js` (pooled shards/sparks/rings).

## Integration / QA addenda (QA engineer; additive, nothing in sections 1-9 changed)

* **Flow tuning (Pillar 1)**. QA found a hands-off sled stalled (< 10 px/s) in the first dip and covered ~110 m in 20 s
  (peak ~320 px/s). Doc 4.2 values in `constants.PHYSICS` are untouched; the feel multipliers in `PhysicsTuner.TUNING` changed:

  | Tunable | Before | After | Effect |
  |---|---|---|---|
  | `dragFeelMul` (x doc drag 0.015) | 0.3 | 0.15 | linear air drag 0.27/s -> 0.14/s |
  | `groundResist` (1/s) | 0.12 | 0.04 | runner resistance |
  | `quadDrag` (1/px) | 0.00009 | 0.0003 | soft terminal speed (~600 px/s on steep drops) |
  | `airTiltFeelMul` (x doc 420 x 0.7) | 1.6 | 3.6 | air tilt 470 -> 1060 deg/s^2: a held flip is ~270 deg in a 0.8 s hop, ~540 deg in ~1.0-1.1 s |
  | `maxAngularVelDegS` | 560 | 1100 | do not clip a held flip |
  | `hopPxS` | 300 | 360 | an average hop is ~0.8 s of air (was ~0.6) |
  | `pushKickPxS` | 70 | 90 | W from a standstill still useful |

  Measured with the real game (12 seeds, hazards ignored, hands-off, today's daily rule): mean speed 78 -> ~350 px/s, distance
  in 20 s ~85 m -> ~250-320 m, stalls (> 2 s below 10 px/s) in 40 s: 12 of 12 seeds -> 0 of 12 (also 0 with the heaviest,
  lightest and stickiest daily rules). Matter 0.20 loses ~35 % of `g sin(slope)` on the polyline colliders (QA measured
  accel 61 vs 91 px/s^2 at 5 deg) which is why the drag had to drop so far.
* **TerrainGenerator flow rules** (`RISE_LINE_DEG`, `RISE_MAX_PX`, `MAX_UP_DEG`): spline slopes climb at most `MAX_UP_DEG` = 12
  (was 28 - the old kicker ramps were walls that trapped sleds in bowls W cannot escape, push needs slope >= -5 deg); a hill never
  rises above the descending 7 deg line drawn from the previous peak nor more than 30 px above the valley floor it climbs out of
  (state carried in `bounds[].peakDx/peakDy/valDy`, so chunks stay pure functions of seed and index); every chunk still
  descends >= 9 deg overall (`MIN_NET_TAN`, was 7); the first segment of a chunk turns at most `MAX_TURN_DEG` (noise seams used
  to allow 17). Templates `kicker-lip`, `valley-launch`, `ski-jump` had their uphill rises cut to ~35-45 px. Terrain unit tests were
  not loosened; flow rules have their own tests (`tests/src/terrain.test.js`, "flow rules").
* **Helicopter spin scoring**: the spin is a drawing-only rotation, so `TrickTracker` (which counted body rotation while an arrow was
  held) never scored it. `SledFrameState` has an optional `heliDeg` (continuous drawing phase, `Sled.heliPhase`); when present the heli
  bucket is fed from it and body rotation always counts as flips. Without it the legacy rule applies.
* **Sled skids** are 24-gon polygons instead of Matter's 10-sided circles (polygon edge normals caused ~10 % extra seam drag).
* **Camera** keeps the rider inside a 34 px band and follows faster with vertical speed (bounce pads launched the sled off screen).
* **Menu text entry**: `ui/MenuInput` uses native window keydown events (not Phaser's keyboard plugin) while `rawKeyHandler` is set,
  because InputRouter preventDefaults Space / arrows (Phaser drops those) and Phaser's per-frame key queue re-delivered keys out of
  order when several arrived in one frame. On the Game Over initials panel: Enter saves, Space saves with the current letters and
  retries instantly, Esc skips (nothing saved). With no panel up Space / Enter / pad A / tap retry at once.
* **UIScene** hides the seed / daily-rule lines while the touch overlay is visible (they sat under the HOP / PUSH buttons).

### Fun-pass: feedback (UI / audio)
* New events (`events.js`): `LANDING_BOOST`, `NEAR_MISS`, `SHARD_COLLECTED`, `MILESTONE`, `NEW_BEST`, `TUTORIAL_HINT` (emitted by RunScene).
  UIScene listens (all removed on shutdown) and also triggers the matching sfx itself (RunScene must not).
* HUD: BOOST callout (top-centre, perfect = bigger), NEAR MISS popup, SHARDS counter + chain chip under the speed readout (chain chip
  expires 2.5 s after the last shard), pending trick points (x multiplier) pulse under the combo, SECTOR / NEW BEST strip (y 59-76, popups now start at y 80,
  < 1 s, queued), tutorial chip bottom-centre (wording by touch overlay / `pad.state.lastSource`; auto-hides after 4 s).
* AudioSynth `playSfx` opts gained `intensity` (`'boost'`, 0..1, 1 = perfect) and `step` (`'shard'`, chain index, ladder capped at 9).
  New names: `boost`, `nearMiss`, `shard`, `milestone`, `newBest`.
* GameOver: best comparison from `getRecentRuns(1000)` (excludes this run), shards / near misses rows from optional
  `rec.shards` / `rec.nearMisses` / `rec.bonusPoints`; initials panel only if the board has >= 3 entries or score >= 200;
  RETRY hint follows the panel state. Title shows the device best distance / score.

## Fun-pass: terrain (level-design engineer; additive)

* **New chunk fields** (always present, reset on recycle): `shards: {id,x,y}[]` (sorted by x, ids `s<chunkIndex>-<n>`, world px, >= 12 px above the
  surface, clear of every hazard hit box by >= 22 px), `launches: {x,y,angleDeg,airS,landX|null}[]` (ballistic lips at the expected speed),
  `sector` (1-based, `floor(startX / 20 / 500) + 1`), `breather` (bool). `ScoreManager.addBonus(points, kind)` (`'shard'|'nearMiss'|'milestone'`) adds
  immediately (separate `bonusPoints`, not combo, never multiplied, survives crash/reset); snapshot gains `bonusPoints`, `shards`, `nearMisses`,
  `milestones`, `bonusByKind`.
* **Opening**: chunk 0 is the generated `gen-jump` chunk (no template): ~720 px of 14 deg descent, then an easy lip at ~x 830 (~41 m, ~0.55 s of air at
  the expected speed) onto a 36 deg landing ramp and a hazard-free runout. No hazards before 80 m, no crash hazards before 150 m
  (`HAZARD_SOFT_PX` 1600, `HAZARD_SAFE_PX` 3000); hazard density ramps in from 35 % at 75 m to full at 600 m.
* **Launches**: `gen-jump` chunks (defId `gen-jump`, not in the JSON templates) are chosen when `sinceLaunch` grows (never twice in a row, never in
  breathers); mean launch spacing ~2700 px (~5 s at cruise). Lip up-angle 12 deg, landing slope 36 -> 42 deg by 1500 m, landing ramp sized for 1.2 x
  `expectedSpeedPxS(distM)` (340 + 0.18 m, cap 620) so airtime grows ~0.6 s -> ~1.2+ s. The whole jump chunk plus every detected lip's landing zone
  (and the next chunk's start via `bounds[].noHazX`) is hazard free.
* **Crests**: slope may increase (convex) by at most `CREST_TURN_DEG` 3.5 deg per 16 px segment on ordinary spline chunks (`NOISE_CREST_TURN_DEG` 6 in
  noise zones); templates tagged `SHARP_TAGS` (kicker, jump-lip, launch, big-air, drop, steps) and generated jumps keep the 10 / 16 deg lips.
* **Sectors**: `difficultyAt` is stepped per 500 m (ramp = sector/7, same ceilings as before, reached ~3500 m) and also returns `sector`, `speedBudget`.
  The first chunk starting in a new sector is a calm "breather" (roller/cruise/intro template, no noise/bridge/jump, first 1100 px hazard free).
* **Anti-stall**: `bounds[].speed` carries a 1-D roll model (0.65 g sin, 0.2 v + 0.0003 v^2 drag); `_finishSafe` adds descent to any non-bridge chunk
  until the model stays above 55 px/s. 0 stalls in 60 seeds x 10 000 m.
* **Shards**: one group per chunk at most, ~59 % of chunks: arcs off every launch lip / bounce pad (always), else (`SHARD_PLAIN_CHANCE` 17 % of the remaining chunks)
  a ground line 14 px above a 8-38 deg stretch or a high risk hump over a hazard / gap; risk share = 12 % + dist/5500 (max 65 %).

## Fun-pass: feel (game-feel engineer)

* **Trick -> speed loop** (`TUNING.boost*`, `sloppySpeedKeep`): good/perfect landing after >= 1 trick adds `60 x comboMult x (1 + 0.2 x (tricks-1))` px/s
  along the travel direction (perfect x1.5, cap 260) and runs drag x0.3 for 1.2 s (`Sled.boostMs`); perfect with no tricks +30; sloppy keeps 92 % speed
  and damps spin. Emits `LANDING_BOOST`. Measured: perfect single backflip +113 px/s (+~125 px/s within 150 ms).
* **Ground snap** (`TUNING.snap*`, `Sled.applyControls`, `RunScene.dropAhead`): grounded >= 100 ms, no hop/launch for 350 ms, left ground < 160 ms ago,
  normal speed < 130 px/s and ground ahead falls away < 11 deg -> normal velocity is clamped to 0. Kickers/drops/hops are untouched.
* **Forgiveness**: tracker 'crash' landings with |angle| <= 78 deg and impact < 1700 px/s become 'sloppy' (RunScene); crash hazard hit-boxes are 72 % x 80 % of the drawn box.
* **Speed feel**: camera zoom 1.0 -> 0.82 (150..600 px/s, stepped 0.005; `applyZoomCompensation` counter-scales the scroll-factor-0 background and flash
  rect), look-ahead 170 px, streaks > 420 px/s, hit-stop 45/70 ms, landing squash, impact-scaled sparks.
* **Near miss / shards / milestones / best gate / hints**: `RunScene.updateFun`; `entities/Shard.js` (ShardField), `entities/BestMarker.js`.
  `SHARD_COLLECTED.total` = shard points this run. Tutorial completion persists in localStorage `bb.tutorialDone` (SaveStore drops unknown settings keys).
  RunRecord gets `shards`, `nearMisses`, `bonusPoints` (SaveStore.sanitizeRun may strip them).

## Addendum: chase queries and daily countdown (meta/persistence engineer)

Additive, read-only helpers. No change to RunRecord, `computeLedgerHash`, the `BB1:` sharecode, the IndexedDB layout or the memory fallback.
All SaveStore helpers below are **synchronous** scans of the in-memory `this.runs` mirror (filled once by `init()`), so they never touch I/O and
are safe to call in `RunScene.create()`, `GameOverScene.create()` and `TitleScene.create()` without blocking retry. O(n) per call, fine for thousands of runs.
Every stored run counts (crash and quit); runs imported via sharecode count too (they carry initials).

* `store.getSeedStats(seed, {excludeRunId}?)` -> `{seed, attempts, bestScore, bestDistanceM} | null`. Best score and best distance are independent maxima.
* `store.getDailyStats(when = now, {excludeRunId}?)` -> same plus `dateKey`, for `DailyPatch.getDailyInfo(when).seed` (`when` is a Date or epoch ms).
* `store.getDailyStreak(now = new Date())` -> `{streak, playedToday, todayKey, lastPlayedKey}`. Day membership is the date inside the run's seed
  (`daily-YYYY-MM-DD`), not its timestamps (robust to clock skew and midnight-straddling runs). Streak ends today or yesterday, else 0; future-dated seeds ignored.
* `DailyPatch.dateKeyFromSeed(seed)` -> `'YYYY-MM-DD' | null`; `DailyPatch.formatCountdown(ms)` -> `'3H 12M'` / `'12M'` / `'<1M'` / `'0M'` (minutes rounded up).

**GameOver usage.** `saveRun` is async and pushes to `this.runs` synchronously before its first await, so the finished run is already in the mirror when the
scene asks. Call `const prev = store.getSeedStats(run.seed, {excludeRunId: run.id})` (and `getDailyStats(new Date(run.startedAt), {excludeRunId: run.id})` when the
seed is a daily seed) to get the PREVIOUS best; "NEW SEED BEST" when `!prev || run.score > prev.bestScore`, else "SEED BEST ${prev.bestScore}". The same call is correct
whether or not the run is saved yet, because of `excludeRunId`. For the streak, call `getDailyStreak(Date.now())` after saving: a first daily run today shows playedToday true.
**Title usage.** `store.getDailyStreak(Date.now())`, `store.getDailyStats(Date.now())`, and `DailyPatch.formatCountdown(DailyPatch.msUntilNextRule())` (refresh on a slow timer).

## Addendum: scoring fun-pass (flow, flips, combo names, milestones)

Owner: core-logic engineer. All additive except the two rule changes marked RULE. Numbers live in `SCORING` (constants.js).

* **Flow streak** (`ScoreManager`; RULE changed in the fix round): run-level multiplier `flow` x1.0..`flowMax` x3.0. A perfect (+`flowPerfectStep`
  0.25) or good (+`flowGoodStep` 0.15) landing after >= 1 COMBO-STEP trick (`SCORING.comboStepTypes`: flips and helicopters; air brake /
  parachute alone gain nothing) raises it. ANY perfect / good landing, tricks or not, refreshes the timeout (`flowTimeoutMs` 9000 of ticked
  run time). Sloppy with >= 1 trick keeps `flowSloppyKeep` (0.5) of the bonus above 1.0 (applied AFTER that landing banks, paid at the carried-in
  flow) and does NOT refresh the timeout; every halving (sloppy, timeout, `onShieldHit`) clears to 1.0 with `lost:true` when the kept bonus is
  below `flowClearBelow`, and flow reaching exactly 1.0 by any path is reported `lost`, never `changed`, with the timer zeroed. Crash landing, `onCrash()` and `penalizeReset()` clear it. The timeout does not clear: each expiry
  halves the bonus above 1.0 and restarts the timer (`FlowChange {reason:'timeout', lost:false}`); once the halved bonus would be below
  `SCORING.flowClearBelow` (0.05) it clears to 1.0 (`lost:true`). `banked = round(pending x combo x flowUsed)`, where `flowUsed` is the flow
  AFTER this landing's gain (so the first clean trick landing already pays; a landing that gains nothing pays at the carried-in flow).
  Distance and flat bonuses are never multiplied. **Shield save**: `onShieldHit(dropCombo = false)` halves the bonus (reason `'halved'`) and,
  unless `dropCombo`, leaves the pending combo, its paid baseline and the tracker counts untouched (RunScene passes `false` for a hazard hit
  absorbed by Hashed Backup, e.g. mid-air, and `true` when it respawns the sled). RunScene does NOT flag the tracker `crashed` for a hazard hit
  that a shield charge (or post-respawn grace) absorbs, so the air phase and counts continue and the landing banks the combo once. Do NOT call `onCrash()` for a shield hit: it wipes `paid`
  while TrickTracker keeps its counts, so later flips would be re-paid at full cumulative value.
* **Calls RunScene must make**: `score.tick(dtMs)` once per frame with the run-clock delta (excludes pause; never wall clock);
  `onLanding(landing)`, `onCrash()`, `penalizeReset()` as before. Each returns a `FlowChange`
  `{changed, lost, previous, flow, reason:'gain'|'halved'|'crash'|'reset'|'timeout'|'none', timeoutFrac, best}`
  (`onLanding().flowChange`, `penalizeReset().flowChange`, `onCrash()` and `tick()` directly). ScoreManager never emits: the scene emits
  `EVT.FLOW_CHANGED` (`FlowChangedPayload {flow, previous, reason:'gain'|'halved'|'timeout', timeoutFrac, best}`) when `changed && !lost`, and
  `EVT.FLOW_LOST` (`FlowLostPayload {previous, reason:'crash'|'reset'|'timeout'}`) when `lost`. FLOW_CHANGED reasons: `'gain'`, `'halved'` (sloppy /
  shield hit), `'timeout'` (timer expiry halving; flow still above 1, timer restarted, `timeoutFrac` 1); FLOW_LOST `'timeout'` = the bonus decayed away.
  HUD getters: `getFlow()`, `getFlowTimeoutFraction()` (0 when flow is 1), snapshot fields `flow`, `flowTimeoutFrac`, `bestFlow`,
  `comboCounts`. `onLanding` additionally returns `flowUsed` and `comboName`.
* **bestFlow in the record**: the scene may add an optional `bestFlow` (from `snapshot.bestFlow`) to the RunRecord. It is NOT covered by
  `computeLedgerHash` (which hashes a fixed field list), so old saved runs stay valid; SaveStore's record sanitiser must default it
  (`>= 1`) when absent. Until SaveStore carries it, read it from the snapshot only.
* **RULE: combo step**: only `SCORING.comboStepTypes` (backflip, frontflip, helicopterCCW, helicopterCW) add `comboStep`. Air brake and
  parachute keep base points and still appear in `comboTricks`, but `addTrick().isNew` and `TrickPayload.isNew` are false for them.
* **Incomplete helicopter**: `classifyLanding(angleDiffDeg, impactSpeedPxS, midSpin?)`; `midSpin` is `true` or a helicopter phase in
  degrees (e.g. `heliDeg`, any sign/wrap). `isMidSpin(spin)` is true when the phase is further than `SCORING.midSpinToleranceDeg` (60, was 35:
  the drawing coasts ~40 deg after the key is released) from a whole turn. TrickTracker additionally ignores a NUMERIC phase (no penalty) when the
  helicopter key was released before touchdown and less than `MID_SPIN_MIN_DEG` (90, a quarter turn) of helicopter spin was made in the air
  phase (a nudge or pure coast); a key still held at touchdown or `midSpin: true` always counts. The grade drops one level (perfect->good, good->sloppy, sloppy stays); never creates or rescues a crash.
  `SledFrameState.midSpin` (same type, optional) is forwarded by `TrickTracker`; `LandingResult.midSpin` reports that the penalty applied.
  RunScene should pass its drawing's heli phase (or `true` while a spin is unfinished) in `midSpin` on the landing frame.
* **Combo names**: `comboName(tricks, maxChars = 28)` (ScoreManager.js) takes type strings or `{type,count}`; e.g. `DOUBLE BACKFLIP + HELI`,
  `TRIPLE FRONTFLIP`, `BACKFLIP + AIR BRAKE`; degrades to BRAKE/CHUTE, then `N-TRICK COMBO`. `getComboName()` names the pending combo;
  `onLanding().comboName` names the jump just landed (capture it for the HUD popup).
* **Milestones**: `milestoneBonus(sector) = 100 x min(sector, SCORING.milestoneMaxSector 10)` (linear, flat 1000 from 5 km on; was 100 x sector); `score.checkMilestones(distanceM)` pays (via `addBonus(..., 'milestone')`)
  every newly completed 500 m sector exactly once and returns `[{sector, points, distanceM}]`; the scene emits `EVT.MILESTONE` for each
  (payload gained optional `points`). Call it when distance advances. Reaching 500 m pays sector 1 (100), 1000 m pays sector 2 (200), 5 km sector 10 (1000).
  If RunScene keeps its own milestone trigger, drop the old `addBonus(..., 'milestone')` call to avoid double payment.
* **Event payload doc fixes**: `LandingBoostPayload.tricks` is a number (count banked). `ShardCollectedPayload.total` is cumulative shard
  POINTS; new optional `count` is the true shard count.

## Late-game freshness: air hazard, power-up floor, longer ramp (terrain engineer; additive)

* **Air hazards** (`HazardDef.placement: 'air'`, first def `roguePacket`: `data/hazards/rogue-packet.json`, 52x30 box, hit box 72 % x 80 %, crash,
  `shapeKey 'chasm'`, `colorKey 'danger'`, `minDistanceM` 1500). They are listed in `chunk.hazards` like any other hazard, so `RunScene.takeChunk`
  and `entities/Hazard.js` already spawn, draw and collide them with no scene change. **Air spawn contract**: `y` is the CENTRE of the box
  (Hazard.js already treats `placement 'air'` that way; no fix was needed), `rotationDeg` is 0, and `hazards` stays sorted by `x`. They never
  sit on the ground, so code that assumed `hazard.y == heightAt(hazard.x)` must check `defs[h.defId].placement` first.
* **Placement rules**: only in generated jump chunks (`gen-jump`), never chunk 0, never breathers, never before `AIR_HAZARD_MIN_M` (1500 m; a def's own
  `minDistanceM` can only raise it), at most one per jump. Chance per eligible jump: 25 % at 1500 m rising linearly to 55 % at 10 km (`AIR_CHANCE_*`).
  Position (fix round: LATE in the arc): `AIR_U_MIN` 0.55 .. `AIR_U_MAX` 0.8 of the lip-to-landing span AND at least `AIR_MIN_DX_PX` (400 px) past the
  lip; a jump whose span cannot fit that (0.8 x span < 400) gets no air hazard. Blocked (then retried once at another x, else skipped) by a power-up within 90 px,
  a shard, a gap or another hazard within 480 px. The def is picked by `weight` among air defs eligible at that distance (data driven).
* **Fairness guarantee (tested)**: the hit box sits ABOVE every no-hop flight with >= `AIR_CLEARANCE_PX` (70 px) of vertical clearance, for launch
  speeds from 0.75 x to max(`AIR_SPEED_HI_MUL` 1.6 x, expected speed) of the nominal launch speed (arcs rise monotonically with speed, so the fastest bounds
  the family; 1.6 x covers landing-boosted sleds). A normal flight always passes under it (nominal arc ~280-300 px below the box bottom, 1.25 x ~170 px);
  only a full hop at the lip (+360 px/s) reaches it.
  **Near miss**: flying under pays once: `RunScene.updateFun` pays an air-hazard near miss for an AIRBORNE sled crossing the box x with `0 < sled.y - box
  bottom < TUNING.airNearMissBelowPx` (= `AIR_NEAR_MISS_BELOW_PX` 360, which covers every still-airborne no-hop arc; tested). **Telegraph**:
  `TUNING.airWarnAheadPx` is 900 (box ahead of the sled): the hazard goes `alert`, `airWarn` plays, and `entities/AirTelegraph.js` draws a blinking STAY LOW
  marker with cascading chevrons and a dotted guide over the launch lip it belongs to (`Hazard.lip` = nearest `chunk.launches` entry before the box,
  set in `RunScene.takeChunk`), so the no-hop decision can be made before the lip. The hop tutorial hint still ignores air hazards. A "low" box near the
  lip-to-landing chord was rejected: a slow launch drops onto the landing ramp and no box can keep 70 px from that arc.
* **Determinism**: air placement is the last step of `_build`, draws only from `crng.fork('air')` (a fixed 4 draws per chunk) and reads, never changes,
  the shards / power-ups already placed. Air defs are kept out of the ground hazard list, so ground hazards, terrain, shards, zones and launches are
  bit-identical with and without the def (tested). Power-ups: the `rng.chance` draw is unchanged; only the threshold changed.
* **Power-up floor**: spawn chance = `max(POWERUP_FLOOR_FRACTION (0.4) x baseChance, baseChance / (1 + d / decay))`.
* **Hazard fill past 2000 m** (measured, 48 seeds `sim-01..48`): after `HAZARD_DENSITY_MUL` 3.4 the requested gap (1000 / density px) is below
  `HAZARD_MIN_SPACING_PX` 480 from ~600 m on, so slots sit exactly 480 px apart and `hazardDensity` / `HAZARD_DENSITY_TAIL` no longer change the ground
  count (only the share of eligible ground does). Only ~25-30 % of the ground is eligible (jump chunks, landing zones, breathers and margins are hazard
  free) versus ~73 % before the pacing rework, and a rejected slot (flat / slow-hazard / lip-zone rule) used to waste 480 px. From `HAZARD_RETRY_FROM_M`
  2000 a rejected slot is retried `HAZARD_RETRY_STEP_PX` 120 px further; placed hazards still advance by the full gap, so spacing and the hazard-free
  rules are unchanged and chunks starting before 2000 m are bit-identical. Result per 500 m band past 2500 m: ~3.8 ground + ~0.5 air crash hazards
  (was ~2.9 + ~0.5), ~6 hazards in total (was ~4.7); the pre-rework game had ~7 crash / ~14 total. The rest of the gap is the spacing ceiling
  (~2.08 hazards per 1000 px of eligible ground; the fill now reaches ~1.9), not a tunable constant.
* **Longer ramp**: `expectedSpeedPxS` = old curve (340 + 0.18 m, 620 at ~1556 m) + a tail of 80 px/s reached linearly at 6000 m (700 max). `hazardDensity`
  = old stepped curve (2.1 at 3500 m) + a tail of 0.7 reached at 10 km (2.8 max); other difficulty fields are unchanged. Later generated jumps may have
  a landing ramp up to 1300 px (was 1100) so a launch at 1.1 x the expected speed still lands on it. Terrain, shards and ground hazards of an existing
  seed are unchanged until the first jump / lip beyond ~1556 m; from there chunk lengths differ slightly and everything downstream is a different
  (equally valid) track. Power-ups differ from ~1800-2250 m on (floor).


## Integration: flow, spin cut, named combos, air drone, chase UI (integration engineer; additive)

* **Flow wiring** (`RunScene`): `score.tick(simDt)` every frame right after `stepWorld`, with `simDt` = the scaled sim delta (slow-mo stretches the
  timeout, pause and hit-stop freeze it; never wall clock). `RunScene.emitFlow(fc)` turns any FlowChange (tick, `onLanding`, `onCrash`,
  `penalizeReset`) into `FLOW_LOST` (lost) or `FLOW_CHANGED` (changed). A shield-absorbed HAZARD hit calls `onShieldHit(false)` (flow halved, pending combo kept, no COMBO_CHANGED); a shield-absorbed body / landing / void crash
  respawns the sled and calls `onShieldHit(true)` (combo dropped, `COMBO_CHANGED reason 'crash'`). `HUD_SPEED_EVENT` (~10 Hz) now also carries `flow` and `flowFrac` so the HUD meter resyncs
  (covers the timeout refresh at the x3.0 cap, which is not a FLOW_CHANGED). UIScene: `FLOW xN.N` + draining bar under the pending-points line
  (top-right, visible only while flow > 1), colour steps at 1.5 / 2 / 2.5, pop per gain, `FLOW LOST` callout; pending points now include flow.
  SFX: `flowUp` (`opts.flow` raises pitch), `flowLost` (down-sweep), `airWarn`. RunRecord gets `bestFlow` (unhashed; the sanitiser drops it, so GameOver
  reads it from `REG.LAST_RECORD`). Rule change in ScoreManager: a sloppy landing that banked zero tricks no longer halves flow.
* **LandingPayload additive fields** (now in the `events.js` typedef): `comboName` (name of the jump just banked), `comboMult`, `flowUsed`, `midSpin` (grade dropped
  for an unfinished spin). `Sled.getFrameState()` passes `midSpin: heliPhase` (the drawn helicopter angle); TrickTracker applies the 60 deg tolerance and the
  coast / nudge exemption. HUD: the bank line `[SLOPPY ]NAME xMULT +POINTS` is its own big glowing line (scale 2, y 80, ~1.4 s; shortened until it fits 440 px at
  that scale) and the small popups (incl. `SPIN CUT  GRADE DOWN`) stack under it from y 100 at an 11 px pitch, so they never overlap. Top-right stack: COMBO y4,
  value y13, info y31, pending y43, FLOW y62 + bar y72 (pop peaks 2.5 / 2.3 keep them apart).
* **Milestones**: `RunScene.updateFun` uses `score.checkMilestones(metres)` only (no second `addBonus`). `MilestonePayload.sector` is now the sector
  just completed (500 m -> 1; it used to send `n + 1`), `points` is the paid bonus, shown in the SECTOR strip. **Shards**: `SHARD_COLLECTED.count` is sent
  and `SHARDS N` shows the count.
* **Tuck hint** (fix round): due after `TUNING.tuckHintMs` (800) of grounded, not tucking, slope >= `tuckHintSlopeDeg` (12) and speed > 150. It waits for any
  other hint to clear (dropped after `tuckHintWaitMs` 8000), stays up at least `tuckHintShowMs` (2500; hides when the steep stretch ends, forced at +1300)
  and is only retired (persisted `bb.tutorialDone`) when the player tucks on the ground or it has been shown `tuckHintMaxShows` (2) times (count in
  localStorage `bb.tuckShows`). At most one show per run.
* **Rogue Packet** (`Hazard.shapeKey 'drone'`): halo + rotor bars + hull + white-hot core, visual-only bob, faster pulse / tighter ring once `hazard.alert`.
  RunScene sets `alert` and plays `airWarn` once when an air hazard is within `TUNING.airWarnAheadPx` ahead. Air hazards are excluded from the "hop" tutorial hint
  (hopping is the wrong answer), and their near miss is the airborne pass-under window described in the air-hazard section above; `h.cy` is always the box centre.
* **Chase UI**: GameOver shows `NEW SEED BEST` / `SEED BEST n` (top right of RUN REPORT; on a daily seed it reads `NEW TODAY'S BEST` / `TODAY'S BEST n`
  from `getDailyStats`) and a `DAILY STREAK n DAYS` row for daily runs. The report keeps at most 8 rows by priority (DISTANCE, TRICKS, BONUSES, RESET PENALTY, BEST COMBO, BEST FLOW,
  SHARDS, NEAR MISSES, DAILY STREAK, BEST AIR, RUN TIME), dropping the lowest first. The right-column point rows add up to the score: DISTANCE + TRICKS +
  BONUSES (`rec.bonusPoints`: shards, near misses and milestones together) - RESET PENALTY (derived: parts minus score, only shown when > 0); SHARDS / NEAR MISSES
  are plain counts. The device-best lines under the chase line read `DISTANCE BEST!` / `SCORE BEST!` (+ `PREV n`) or `n M SHORT OF` / `DISTANCE BEST`, so they can never be
  confused with the seed / today's SCORE best line above them. Row pitch 9, ledger hash y 132, share seed y 144. Title daily strip: `NEXT PATCH IN 3H 12M` plus `STREAK n   TODAY'S BEST n` or
  `NOT PLAYED TODAY`, refreshed every 15 s by a scene timer.

## Addendum: landing / terrain-contact fix

Runs used to end in a `terrain` crash (head or torso on the ground) a moment after a good or perfect landing. Cause: Matter's SAT takes the minimum-overlap axis, which at the 16 px terrain quad seams is often a wall axis or one of the 24-gon runner's own 15 degree face axes ("ghost" normal, 15-60 degrees off the surface). A sled sliding at 700+ px/s then gets a spurious normal velocity and an off-centre impulse at a runner 15 px from the centre of mass: +/-400..700 deg/s of spin out of nothing, plus a hidden speed-dependent drag (grounded cruise was a flat ~480 px/s). `systems/TerrainContact.js` (installed by `RunScene.create` on `Matter.Collision.collides`) rewrites every runner/terrain contact to use the quad's top-face normal (`TUNING.terrainSnapNormals`; contacts deeper than `terrainSnapMaxDepthPx` below the top plane, i.e. gap walls, are left alone, head and deck contacts are never touched). On top of that, `TUNING.landSpinMaxDegS` caps the angular velocity for `landSettleMs` after a touchdown (a rigid sled landing on one runner first otherwise rocks onto the other), `Sled` reports the pre-solve `impactVx/impactVy` so `TrickTracker` grades the real impact speed (the solver has already removed the normal part on the landing frame), and `groundResist` went 0.04 -> 0.10 to give back part of the pace the ghost drag used to remove (jump airtimes stay at or above the old ones). A head-first landing or an over-rotated flip still crashes. `tools/sim/run.mjs` gained `--seedPrefix` (independent seed set) and `--sub N` (last N physics sub-steps before a crash).

## Addendum: first-run hint scheduler

`systems/HintScheduler.js` (pure, tests in `tests/src/hintscheduler.test.js`) owns what the first-run hints do on screen; `RunScene.updateFun` only reports triggers
(`wants`) and `UIScene` draws one slot (`HINT_TEXT` per input mode). Rules: one hint at a time; priority push > hop > boost > flip > tuck; each stays at least
`minMs` (1.5 s; tuck 2.5 s) unless the player does the action (`tutDoneId`, persisted in `bb.tutorialDone` as before), and at most `maxMs` (a timed-out hint must
see its trigger drop before it can return, so nothing sticks); 0.6 s gap after any hide; nothing before 2.5 s of run time except push; a higher-priority want
replaces the current hint once it has had its minimum; while a ground hazard is within ~3.4 s of travel and hop is not yet done, only push / hop may start. Triggers:
hop = next ground crash hazard within 1.2 s of travel (350..1300 px; the hazard itself only enters the view ~0.5-0.65 s before the sled reaches it); flip = a launch lip within 1.3 s of travel (grounded) or airborne > 250 ms with no trick
(max 3 shows per run, text says "IN AIR ..."); boost = 2.2 s after a landing boost (explains what just happened, then done); tuck = steep grounded descent, only after the
first landing and 12 s of run time, once per run, retired after `tuckHintMaxShows`. The "land" hint (dead: needed > 25 deg off the slope < 110 px above ground) is removed.
Tunables are a constants block at the top of RunScene.js (`HOP_*`, `FLIP_*`, `BOOST_HINT_MS`, `TUCK_HINT_MIN_RUN_MS`); `TUNING.tuckHintWaitMs` is now unused. `UIScene`'s
8 s `HINT_MAX_MS` is only a backstop. Measured with `tools/sim/hints.mjs` (stats from a `run.mjs --out` file) and `tools/sim/shots.mjs hints` (real screenshots).

## Addendum: camera at speed (second zoom stage)

Runs now cruise at ~650 px/s and peak at 1050-1200 px/s (up to ~1700), past the 340-700 px/s the camera was tuned for. `RunScene.updateCamera` keeps the old curve
(zoom 1 -> `TUNING.zoomMin` 0.82 between 150 and `zoomSpeedHi` 600 px/s) and adds a second stage: zoom keeps easing out to `ZOOM_FAR_MIN` 0.62 at `ZOOM_FAR_SPEED_HI`
1200 px/s, and the look-ahead grows by `LOOK_FAR_EXTRA_PX` 90 between 600 and 1000 px/s (the x follow lag eats most of the base look-ahead at speed). The rider is kept at
least `RIDER_MIN_SCREEN_X` 36 screen px from the left edge (the zoom code pins the rider's screen x to `sled.x - _camX`, so the bound is in screen px). These constants sit at
the top of RunScene.js, not in PhysicsTuner. Camera only: no physics input reads it (`run.mjs --policy hop` is identical with and without it). Nothing else needed to change for the wider
view: background and flash layers are counter-scaled by `applyZoomCompensation` (checked down to 0.62), terrain is generated `TERRAIN.bufferAheadScreens` (3) screens ahead (the view
is < 1.7 screens wide), and the cull margins use the zoomed `_view`. Measured with `tools/sim/shots.mjs zoom <dir> '{"trace":true}'` (hop-policy runs, real screenshots at scale 2;
`shots-zoom.js`): warning time = (view right edge - sled x) / speed.

## Addendum: flip release window and stall net on up-slopes

Flip timing was too strict: with the old hands-off air rules (`airIdleLevelK` 8, `airIdleSpinDamp` 3) a released flip kept spinning at 600-1000 deg/s for about a second, so every 100 ms of late (or early) release moved the landing angle by ~120 deg. `airIdleSpin()` (PhysicsTuner, used by `Sled.applyControls` when airborne with no tilt input) springs the nose toward a landing attitude by the shortest way (`airIdleLevelK` 80, error clamped to +-1.2 rad) and damps spin hard (`airIdleSpinDamp` 12); `maxAngularVelDegS` went 1100 -> 900 and `airTiltFeelMul` 3.6 -> 5 so a held flip still gives ~600 deg in 1.0 s and ~960 deg in 1.4 s (sim, held to touchdown: 627 deg at 1054 ms, 944 at 1394 ms) and a double flip stays possible on long air. That first pass fixed the early side only; a second pass fixed the late side:

* **Landing forecast.** `RunScene.airForecast` (one call after `dropAheadDeg`) sets `sled.airEtaMs` (ballistic ms to touchdown, 20 ms grid) and `sled.airSlopeDeg` (ground slope there) every frame; `Infinity` / `null` when grounded or nothing is hit within 2.5 s.
* **Aim.** With a forecast `airIdleSpin` settles at `airSlopeDeg + airIdleLandOffsetDeg` (15) instead of the velocity heading. A sled coasting on its velocity lands ~16 deg nose-down of the slope on generated jumps (median 16, p10-p90 12-19), so 15 keeps an unattended landing "good" exactly as before (hands-off 100 seeds: unchanged, median 365 m, 0 terrain crashes; aiming at the slope itself gave ~100 % perfect landings, +25 % top speed and made the hop policy fail earlier, so it is deliberately not done). Without a forecast it falls back to the heading.
* **Urgency.** The spring is multiplied by u^2 and the damping by u, u = clamp(`airIdleUrgencyRefMs` 400 / `airEtaMs`, 1, `airIdleUrgencyMax` 3): unchanged above 400 ms of air, 4x spring at 200 ms, 9x from 133 ms. The levelling that used to need ~0.45 s from the half-turn tipping point needs ~0.2 s in the model, while `maxAngularVelDegS` still stops a sled released inverted with < ~100 ms left from getting round.

Why the old window looked non-monotonic (measured on the old code): the harness's forward model matched the game (median landing-angle error 2 deg, p90 13 deg over 626 on-time attempts), but its "ideal" frame required a landing within 12 deg of the slope while a hands-off sled settles ~16 deg off it, so the ideal frame was the instant a still-swinging sled passed through the slope angle, a knife edge that has nothing to do with when the flip is done. 100 ms earlier the sled was one swing short (sloppy), 200-300 ms earlier it was at or before the half-turn tipping point and unwound to a plain clean landing, and from the tipping point (a release at ~0.42 s of hold, 140-190 deg round) the weak spring needed more air than was left, hence the crash dip at -200 ms. The policy now defaults to `--flipCleanDeg 28` (TrickTracker's "good" band = a clean landing); `--flipCleanDeg 12` gives the old definition. A single flip on a 0.7 s jump is still possible (hold ~0.50-0.65 s).

Result, `tools/sim/run.mjs --policy flip --releaseLateMs N --seeds 96` on two seed sets, clean / sloppy / crash over all attempts (see the commit message for the tables): releases from 300 ms early to 200 ms late land on the runners 89-95 % of the time with 5-11 % crashes, clean being 75-87 % (HEAD before this pass: 24-80 % clean, 8-41 % crash); 300 ms late is 49-53 % clean / 10 % crash; 400 ms late 26-28 % crash. Of the attempts whose ideal frame leaves >= 300 ms of air, 97-100 % are clean up to 200 ms late. Holding tilt into the ground (`--releaseLateMs 5000`, no emergency release) still crashes 41-47 % (38-42 % before), and a sled released inverted with < ~100 ms of air still crashes (unit-tested): holding tilt is not helped, the spring only acts with no input. The remaining crashes are attempts with little air to begin with (the flip was marginal) and releases with < ~150 ms left.

The stall safety net is `stallNudgeStep()`: it tests the signed speed along the slope (so a sled rolling backwards down a gentle up-slope counts as stalled), pushes net of gravity on up-slopes, and runs to `stallNudgeToPxS` 130 at `stallNudgeAccelPxS2` 240. On the 12 deg start ramp it now starts 0.6 s after the brake is released (was 1.4 s) and is back above 120 px/s after ~1.3 s (was 3.3 s). `tools/sim/run.mjs --policy stallProbe --probeKind first|flat|down|upGentle|upSteep` measures it; `--flipTargetDeg 700` makes the flip policy aim for a double flip.
