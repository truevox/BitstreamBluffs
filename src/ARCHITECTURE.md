# Bitstream Bluffs - Architecture Contract

Source of truth for the game: `docs/DESIGN-DOC.md`. This file is the source of truth for **how the pieces connect**.
Four engineers work in parallel on disjoint files. **Public signatures (class/function names, method params, event
names and payload shapes, data shapes, registry keys) are a contract.** If you must change one, edit this file and
the stub's JSDoc in the same change and tell the others in your hand-off. Additive changes (new optional fields, new
methods) are fine. Everything is plain JS ES modules + JSDoc; Phaser 3.90, Matter, Vite.

The legacy implementation in `js/` is untouched and unrelated; do not import from it.

## CURRENT 2026-11-18 OWNER CONTRACT — faithful BSOD Gym and nested 5x Gym-only Easter egg

## CURRENT 2026-11-18 OWNER CONTRACT — faithful BSOD Gym and nested 5x Gym-only Easter egg

**Marvin's direct decision (supersedes earlier assistant practice-only balancing):**
The BSOD Gym is **100% faithful to live-run gameplay once an attempt begins**.
It uses the actual player's active upgrades, earned canopy rank-12 requirement,
recharge formula, real Sync Level-dependent BSOD acceleration, ordinary
wind/atmosphere, boost/effect physics, and hazards. No practice-only fuel tank
or below-rank-12 refill, no reduced BSOD acceleration. The initial 200-shard
Gym price remains accepted for now. Only the **initial conditions**, the
lack of ranked/progression rewards, and the **consequence-free recovery** differ.

At first entry and at each retry, the Gym uses a repeatable fixed-seed
launch with selectable (post-unlock) **BSOD gap, forward-only initial wall
speed, rider launch height, forward velocity and upward velocity**.
`BsodPursuit.advance()` is NEVER overridden: within an attempt the wall
always moves strictly forward under exactly the same live acceleration.
No teleporting, reversal, wall cha-cha, or extra wind assistance is allowed
after release. The default initial setup is 460 px gap / 240 px/s wall,
260 px launch height / 280 px/s forward and -330 px/s upward rider velocity.
These are **initial conditions**, not changed movement rules. The values can
be tuned from automated tests without any owner approval of feel/balance.

**Fast repeated practice:** When caught, reconstruct deterministic initial
terrain, hazards, powerups and collected shard state at the same fixed launch,
restore the player's actually enabled initial boost loadout, clear all
attempt-local scores/combos/status, place the rider and wall, and freeze
the **whole gameplay simulation and run clock for 1000 real ms**. UIScene
shows a small `READY` cue; on expiry `GO` flashes and ordinary gameplay
resumes on the next frame. The pause menu stays functional during this
beat. This process never credits runs, shards, XP, mission completion,
achievements, or leaderboard entries.

**Matryoshka Easter egg:** Gym launch-configuration controls are completely
ABSENT from all player UI before **five successful scored BSOD Bluffs within
ONE uninterrupted airborne flight inside the GYM**. Specifically:

- Five Bluffs anywhere in the LIVE world **do NOT count** toward Gym setup.
- Five separated by landing, death or Gym reset **do NOT count**.
- A genuine 5x chain IN GYM unlocks setup exactly once via
  `ProfileStore.unlockGymSetup()`, safely persisted without XP/shards.
- Only THEN does the Shard Shop's existing Permanent Upgrades view gain a
  `GYM SETUP` row. Its nested five-choice page can change *bounded starting
  conditions* and enter practice. It is absent, not greyed out, before mastery.
- The one-time post-mastery `GYM SETUP UNLOCKED` notification is allowed;
  there are no advance tutorials, streak counters or spoilers.
- `bsodGym.advanced` and `bsodGym.setup` extend v1 profile shapes only
  after the Gym-specific milestone. Existing player profiles continue to
  deserialize unchanged; setup writes are atomically persisted and sanitized
  to physically forward-only values.

**Code ownership/verification contract:** `src/systems/BsodGym.js` owns
pure setup sanitization, preset options, forward-only placement and the
Gym-only mastery threshold. `RunScene` owns physics, the signed-relative
BSOD wind, 5x scoring gate, world reset and cooldown. `ProfileStore` owns
persistence. `ShopLayout` + `ShopView` own the hidden post-mastery menu;
`UIScene` owns READY/GO and one-time unlocked feedback. Events
`GYM_ATTEMPT_RESET {attempt,readyMs}`, `GYM_READY_GO {}` and
`GYM_SETUP_UNLOCKED {}` are additive.

The older dated passages farther down mentioning a 1500ms practice tank,
0.65px/s² Gym wall acceleration, or `0.68*full/sqrt(chain)` practice-only
refill are **historical development records, no longer active rules**.
Do not reintroduce those overrides. This is an owner decision, not
an invented Gal Friday balance change. Human audition and play-feel
testing are still pending; automated tests establish logic, not fun.

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
Retry is one press from every Game Over state: Space / Enter / pad A / pad RB / tap with no panel up; Space / pad RB
(MenuInput `retry`) from inside the Shard Shop, where an armed shop gives Enter / pad A to the highlighted row
(decision 7); an unrequested autoprompt shop is unarmed for `SHOP_ARM_MS` (500 ms) so an Enter already on its way
still retries. See "Addendum: Marvin decisions 7/8/9".

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
  weight, minDistanceM, placement, colorKey}` (B0 adds `biome`, `spawn` and the `blind` / `gust` effects; power-ups gain
  `biome` and the `ward` / `glide` / `stabilize` kinds: see "Addendum: biome full treatment, B0"). Ids: `glitchChasm`, `overflowFirewall`, `packetSpike`,
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
  touchOverlay: 'auto'|'on'|'off', touchRotate90, lastInitials, reduceMotion: 'auto'|'on'|'off', worldDance: boolean (default true)}`. Live copy at `registry REG.SETTINGS`.
* **RunRecord**: `{version, id, seed, dailyRuleId, startedAt, endedAt, durationMs, score, distanceM, trickPoints,
  tricks{type:count}, bestCombo, maxAirtimeMs, cause: 'crash'|'quit', ledgerHash, initials?}`.
  `ledgerHash = SaveStore.computeLedgerHash(record)` (versioned since decisions 1/2/4/6: see the addendum at the end;
  new records also carry `hashV: 2`, `dailyOfficial`, `bestFlow`, and `boosts` when modded). RunScene builds it and calls `saveRun` (no initials);
  GameOverScene later calls `setInitials(id, initials)` (3+ chars). Leaderboard = runs with initials.
* **DailyRule.modifiers** (multipliers, default 1): `tuckSpeedMul, tuckSteerMul, gravityMul, frictionMul,
  airControlMul, pushForceMul`. The daily rule (chosen from the UTC date) applies to **every** run that day and its id is
  stored in every RunRecord. RunScene reads `DailyPatch.getDailyInfo()` once at run start and feeds `rule.modifiers`
  to `PhysicsTuner`. Exception (decision 2): a run on a `daily-YYYY-MM-DD` seed plays THAT date's rule
  (`DailyPatch.infoForDateKey`).
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
| `DAILY_OFFICIAL` | `TitleScene.startRun` (true only from DAILY RUN), `GameOverScene.retry` / `newSeed` | run start | until the next start (decision 2) |

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
| `RUN_START` | RunScene | AudioSynth (switch music to biome-aware run DSP without restarting the current song), UIScene (reset HUD), GlitchPipeline |
| `RUN_END` | RunScene | AudioSynth (neutral menu audio and Debumont lead; current song continues), UIScene |
| `RUN_ABORT` | PauseScene | AudioSynth (return to menu music without restarting) |
| `CRASH`, `RESPAWN`, `LANDING`, `TRICK`, `HAZARD_HIT`, `POWERUP_COLLECTED`, `POWERUP_EXPIRED`, `EFFECT_END` | RunScene | AudioSynth (SFX), UIScene (popups/indicators) |
| `COMBO_CHANGED`, `SCORE_CHANGED`, `DISTANCE_CHANGED` | RunScene (from ScoreManager results) | UIScene |
| `ZONE_ENTER`, `ZONE_EXIT` | RunScene (compares `getZonesAt(sled.x)` each frame) | UIScene (indicator), AudioSynth |
| `GLITCH_START`, `GLITCH_END` | RunScene (from `GlitchDirector.update`) | GlitchPipeline (shader intensity), AudioSynth (glitch bus), UIScene (flicker) |
| `GAME_PAUSE` | RunScene | AudioSynth (menu-neutral music; actual playlist clock continues), UIScene |
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
* **AudioSynth** additive methods: `setSpeed(pxPerSec)` (music speed/intensity only; RunScene calls it every frame; BSOD event exclusively drives environmental wind),
  `setIntensity(0..1)`, `setHydrostaticMotion({terrainY,riderY,vy,grounded})` (read-only post-step terrain/rider snapshot for Underwater pressure memory), and `startMenuMusic()` (called once by Title, requests immediate One More Run, browser user gesture permitting).
  The same playback clock runs through Title, gameplay, death, pause and menus; only mix/melody/biome DSP changes.
  Menu uses unprocessed original accompaniment with Debumont melody and no speed/jump/BSOD DSP.
  Settings `musicShuffle` persists through SaveStore; ON shuffles following enabled songs in non-repeating rounds,
  not the fresh-load One More Run opener. All songs OFF remains music silence.
  Music intensity also follows `DISTANCE_CHANGED` during runs only.
  Underwater Mountain Hydrostatic uses the real `terrain.heightAt(sled.x)` and sled `y`/`vy`/grounded, sent once after physics via `AudioSynth` to `StemMusicDirector`; depth memory tracks the **deepest positive-down terrain Y below the entry terrain Y**. Rider Y never accumulates depth. Rising/airborne opens the *audible* pressure temporarily without changing stored pressure; falling/landing restores it; only a confirmed biome exit/new run resets it. Invalid samples hold last state. The native per-original-stem `hydrostatic` FX remains independent of Dynamic Orchestra, score, beat detection, gameplay physics, and transport. This behavior remains experimental behind draft issue #250's implementation, not yet a final sound mix.
* **BSOD accompaniment corruption:** the authoritative post-physics `BSOD_STATE_CHANGED.proximity01` independently drives music-only WebAudio darkening/distortion/tremolo on the ORIGINAL guitar, piano and Other buses via `BsodThreatProcessor`. It never drives or changes global SFX, environmental wind, vocals, bass, drums, note timing or source files. The signed `relativeAirX` continues to control wind separately, so quiet relative airflow near the wall can coexist with maximal musical threat. Original accompaniment recovers smoothly on escape, and Title/Pause/GameOver force clean neutral music without resetting the active track clock. The provisional effect intensity awaits human audition before release. There is **no event for push or hop**, so RunScene
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
* **ScoreManager** also exposes allocation-free `getTotal()` / `getDistancePoints()` (what `getSnapshot()` uses) for per-frame callers.
* **ScoreManager**: snapshot gains `penaltyPoints`; reset penalty is tracked separately so `trickPoints` stays >= 0.
  A `crash` landing quality banks nothing (no separate `onCrash` call needed, though it is harmless).
* **SaveStore**: `init()` never rejects (memory fallback, `store.backend` is `'idb'` or `'memory'`). Records are
  sanitised on save/load/import (unknown keys dropped). Sharecode = `BB1:` + base64(UTF-8 JSON `{app,v,runs}`), importer
  also accepts bare base64 / raw JSON, skips runs whose `ledgerHash` does not match their contents (per hash version; an
  empty hash is rejected since decision 6), and never throws.
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
   Space/Enter/A/RB/tap retry immediately with `registry REG.SEED` reset to `record.seed`; a pending, unsaved entry is saved
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
* **Slope-normal landing rebound** (additive): `BiomeEffects.springReboundVelocity(vx, vy, groundAngleDeg, upPxS)` keeps
  the along-slope velocity and raises the outward normal component to `max(existing outward, upPxS)`; a non-positive
  `upPxS` is a no-op. `Sled.launchNormal(upPxS, groundAngleDeg)` applies it through `Body.setVelocity` in Matter 0.20
  base-step units and resets contact/snap state like `launchUp`; a zero, negative or non-finite `upPxS` is a no-op
  before any body or state change. `RunScene.applySpringRebound` uses it once per scored (non-crash) landing with
  `fs.groundAngleDeg`, so a `bouncySpring` descent cannot turn forward speed into extra bounce; bounce pads keep
  `Sled.launchUp`. `BiomeEffects.springRebound` treats a result below `SPRING_REBOUND_MIN_PX_S` (120 px/s) as no
  rebound: at the shipped 0.2 share only impacts of 600 px/s or more are felt, while the Rails' 0.05 share stays below
  the floor even at 801 px/s. The 120 px/s floor is the measured point that keeps the bounce felt within the accepted ±15%
  mask-128 hop survival tolerance; the normal projection is checked on uniform slopes and makes no general
  irregular-terrain safety claim.

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
Every stored run counts (crash and quit); runs imported via sharecode count too (they carry initials). SUPERSEDED for the Daily
surfaces by decisions 1/2 (addendum at the end): Daily best counts only official runs, and the streak only official local runs.

* `store.getSeedStats(seed, {excludeRunId}?)` -> `{seed, attempts, bestScore, bestDistanceM} | null`. Best score and best distance are independent maxima.
* `store.getDailyStats(when = now, {excludeRunId}?)` -> same plus `dateKey`, for `DailyPatch.getDailyInfo(when).seed` (`when` is a Date or epoch ms).
  Since decisions 1/2: only official Daily runs on that date's mask (`Ranking.countsForDailyBest`).
* `store.getDailyStreak(now = new Date())` -> `{streak, playedToday, todayKey, lastPlayedKey}`. Day membership is the date inside the run's seed
  (`daily-YYYY-MM-DD`), not its timestamps (robust to clock skew and midnight-straddling runs). Streak ends today or yesterday, else 0; future-dated seeds ignored.
  Since decisions 1/2: only official, local Daily runs hold a day (`Ranking.countsForStreak`).
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
  the v1 `computeLedgerHash` (which hashes a fixed field list), so old saved runs stay valid. SUPERSEDED by decision 6: SaveStore now
  whitelists `bestFlow` and the v2 hash covers it (absent = 0); readers default it to 1 for display.
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

## Addendum: pilot profile, Resonance and Sync Levels (W1)

`ProfileStore` owns the player profile under its **own** `localStorage` key `bb.profile`, with its own `v` field. It is deliberately not in the settings blob: `sanitizeSettings` drops unknown keys, so anything parked in settings is erased on the next load, and reusing settings would force a `STORAGE.saveVersion` bump and a migration for every existing device. Nothing here writes `STORAGE.saveVersion`, and no profile field enters `computeLedgerHash` — a run's ledger hash must stay reproducible from the run alone.

`Progression.js` is pure: `xpForRun(record)` returns `{total, parts[]}` (1 XP per 10 m, per 50 score, 12 per trick, 5 per shard, 2 per near miss, 1 per 2 s of airtime), `levelForXp`/`xpToNext`/`rewardsForLevel` read the table from `src/data/progression/levels.json` (30 levels, `cap`, `biomeOrder`). Thresholds and rewards are data, so tuning is a JSON edit and no code path has a magic number. `level` is always **derived** from `xp` on load and on credit; a stale or hand-edited `level` field can never disagree with XP.

`ProgressionService` is created in `createServices` under `REG.PROGRESSION`. It subscribes to `EVT.RUN_END`, credits the record **synchronously** (so Game Over can read the awards on its first frame without awaiting anything), persists, and publishes the awards under `REG.LAST_AWARDS`. **`RunScene` is not edited** — the service observes the event the scene already emits, which is why this workstream needs no change to the run loop, the record builder or `computeLedgerHash`. Crediting is idempotent on `record.ledgerHash` (falling back to `record.id`) against a bounded ring (`CREDITED_MAX` 500), so a replayed `RUN_END`, a double scene start or a retry cannot double-award. On a device that already has history the profile backfills lifetime totals and XP once from `SaveStore.getRecentRuns`; the backfill is skipped when the profile already has runs, and a missing or throwing `SaveStore` never blocks boot.

UI is additive and cosmetic. `GameOverScene._buildProgression` draws one row in the band under the buttons (`y` 250): `+XP`, the Sync Level line, a Resonance bar for progress inside the level, and on a level-up the unlock line. It is driven off `REG.LAST_AWARDS` and renders nothing when no awards were published. Retry is still frame-one: the XP is already committed before Game Over ever runs, and `retry()` cancels the pulse tween. `TitleScene` gains a `SYNC LEVEL n` badge (level + title) and a `PROFILE` item opening `ProfileView` in `src/ui/Views.js` (`View` is not exported, so the view lives in that file rather than in a new module). All new graphics register a `Theme.bind` callback and are unbound on scene shutdown, so the colour-blind palette swap repaints them live.

Biome rewards are playable from W3 for the batch-1 biomes (see the W3 addendum below); the profile now reports how many are shipped rather than a `SIGNATURE LOCKED - COMING ONLINE` note that stopped being true. The profile is not in the `BB1:` share code; that is a follow-up.

## Addendum: biomes (W3, terrain + meta; additive)

Five batch-1 biomes, each a sector of ordinary terrain with one signature mechanic:
Debumont, Garbage Dump Glacier, Pyramid Peak, Underwater Mountain and Crystal Cavern.

**Selection is pure and cheap.** `biomeForSector(seed, sector, mask, defs)` answers from
`(seed, sector, mask)` alone - never from how much terrain has been generated or in what order -
so a chunk built late by streaming is identical to one built early. It draws from
`Rng.fork('biome')`, an independent stream, so *asking* the question never advances the terrain,
hazard or shard streams. Sectors 0-1 are always base Bitstream so every run opens the same way;
from sector 2 a sector is base or one enabled biome, weighted 2.2:1 toward base.

**A biome's chunk templates are a preference, not a filter.** If its templates are not eligible
at that distance the sector still gets ordinary terrain, so a biome can never leave a hole in
the ramp.

**The `biome` field is written only inside a biome, and cleared when a pooled chunk returns to
base terrain.** Absent rather than `null`, deliberately: `JSON.stringify` of a mask-0 chunk stays
byte-identical, which is what the pre-existing hazard-fill digest guard compares.

**Mechanics.** Four are physics multipliers on the existing `terrainMods` schema (powder drag,
sticky ground, thermal loft, slow-motion). Crystal Cavern's is scoring: "tricks landed inside
score a combo bonus" cannot be written as a physics multiplier, so its mod carries an additive
`scoreMul` applied to banked trick points only - never the flat perfect-landing bonus, never
distance points, clamped to `>= 1`. This is an intentional extension of `TerrainModDef`.

**Persistence.** `biomeMask` is in `sanitizeRun`'s whitelist and is *not* part of the v1
`computeLedgerHash` (which hashes a fixed field list); there is no `saveVersion` bump. Since decision 6
the v2 hash (new records, `hashV: 2`) covers `biomeMask` and `modded`; see the addendum at the end. Records
written before W3 have no field and count as mask 0. `getSeedStats` takes an opt-in `biomeMask`
scope so seed-best compares within one mask; omitting it keeps pre-W3 behaviour.

**Daily.** The Daily Run's mask is derived from the UTC date key alone - identical for every
player, independent of unlocks (a locked biome may appear as a preview, per D6). 9-day cycle:
4 clear days plus one day per batch-1 biome. SUPERSEDED by decisions 1/2 (addendum at the end):
`getDailyStats` now counts only official Daily runs and filters on the date's mask explicitly.

**UI.** Biome entry raises a banner through the same serialised strip queue as the mission
toast, so the two cannot overlap. Seed entry accepts `seed@mask`; a bare seed parses to mask 0
and is used verbatim, and a malformed suffix is treated as a seed rather than rejected.

**Gates.** Golden mask-0 terrain test pins 300 chunks x 5 seeds before any generator change.
Per-biome screenshots in both palettes come from `node tools/sim/shots.mjs biomes <dir>`, each
reporting the biome its generator claims, so a shot that fell back to base terrain fails loudly.
Per-biome simulation uses `--biomeMask`, and the mask must ride on the run *options* (the page
reads `o.biomeMask`), not only on `params` - having it only in `params` silently played every
mask as 0.

Gate harness: `node tools/sim/shots.mjs progression <dir>` (`tools/sim/shots-progression.js`) drives the **real** services and scenes — a real `RUN_END`, real `GameOverScene`/`TitleScene` — and shoots Game Over (normal and level-up), the Title badge and the Profile view in both palettes. The XP awards in those shots come from the real credit path, not from faking the registry.

## Missions

`Missions.js` implements deterministic mission selection and evaluation. It seeds draws from the profile mission counter, sorts eligible templates by ID, and filters biome- and rule-ineligible templates. Tier determines the reward multiplier AND gates offerability by Sync Level (D7): `missions.json` carries a `tierUnlock` map of tier → minimum Sync Level (tier 1 at level 1, tier 2 at 3, tier 3 at 6, tier 4 at 10), and `drawMissions` drops templates above the profile's unlocked tier before the seeded pick. Thresholds live in data so they can be tuned without a code change; tier 1 is always open. If the unlocked tiers cannot fill three slots, the draw widens only up to the highest tier at or below the profile's ceiling, never above it — D7's wording is "fall back to the highest unlocked tier, never an empty slot", so a thin pool may return fewer than three missions rather than leak a tier the player has not unlocked. Gating never re-rolls or drops a mission already in a slot: a profile that drew a tier-3 mission before this rule existed keeps it and keeps its progress, and only its refills are gated. `MissionsService` publishes active mission progress through `REG.MISSIONS` and sends live completion notifications; `ProgressionService` invokes its payout path only after a run has been credited, so replaying a credited run cannot pay a mission twice. Mission state and rewards persist in `bb.profile`. Title, Pause and Game Over render the published view; HUD notifications share the milestone strip.

## Addendum: shop autoprompt (W4.1, additive)

Marvin's request was that a player who can afford something be taken to the Shard Shop instead of having to
remember it lives behind PROFILE. The shop is **not** added to the Title menu (that stays as it was); Game Over
gains a popup and a hint.

**The decision is made once, at credit time, by `ProgressionService`.** It is the only place that sees the
profile both before and after the run, so it is the only place the question "did this run *newly* make
something affordable" can be answered exactly. `credit()` and `applyMissions()` both move the bank, so
re-deriving a "before" afterwards from the credit would be arithmetic guessing; instead the service snapshots
`shopState(profile)` (bank, level, owned cosmetics) before crediting, and `newlyAffordable(before, after)`
compares the two. The answer is published as `shopAutoprompt` on the awards view in `REG.LAST_AWARDS`; Game
Over renders it and never re-derives economy rules. Nothing is stored, so there is no new profile field, no
`saveVersion` bump and no ledger-hash change.

**`ShopPrompt.js` restates the shop's refusals rather than calling them.** `isOwned`/`purchase` resolve their
item from the module-level `SHOP_ITEMS`, so they cannot be pointed at another catalogue, and a helper that
quietly judged a different list than the panel it opens would be worse than useless.
`tests/src/shop-prompt.test.js` instead proves equivalence with the real `purchase()` across a grid of banks,
levels and owned-sets on the shipped catalogue, in both directions: anything the helper calls affordable is
actually buyable, and when every purchase is refused the helper says so. Repricing the catalogue therefore
breaks the tests rather than the popup.

**Frequency.** The popup fires only when this run crossed something; the footer hint `SHOP: B / LB` shows
whenever anything is affordable, popup or not, so a stockpile player is told about the shop without being
interrupted every round. `B`/`b` is a `MenuInput` action (`shop`) rather than a scene-local key listener, so it
gets the same debouncing and a gamepad equivalent, and the footer cannot advertise a key that does not exist.

**Retry always wins** (superseded in part by Marvin decision 7, 2026-11-14; see the decisions 7/8/9 addendum).
Input is live from the first frame; any action or tap before the timer fires cancels the popup; while the shop is
open, `retry` (Space / pad RB) closes it and retries, `confirm` (Enter / pad A) acts on the highlighted row once
the shop is armed (before that it closes and retries), `cancel` closes it back to Game Over, `alt` closes it and
starts a new seed. The pending timer, the arm timer and the open view are all torn down on shutdown, so nothing
fires into a scene that is gone.

**Known gap.** `notes/cc-friday-shop-popup-2.txt` mentions "boosts not yet owned" as part of purchasability.
Boosts have no price in this economy — they are level rewards toggled in the shop, not bought — so there is
nothing for that clause to match. Inventing a price would be a new economy decision, which is Marvin's, not
this workstream's.

## Addendum: W6 biome backdrops (audit T1, additive)

Every biome file's `background` id must name an entry in `Background.MOTIFS`;
`tests/src/biome-background.test.js` reads the biome files to check this, so a new biome that names a
motif which does not exist fails the suite. Before this fix, the six W6 biomes fell back to base ridges.
`MOTIFS` now has 11 ids. Each W6 id adds a silhouette shape and a decor pass:

| motif | biome | silhouette shape | decor |
|---|---|---|---|
| `stars` | Space Mountain | `crater` | starfield (twinkles) and a ringed planet |
| `candy-stripes` | Candy Cane Canyon | `gumdrop` | candy-stripe sky, canes (far ridge), lollipops (near ridge) |
| `jellyfish` | Sky Jellyfish Mountain | `cloud` | drifting, pulsing jellyfish with swaying tendrils |
| `brass-pipes` | Steampunk Slopes | `works` | turning gears behind the roofline, a brass pipe run |
| `dew-drops` | Micro Mountain | `moss` | grass blades with big dew drops that glint |
| `vents` | Vertigo Vents | `cone` | an amber glow at each vent mouth and a rising smoke plume |

New pure exports in `entities/Background.js`. Both are additive; `motifGeometry` is unchanged.
* `motifProfile(shape, wx, seed) -> number`: the layer height sample. `Background._profile` delegates to it.
  The batch-1 shapes and `peak` give the same values as before.
* `motifDecor(motif, scrollX, timeMs = 0, seed = 0) -> ReadonlyArray<primitive>`: the decor primitives
  (`poly`, `line`, `circle`, `rect`). Each primitive has a palette colour **key** and a `depth`:
  -1 = sky, k = drawn right after silhouette layer k. The decor is a pure function of its arguments.
  The layout comes from a seeded mulberry32, and the animation comes only from `timeMs` (scene time).
  `Background` uses `decorSeed = 0`, so one biome looks the same in every run.
  It returns `[]` for the base backdrop and the five batch-1 motifs, so their draw calls are unchanged.

Rules (the tests enforce them):
* Decor never uses the `danger` key, so only hazards use the hazard colour. The renderer test records
  real draw calls with a sentinel `danger` value.
* Decor stays inside 480x270, with an overhang of up to 96 px at the left and right edges only.
* Each frame is still redrawn into one Graphics. A W6 frame makes at most 2.5x the draw calls of the
  base backdrop (2.1x was measured for `candy-stripes`, the most expensive).

## Addendum: biome full treatment, B0 groundwork (engine only; additive)

B0 adds the engine for each biome's own hazard and power-up (spec `bitstream-biome-treatment-spec.md` §5-§6). It ships
**no biome content**: B1-B4 add the JSON under `data/hazards` / `data/powerups`. With no biome defs in content every
generator output is unchanged except the E7 zone rule below, and mask 0 is byte-identical (golden `shape` / `full` /
`complete` digests unchanged).

**New data fields (all optional, `data/schemas.js`).**
* `HazardDef.biome` / `PowerUpDef.biome`: a biome id. Such a def is removed from `hazardList`, `airHazardList` and
  `powerupList` in the `TerrainGenerator` constructor and kept in `biomeHazards[biome]` / `biomePowerups[biome]`
  (sorted by id). Base placement can never see it, so it cannot move a mask-0 pick (isolation test:
  `tests/src/biome-spawns.test.js`).
* `HazardDef.spawn.baseChance` (biome defs only) and the existing `PowerUpDef.spawn.baseChance`: the chance of the
  chunk's biome slot, capped at `BIOME_SPAWN_MAX_CHANCE` 0.5 (default `BIOME_SPAWN_DEFAULT_CHANCE` 0.2). Biome
  power-ups have no distance decay. `weight: 0` disables a biome def (the biome pick does not use `weight || 1`).
* `HazardDef.onHit.effect` gains `'blind'` `{durationMs?, visibility?}` and `'gust'` `{impulsePxS:[x,y]}`.
* `PowerUpDef.effect.kind` gains `'ward'` `{durationMs, mods[], hazards[], effects[]}`, `'glide'`
  `{frictionMul, durationMs}` and `'stabilize'` `{landingToleranceDeg, bounceMul?, durationMs}`.
* Not in B0: `HazardDef.motion` (`roll`, `gate`) lands with B3.

**Generator pass `_placeBiomeSpawns`.** Runs last in `_build`, after `'air'`, only when the chunk's `biome` is set, from
`crng.fork('biomeHaz')` and `crng.fork('biomePu')` (forks derive from the chunk root's initial state, so creating them
moves no other stream). One hazard slot and one power-up slot per biome chunk; each draws exactly `BIOME_SLOT_DRAWS` (5)
numbers up front whatever happens, so one def's chance or a blocked position never shifts the other slot.
* Ground hazards: never on bridge or jump chunks; `BIOME_EDGE_MARGIN_PX` (= `HAZARD_END_MARGIN_PX`, 240) from the chunk
  edges (spec asks >= 96; 240 is what keeps `HAZARD_MIN_SPACING_PX` across a chunk border); the breather calm stretch,
  lip windows `[lip.x - 40, zoneEnd]`, `noHazX`, gaps +/- 96 px, 480 px from any hazard, 90 px from any power-up,
  the base slope / flatness rules, `slow` only before a descent, and no shard over the box. The slot scans the chunk in
  `HAZARD_RETRY_STEP_PX` steps from a drawn start. `chunk.hazards` stays sorted by x.
* Air biome hazards (`placement: 'air'`): only in jump chunks, using the base jump-arc box (`_airSpan`, `_airHiMul`,
  `_tryAirBox`, shared with `_placeAirHazard` and maths-identical to it) and `_airBlocked`. `AIR_HAZARD_MIN_M` does not
  apply (biome sectors start at 1000 m); the def's own `minDistanceM` does.
* Power-ups: inside the same edge margins, > 480 px from x = 0, 90 px from any hazard and any power-up, clear of gaps and
  shards, lifted like a base pickup. `chunk.powerups` stays sorted by x.
* Measured with a fixture def at chance 0.5: base hazards fill eligible ground every ~480 px past 2 km, so the 480 px
  spacing blocks most ground slots (about 10 placements per 4 seeds x 300 chunks at mask 2|32). Power-up slots land
  in about 40 % of biome chunks.

**E7 zone rule (Marvin 2026-11-14, audit TERRAIN-1).** In a chunk where `_placeBiomeZone` placed a zone, `_placeZones`
places no template zone, so a biome mechanic is never multiplied into its opposite. `_placeBiomeZone` now runs first
and returns whether it placed a zone; both keep their own forks. This moves mask != 0 zones (and seed@mask bests) on
purpose; mask 0 is untouched. Test: `tests/src/biome-zone-stacking.test.js`.

**Effects (math in pure modules; scenes only call them).**
* `systems/Wards.js`: `emptyWards()`, `addWard(state, id, effect)` (durations clamped to `WARD_MIN_MS`..`WARD_MAX_MS`,
  4-6 s; re-collecting refreshes), `tickWards(state, dtMs)` -> `{state, expired}`, `isWarded(state, {modId|hazardId|effect})`,
  `wardMsLeft(state, id)`. `PhysicsTuner.getEffective` skips a zone whose mod id is warded. `RunScene.onHazard`
  ignores a hit whose hazard id or effect is warded (no `HAZARD_HIT`), and a warded slow / scramble / blind stops acting.
* `systems/BiomeEffects.js`: `gustImpulse` (vector norm capped at `GUST_MAX_PX_S` 180), `blindVisibility` (>=
  `BLIND_MIN_VISIBILITY` 0.35) and `blindOverlayAlpha(msLeft, totalMs, visibility)` (pure function of time, <= 0.65),
  `glideFrictionMul` ([0.2, 1], default 0.7), `stabilizeToleranceDeg` ([0, 30]), `stabilizeBounceMul`,
  `resolveLanding(landing, toleranceDeg, TUNING)` (the old forgiveness rule when the tolerance is 0; a stabilize
  re-grades with the angle reduced by the tolerance and widens the forgiveness angle by it), `hazardEffectDurationMs`,
  `timedPowerupMs`, `hazardColorKey` (a **biome** crash hazard is always `danger`; base defs keep their colorKey),
  `hazardDrawKind` / `powerupDrawKind` (an unknown shapeKey draws the generic shape).
* `TunerContext` gains `wards`, `glideFrictionMul` (multiplies `frictionMul`, so `groundResist`; Matter friction stays
  0) and `stabilizeBounceMul` (multiplies `bounceMul`).
* `RunScene`: `onHazard` branches `blind` (white flash, then a `palette.bg` overlay `blindRect` at depth 99 under the
  flash; the HUD scene stays on top) and `gust` (`_addSledVelocity` through Matter `Body.setVelocity`); `onPowerUp`
  branches `ward`, `glide`, `stabilize`. New methods: `physicsContext(pad, zoneDefs?)` (the frame's tuner context, now
  testable), `_resetBiomeEffects()`, `_endBiomeEffects(reason)`, `tickBiomeEffects(dt)`, `updateBlindOverlay()`.
  Events reuse the existing payloads: `HAZARD_HIT.effect` can be `'blind'` (with its duration) or `'gust'`
  (`durationMs` 0); `EFFECT_END {effect:'blind'}`; `POWERUP_COLLECTED {id, durationMs}` for ward / glide / stabilize;
  `POWERUP_EXPIRED {id, reason}` with reason `'timeout'`, `'respawn'` (manual reset) or `'replaced'` (a different
  glide / stabilize def took over). Biome pickups never touch `modded` or Ranking.
* `UIScene`: `EFFECT_INFO` rows `blind` ("BLINDED") and `gust` ("GUST", shown >= 700 ms); `POWERUP_KIND_INFO` gives
  ward / glide / stabilize a chip colour and its own icon in `_drawIcon` until a pickup id gets its own `POWERUP_INFO` row
  (`_powerInfo(id)`, `_powerKind(id)`). The active-effect chip is the existing power-up chip.
* `Hazard.js` / `PowerUp.js` draw through `hazardDrawKind` / `powerupDrawKind`; the generic pickup glyph is a filled
  diamond.

**Tests and gates.** `tests/src/biome-effects.test.js` (pure math), `tests/src/biome-effects-runscene.test.js` (the first
Jest test that imports RunScene, UIScene, Hazard and PowerUp: a small fake Phaser and the shipped methods on a prototype
stub), `tests/src/biome-spawns.test.js`, `tests/src/biome-zone-stacking.test.js`. The built-game gate has five B0 checks
that act on the real run (ward vs stickyPatch, glide, gust, blind, stabilize) with fixture defs injected into the registry
content. Sim baseline for B1-B4: `tools/sim/baselines/biomes-b0.json` (README there).
## Addendum: cosmetics, titles and themes (audit F4 / F4b / SHOP-2 / SHOP-5, additive)

**One catalogue.** `systems/Cosmetics.js` exports `COSMETIC_ITEMS`, a frozen array of
`{id, kind, slot, name, price, unlockLevel, value, grant?}`. `kind === slot` for every item. `ProfileStore.SHOP_ITEMS`
is the same array (identity), and the resolver's id table is derived from it. `data/cosmetics/cosmetics.json` is a
mirror only: `tests/src/cosmetics-complete.test.js` fails if any field differs. Pure modules cannot import JSON
under Jest, so the JS constant is the source.

**Ownership.** `isOwned`: listed in `unlocked.cosmetics`; or `grant === 'achievement'` and `value` is in
`unlocked.titles`; or price 0 and `unlockLevel <= level` (level rewards, including the eleven in `levels.json`).
`purchase` refuses price-0 items.

**Lookups.** `cosmeticInSlot(slot, idOrValue)` matches an id or an equipped value inside one slot. Values repeat
across slots, so `resolveCosmetics` uses it. `cosmeticFor(idOrValue)` is unchanged (first match by value).
`equippedTitle(profile)` returns the equipped title text or null.

**Themes.** `COSMETIC_HUES.theme[value].ui` is a partial palette over `UI_THEME_KEYS` = cyan, magenta, text,
bgAlt. `themedUiPalette(baseHex, profile, {colorblind})` lays it over the active palette. It returns the base
unchanged under colour-blind mode, and it can never move `danger`, `bg`, `lime` or `amber`.
`ui/Theme.js` builds `pal`/`css` through `themedPalette(game)`, which reads `REG.PROFILE` and
`REG.SETTINGS`, so every Theme consumer is themed: menus, panels and the UIScene HUD. The world palette
(`Palette.getPalette`, used by RunScene) is never themed. Call `theme.refresh()` after the equipped theme
changes; ShopView does this after every buy or equip.

**Shop pages.** `ShopLayout.SHOP_PAGES` = trail, glow, rider, theme. `shopLayout({profile, levels, page})` lays
out one page: BANK head, the page row (`kind:'page'`, first selectable), that slot's items, boosts and loadout.
It returns `page`, `pageCount` and `pageSlot`. `shopAllRows(o)` returns every page's item rows. ShopView pages
on left/right when focus is on the page row or an item row, and on confirm or click of the page row.

**Titles.** `ShopLayout.titlesLayout({profile, levels})` / `titlesMenuItems(layout)` drive `Views.TitlesView`.
Profile opens it from `titlesButton` (focus target kind `'titles'`). `ProfileLayout` shows `equippedTitle()`
in place of the level title in `profileLayout` (key `title`) and in `titleBadgeLayout`. TitleScene calls
`_refreshLevelBadge()` when Profile closes.

## Addendum: Marvin decisions 7/8/9 (Game Over shop buy, Sugar Rush steering, combo order; additive)

**Achievement order (decision 9).** `Achievements.sortAchievements(list)` is the one ordering: group
(`GROUP_ORDER`: distance, skill, daily, collection, biomes), then metric (`METRIC_ORDER`, the same set as
`METRICS`, so one ladder stays together), then `target` ascending; stable on input order; an unknown group or
metric sorts last. `ACHIEVEMENTS` is stored in this order and also sorted at load. `qualified` and
`newlyUnlocked` filter it, so `creditRun` reports the newly unlocked defs in this order, all of them in one
evaluation with one caller timestamp, and the Game Over toast shows them in this order (up to three names;
more than three: two names and `+N MORE`). `groupedAchievements` and `AchievementsLayout.GROUPS` follow
`GROUP_ORDER`. Ids never change (saves key on them); names and descriptions follow the targets.
`data/achievements/achievements.json` is kept in the same order (tested).

**Zone steering (decision 8).** A terrain mod's `physics.steerMul` multiplies `EffectivePhysics.airControl`
only. The effective `steerMul` (0 under a parachute, the daily `tuckSteerMul` when tucked) never takes a zone
factor, so ground lean (`tiltTorqueDegS2 * TUNING.groundTiltMul * steerMul * tiltSign` in `Sled`) is the same
inside and outside any zone. A zone may dull air control but must never take ground steering away from the
player. `tests/src/sugar-rush-steering.test.js` pins this against PhysicsTuner's pure output.

**Game Over shop buy (decision 7).** In the Shard Shop over Game Over, Enter / pad A (`confirm`) go to `ShopView`
once the shop is **armed**: buy + equip, equip, unequip (confirm on EQUIPPED) or turn the page, exactly the Title ->
Profile -> Shop rules. Retry stays one press: `MenuInput` opt-in `{ retryAction: true }` (GameOverScene only) fires
`retry` for keyboard Space (before Space's usual `confirm`; InputRouter's keyboard `hop` is how Space is told from
Enter) and for pad RB (button 5; free in MenuInput and in InputRouter's menu actions; Y is `alt` = new seed and
Start is `cancel`). `retry` closes the shop and retries from every state, and during initials entry it saves and
retries like Space. Esc / pad B / B / LB close the shop; N / X / Y start a new seed.
Arming: a shop opened with B / LB (`_openShop({requested: true})`) is armed at once. The autoprompt (and its resumed
form after initials entry) opens unarmed, and arms after `SHOP_ARM_MS` = 500 ms or on the first cursor move. The
popup only appears after 1.2 s with no input, so the press at risk is one started before the panel was seen; choice
reaction time is about 400-500 ms, so a confirm inside that window was aimed at Game Over and keeps the old
close-and-retry (pillar 3). The default focus is the page row, so even a later stray Enter only turns the page.
Hints: while unarmed the footer keeps `SPACE / ENTER / A / TAP = RETRY SAME SEED` (true for Enter then); once armed
it reads `ENTER / A = BUY   SPACE / RB = RETRY   ESC / B = BACK` (263 px, centred) at depth 501, above the dim (400),
on the row under the panel (panel y 22..258, footer ink y 261..269). `SHOP: B / LB` is hidden while the shop is open.
Closing restores the footer text and depth. With the shop closed nothing changed except that pad RB also retries.


## Addendum: biome full treatment, B1 "Wards" (content + slot rule; additive)

B1 ships the first biome content: one hazard and one power-up for each of Debumont, Garbage Dump Glacier, Underwater
Mountain and Candy Cane Canyon (spec §4). Mask 0 is byte-identical (golden `shape` / `full` / `complete` unchanged): every
def below carries a `biome` field, so the B0 constructor filter keeps it out of the base lists.

| Biome (bit) | Hazard (file) | Hazard effect | Power-up (file) | Power-up effect |
|---|---|---|---|---|
| Debumont (1) | `groomerCat` (`groomer-cat.json`), ground 24x20, shape `groomer`, amber | `slow` 0.7 x 900 ms | `mapleWax` (`maple-wax.json`), shape `maple` | `speedBoost` 1.2 x 2 s |
| Garbage Dump Glacier (2) | `seagullDive` (`seagull-dive.json`), air 40x24 in jump arcs, shape `seagull`, `danger`, >= 1000 m | `crash` | `slickWaxSpray` (`slick-wax-spray.json`), shape `waxSpray` | `ward` mods `['stickyPatch']` 4 s + `speedFactor` 1.1 |
| Underwater Mountain (8) | `seaweedTangle` (`seaweed-tangle.json`), ground 22x30, shape `seaweed`, lime | `slow` 0.6 x 1.2 s | `aquaLungBubble` (`aqua-lung-bubble.json`), shape `bubble` | `ward` mods `['slowMotion']` 4 s |
| Candy Cane Canyon (64) | `chocolateRiver` (`chocolate-river.json`), ground strip 24x8, shape `chocoRiver`, amber | `slow` 0.5 x 1.5 s | `sweetToothCoating` (`sweet-tooth-coating.json`), shape `candyCoat` | `ward` effects `['slow']` 5 s (wards off the Chocolate River) |

Hazard `spawn.baseChance`: groomerCat 0.5, seaweedTangle 0.55, seagullDive and chocolateRiver 0.75 (the amended cap);
power-ups 0.4. Groomer Cat is static; motion kinds land in B3.

**Slot rule (`TerrainGenerator._placeBiomeSpawns`, spec §4 amendment).** When the ground hazard slot fires and the free
scan finds no slot, `_replaceBiomeGround` swaps ONE base ground hazard of the chunk for the biome def, in place (same `x`,
`y`, `rotationDeg`). Candidates are base ground defs (`hazardList`; never a biome or air def) whose box grown by
`BIOME_REPLACE_SLACK_PX` (8) in w and h holds the biome box, and whose spot passes every biome ground rule with the biome
def (`_biomeGroundAt`, shared with the free scan; the spacing check skips the candidate itself, the shard check uses the
biome box, a `slow` keeps its slope rule below). The pick is `cands[floor(h4 * n)]`, where `h4` is the slot's 5th draw (B0
drew and discarded it), so `BIOME_SLOT_DRAWS` stays 5 and no other stream moves. Air biome hazards are not replaced.
With no biome defs, output at every mask is unchanged (digests pinned at 00978f6: `tests/src/biome-slot-rule.test.js`).

**Presence amendment (spec author, 2026-11-14).** The first B1 cut placed biome hazards in about 7 % of early biome chunks:
too rare to be felt. Amended rules, all in `_biomeGroundAt` / `_placeBiomeSpawns`:
* (a) a biome ground hazard keeps `BIOME_HAZARD_CLEARANCE_PX` (240) from any other hazard, not `HAZARD_MIN_SPACING_PX`
  (480). `BIOME_EDGE_MARGIN_PX` (240) stays, so hazards across a chunk border are still >= 480 apart and base pairs never
  change.
* (b) the descent-ahead rule (`_descentAhead`, anti-stall) binds a biome `slow` only when its `speedFactor` is below
  `BIOME_GENTLE_SLOW_FACTOR` (0.6): Chocolate River. A gentler slow (Groomer 0.7, Seaweed 0.6) may sit on flat or downhill
  ground but never before a climb: `_noClimbAhead` rejects any rising segment in the `BIOME_EDGE_MARGIN_PX` ahead (always
  inside the chunk).
* (c) the biome HAZARD slot's chance cap is `BIOME_HAZARD_MAX_CHANCE` (0.75); power-ups keep `BIOME_SPAWN_MAX_CHANCE` 0.5.
* (d) the replace rule stays the fallback.

Measured presence, share of the biome's chunks eligible for the placement kind (ground = not bridge / not `gen-jump`, air
= `gen-jump`), chunks 0-44 at a single biome bit: groomerCat 44.4 % (8 seeds) / 42.9 % (32 seeds), seagullDive 35.3 % /
42.9 %, seaweedTangle 35.7 % / 37.5 %, chocolateRiver 24.0 % / 20.9 %. The lead's target is 35-55 % and >= 1 per 2 km on every
seed. Open items: the river stays below the band under rule (b) (36x9 reached 15 %); the seagull (air slot, not covered by
the amendment, often 2-3 biome jump chunks per seed) misses the per-seed rule on 3 of 6 seeds with biome terrain. No-stall
check: a point mass entering any biome slow placement at 300 px/s keeps >= 128 px/s for the next 2 s. Power-ups land in
31-35 % of biome chunks.

**Effects (all existing paths except one additive field).**
* `Wards.js`: a ward may carry `speedFactor` (clamped to [1, `WARD_MAX_SPEED_FACTOR` 1.2], `wardSpeedFactor`), lasting as
  long as the ward. `wardSpeedMul(state)` is the product over active wards; `RunScene.physicsContext` multiplies it into
  `speedBoost`, separate from `boostMs` / `boostFactor`, so a Packet Burst or Maple Wax never overwrites it. On pickup
  RunScene also kicks the sled by `speedFactor` (like `speedBoost`).
* `RunScene`: the `speedBoost` branch records `boostId`; its expiry reports `POWERUP_EXPIRED {id: boostId}` (was the
  hard-coded `packetBurst`, which would have expired Maple Wax under the wrong chip). Packet Burst still reports
  `packetBurst`.
* `UIScene`: `POWERUP_INFO` rows MAPLE WAX, SLICK WAX, AQUA-LUNG, SWEET-TOOTH with their own `_drawIcon` glyphs;
  `HAZARD_LABEL` names the B1 slow hazards on the effect warning line (GROOMER CAT, SEAWEED TANGLE, CHOCOLATE RIVER); other
  hits keep their `EFFECT_INFO` label.
* `BiomeEffects.HAZARD_SHAPES` / `POWERUP_SHAPES` gain the 8 new shapeKeys; `Hazard.js` (`_groomer`, `_seaweed`,
  `_chocoRiver`, `_seagull` drawn like the drone, without corner brackets) and `PowerUp.js` draw each one.

**Tests and gates.** `tests/src/biome-b1-presence.test.js` (presence on the 8 + 32 seeds, rules (a) and (b), no-stall),
`tests/src/biome-slot-rule.test.js` (now also a spy test that the pick is `cands[floor(r * n)]`),
`tests/src/biome-b1-content.test.js` (loader / schema, spec
values, ward pairing, measured presence floors), `tests/src/biome-b1-effects.test.js` (shipped defs through the shipped
RunScene / UIScene / Hazard / PowerUp). Tests that listed ALL content now list base defs (biome defs separately):
`data.test.js`, `terrain.test.js` "all hazard types", `_biomeFixtures.withBiomeFixtures` (base content + fixtures).
`biome-spawns.test.js`'s last test states the amended contract (at most one base hazard swapped in place); after the presence
amendment its spacing test reads biome pairs >= 240 / base pairs >= 480, its cap test 0.75 (hazards) / 0.5 (power-ups), and
its fixed-draws test allows a power-up to move to its freed first position. The built-game
gate has 8 B1 checks, one hazard and one power-up per biome, each on a real `seed@bit` run with entities built by
`RunScene.takeChunk` from that run's terrain (expected counts 30 -> 38 with boosts, 19 -> 27).

## Addendum: Marvin decisions 1/2/4/6 (official Daily, mask-scoped Daily bests, Head Start, ledger hash v2)

**Official Daily (decision 2).** `REG.DAILY_OFFICIAL` (additive) is set on every Title start: true only from the DAILY RUN
item (`TitleScene._startDaily` -> `startRun(seed, mask, {official: true})`). Game Over RETRY sets it to the retried
record's `dailyOfficial`; NEW SEED sets false; PauseScene's restart keeps it (same seed, same mask). `RunScene.create`
sets `this.dailyOfficial = flag && seed is TODAY's daily seed`, writes `dailyOfficial` on the record and in the
`RUN_START` payload (additive), and passes it as Boosts' `daily` option, so only the official Daily refuses boosts. A
typed `daily-YYYY-MM-DD` with no suffix gets that date's mask in `TitleScene.startRun` (precedence: override, suffix,
typed daily date, profile mask); RunScene plays that date's rule for any daily seed.

**Ranking (decisions 1/2).** In `systems/Ranking.js`, additive:
* `isOfficialDaily(record)`: daily seed, the date's mask (absent = 0) and rule (`DailyPatch.infoForDateKey`). A v2 record
  (`hashV >= 2`) must also have `dailyOfficial === true`. A legacy record (no `hashV`) needs only the mask and rule. The v2
  rule is what keeps a typed `daily-<today>` (today's mask and rule) from passing as a legacy official run.
* `countsForDailyBest(record, o)` = `isRankable && isOfficialDaily`. `countsForStreak(record, o)` adds `imported !== true`.
* `SaveStore.getDailyStats(when, {excludeRunId})`: same signature and shape. It counts only `countsForDailyBest` runs on
  the date's seed and mask. `getDailyStreak(now)`: same signature and shape, counting only `countsForStreak` runs.
* `ProfileStore.creditRun` counts `lifetime.dailyRuns` (and so the Daily achievements) only for an official, non-imported
  record.

**DailyPatch (additive).** `infoForDateKey(dateKey)` -> `{dateKey, seed, rule, biomeMask} | null` (frozen, memoised, pure).
`dailyRunLabel(seed, official)` -> `'DAILY RUN'`, `'DAILY PRACTICE YYYY-MM-DD'` or `''`.

**Ledger hash v2 (decision 6).** SaveStore exports `LEDGER_HASH_V` (2), `computeLedgerHashV1` (the old function,
byte-identical), `computeLedgerHashV2` and `verifyLedgerHash(record)`. `SaveStore.computeLedgerHash` keeps its
signature and dispatches: `hashV === 2` -> v2, otherwise v1.
* v2 covers `'v2'`, version, id, seed, dailyRuleId, biomeMask (absent = 0), modded (strict boolean), the sorted `boosts`
  ids, dailyOfficial (strict boolean), startedAt, endedAt, durationMs, score, distanceM, trickPoints, sorted tricks,
  bestCombo, bestFlow, maxAirtimeMs, cause, shards, nearMisses and bonusPoints (absent = 0). It excludes initials,
  ledgerHash and `imported`.
* `sanitizeRun` whitelists `hashV` (exactly 2, never defaulted), `bestFlow`, `dailyOfficial` (boolean), `boosts` (id
  strings, sorted, unique, max 8) and `imported` (true only). A record without `hashV` is never re-hashed, so crediting
  (keyed on `ledgerHash`) cannot double-credit. `STORAGE.saveVersion` is unchanged.
* `importSharecode` uses `verifyLedgerHash`: per version, and an empty hash is rejected. It never throws. It forces
  `imported: true` on what it adds. `saveRun` drops `imported`. Leaderboard rows and `exportSharecode` omit it.

**Head Start (decision 4).** `BOOST_DEFS.headStart`: `speedFactor` 12 (launch multiplier on the ~50 px/s spawn,
through `Sled.scaleVelocity`), `openingSpeedMul` 1.6, `openingMs` 8000, `openingFadeMs` 2000. Pure, additive:
* `headStartOpening(loadout, o)` -> `{speedMul, ms, fadeMs}`. It is `{1, 0, 0}` unless Head Start applies (on, owned,
  not the official Daily).
* `openingSpeedMul(opening, runTimeMs)`: full strength, then a linear fade, then exactly 1.
* `RunScene.physicsContext` multiplies it into `speedBoost`, separate from `boostMs` and the ward factor.
`boostEffects` keeps its `{shieldCharges, speedFactor, modded}` shape.

**Gate.** `dailyOutcome` (typed seed vs the real DAILY RUN item, through the production crash path, plus the ledger v2
export / tamper / import round trip) and `distanceAt10s` (loop stopped, `headlessStep` at 1/60 s, hands off, seed `hs-1`).
Expected counts 38 -> 42 with boosts, 27 -> 30 without.

**Known gaps.** Imported runs saved before this change have no `imported` marker, so a legacy imported record on its
date's mask and rule can still hold a streak day. `events.js`' RUN_START typedef does not list the additive `dailyOfficial`
field (foundation file, outside this change). `UIScene._buildSeedInfo` still labels any run on today's daily seed `DAILY RUN` in the HUD. UIScene was
outside this change's files. The fix is to use `DailyPatch.dailyRunLabel(seed, payload.dailyOfficial)` from `RUN_START`.

## Addendum: Micro Mountain dew swell is in the ground (audit T2, additive)

* **One surface.** A zone whose mod has `terrainSwell` displaces the chunk **points** inside the zone
  (`TerrainGenerator._applySwell`, called in `_build` right after zone placement and before lips, hazards, power-ups,
  shards and biome spawns). The Matter collider and the drawn edge (`TerrainMesh`, which reads the points), `slopeDegAt`,
  `heightAt` and every spawn therefore describe the same ground. `heightAt` is the plain polyline again; it does not add
  the swell. `_swellAt(x)` remains as a diagnostic: the displacement already baked into the points at x.
* **Shape.** `amplitudePx * sin(2 pi (x - x0) / periodPx) * w(x)`, where `w` is a raised-cosine window that rises from 0
  to 1 over `taperPx` at each zone edge (clamped to half the zone; absent = no taper). Offset and slope are 0 at the
  edges: no step, no kink. Only `points` change: zones sit >= 96 px inside their chunk, so the end points, the next
  chunk's bound, the rise state and the roll speed (all built from the scratch `ys`) are untouched. Chunks with no swell
  zone return before touching a point, so every chunk outside Micro Mountain is byte-identical
  (`tests/src/micro-swell-isolation.test.js` pins masks 0, 1, ..., 1024 except 512 at e080803).
* **Spacing.** The 16 px point spacing is kept (`_segIndex`, `_yAtLocal`, hazard placement and `_flatAround` assume it).
  A 660 px period is ~41 points; even the old 220 px period was ~14 points with < 1 px chord error.
* **Data.** `TerrainModDef.terrainSwell` gains `taperPx` (`{amplitudePx, periodPx, taperPx}`); shipped dewSwell is
  20 / 660 / 165. The `schemas.js` typedef still lists only amplitudePx and periodPx (not on the T2 file list).
* **Tests and gate.** `tests/src/micro-swell.test.js` (heightAt == polyline, slopeDegAt == segment, continuity and
  bend at the edges, ~2A swing, taperPx read, determinism, spawns on the swelled ground, audit T2 copies).
  `biome-slot-rule.test.js` hashes its 00978f6 pin with the swell stripped (reproduces it exactly) and pins the ALL-mask
  digest of the shipped content separately. Built-game proof: a gate block (sd of sled.y - heightAt < 3 px on a
  `t2-probe@512` swell zone) is handed to the lead; it raises the expected counts by 1 in both modes.

## Addendum: Marvin decision 3 (biome unlocked / encountered / completed; additive)

Decision 3: "Biome discovery means actually encountering the biome; track unlocked, encountered, and completed separately."

- **Unlocked** is unchanged: the Sync Level unlock (`ProfileStore.unlockedBiomeIds`, from `pendingBiomes`).
- **Encountered:** the sled's x reached a sector `s` with `biomeForSector(seed, s, mask) === id`. The sector rule is the generator's own (`floor(x / ppm / SECTOR_M)`, the same as `_sectorOf` and BIOME_ENTER).
- **Completed:** the sled rode one of that biome's sectors from its start to its end (`SECTOR_M`, 500 m), and the run's crash is not inside that sector. Only the run-ending crash counts. A crash absorbed by a Hashed Backup, or an opening-grace recovery, does not void completion, because the run went on. Completed implies encountered.

**Detection** is the pure `BiomeDiscovery.detectBiomeVisits({seed, biomeMask, biomeDefs, furthestX, crashX, pxPerMeter})`, which returns `{encountered, completed}` in canonical `BIOME_IDS` order.
- The sled moves forward through sectors and a respawn never skips one, so every sector from 0 to `sectorOfX(furthestX)` was entered. Sector `s` was crossed to its end if and only if the furthest sector is past `s`.
- `BIOME_IDS` is a static list, pinned by a test to `src/data/biomes` and to `levels.json` `biomeOrder`. The sanitizer must not depend on the level table it is handed: the fallback table's empty `biomeOrder` would erase every encounter on the next save.

**Data flow.**
1. `RunScene.doCrash` calls `detectBiomeVisits`. Furthest x is `startX + ScoreManager furthest metres * PIXELS_PER_METER`, or the crash x if that is larger.
2. It emits `RUN_END { record, biomeVisits }`. `biomeVisits` is an additive `RunEndPayload` field, typed in events.js. It is never part of the RunRecord or `computeLedgerHash`.
3. `ProgressionService.onRunEnd` forwards it as `credit(record, { streak, biomeVisits })`.
4. `creditRun` merges it as a union into `profile.biomeProgress`. A replayed run is refused before the merge, so it records nothing.

**Profile.** `bb.profile` v1 gains `biomeProgress: { encountered: string[], completed: string[] }` (`defaultProfile`).
- The change is additive. `PROFILE_VERSION` and `STORAGE.saveVersion` are unchanged, and an old profile loads with empty sets.
- `sanitizeBiomeProgress` keeps known ids only, dedupes them, sorts them canonically and adds every completed id to encountered.

**Achievements.** `metricsFrom` gives `biomesDiscovered = max(extra.biomeCount, encountered count of the profile)`.
- `creditRun` still forwards no caller `biomeCount`, so only a real encounter can unlock biomes-2/5/11.
- Their rewards go through the existing `grantAchievementReward` path in the same credit, in decision 9 order.
- `AchievementsView` no longer passes `biomeDefs.length` (ACH-6), so the grid shows encountered / target.

**Views.**
- `biomeToggleRows` rows gain `encountered`, `completed` and `state` (`'locked'|'unlocked'|'encountered'|'completed'`, strongest fact first). A Daily plays the date's mask whatever is unlocked, so a locked biome can be encountered.
- `ProfileLayout.toggleLabel(row)` labels an unlocked row `NAME NEW|SEEN|DONE`, coloured text, cyan or lime. The widest label is 148 px, which fits the two-column band before the ON/OFF value.
- Locked names keep `LVL n` and get a separate `state-<id>` box (SEEN / DONE) when they were encountered.
- A `biome-progress` line (`BIOMES SEEN n/11 DONE m/11`) is right-aligned on the ACHIEVEMENTS summary row.

**No backfill from stored runs.** It would not be exact:
- `distanceM` is floored and the spawn is 44 px in, so one integer distance per sector boundary is ambiguous.
- The first-time backfill only runs on a profile with no runs.
- Absorbed crashes are not stored.

## Addendum: biome full treatment, B2 "Sight" (content + blind fairness rule; additive)

B2 ships Crystal Cavern's and Vertigo Vents' hazard and power-up (spec §4). It adds no new effect kind: `blind` and its
overlay came in B0, `ward` in B0/B1, `shield` is the base Hashed Backup kind. Mask 0 is byte-identical (golden `shape` /
`full` / `complete` unchanged): every def below carries a `biome` field.

| Biome (bit) | Hazard (file) | Hazard effect | Power-up (file) | Power-up effect |
|---|---|---|---|---|
| Crystal Cavern (16) | `shatterWall` (`shatter-wall.json`), ground 24x34, shape `shatterWall`, lime, chance 0.6 | `blind` 1200 ms, visibility 0.4, no crash | `crystalClearGoggles` (`crystal-clear-goggles.json`), shape `goggles`, cyan, chance 0.4 | `ward` effects `['blind', 'scramble']` 6 s |
| Vertigo Vents (1024) | `ashCloud` (`ash-cloud.json`), air 56x34 in jump arcs, shape `ashCloud`, amber, chance 0.75 | `blind` 1200 ms, visibility 0.4 | `heatShield` (`heat-shield.json`), shape `heatShield`, magenta, chance 0.25 | `shield`, 1 charge |

* Both blind hazards are non-crash, so they are drawn in their own colour (never `danger`), and RunScene's air telegraph,
  near-miss and hop hint (crash hazards only) ignore the Ash Cloud. Both draw through the bracketed `Hazard.draw` switch
  (corner brackets included), like any ground hazard, so a later telegraph needs no special case.
* "Air zone" (spec table) is the existing air pass: `ashCloud` is placed by `_placeBiomeSpawns` in a generated jump of a
  Vertigo sector (`isJump`), above the no-hop arc, like Seagull Dive. Vertigo's template chunks (valley-launch, ski-jump,
  big-air-drop) are spline chunks, not `isJump`, so they hold none.
* The Shatter Wall box fits a Garbage Data Vent, Overflow Firewall or Glitch Chasm box + `BIOME_REPLACE_SLACK_PX`, so the
  slot rule can swap it in.
* The Goggles ward's `effects` list switches off every `blind` and `scramble` hit (the base Garbage Data Vent's scramble
  included) and stops one that is already acting, through the B0 consumers: `onHazard` ignores the hit,
  `updateBlindOverlay` drops the overlay to 0, and `sled.scrambled` / `physicsContext.scrambled` read false.

**Blind fairness rule (`TerrainGenerator._biomeGroundAt`).** A biome ground def whose `onHit.effect` is `blind` needs no
crash hazard of its own chunk within `blindClearAheadPx(onHit, distM)` ahead: `(durationMs + BIOME_BLIND_REACT_MS 500)` at
`BIOME_BLIND_SPEED_MUL` (1.2) x `expectedSpeedPxS(distM)`. The replacement path checks it too (the swapped hazard is
skipped). `crashHazardIds` (constructor) lists every crash def id, base and biome. The pass cannot see the next chunk;
requiring the stretch to end inside the chunk cut Shatter Wall presence to about 4 %, so only the chunk's own hazards are
checked. Measured over 32 seeds x 300 chunks: without the rule 29 % of Shatter Walls had a crash hazard within the 1.2 s
blind at the expected speed; with it 2.9 % (22 of 771), all in the next chunk. Ash Cloud: 0 of 268. The rule binds only
`blind` defs: masks 1, 2, 8 and 64 keep their e080803 digests.

**Shield sources (`BiomeEffects`, B2).** The Heat Shield feeds the one `shieldCharges` pool. RunScene also keeps
`shieldSources`, one pickup id per charge (`addShieldSource`); a spent charge reports the most recent source
(`spendShieldSource`, LIFO), so `POWERUP_EXPIRED {reason: 'consumed'}` carries `heatShield` or `hashedBackup` (was always
`hashedBackup`, which left a Heat Shield chip on screen). A charge with no tracked source (the W4 shield boost) is the
Hashed Backup's (`SHIELD_DEFAULT_SOURCE`). `POWERUP_COLLECTED.charges` is `shieldChargesFor(sources, id, pool)`: the pool
minus the charges other tracked pickups own for the Hashed Backup (so a lone Backup and the Error Correction boost charge show as before), and only its own tracked charges for a biome shield. `shieldSources` is set
with `shieldCharges` at run start; a manual reset keeps both.

**HUD (`UIScene`).** `POWERUP_INFO` rows GOGGLES (cyan) and HEAT SHIELD (magenta) with their own `_drawIcon` glyphs;
`HAZARD_LABEL` names SHATTER WALL and ASH CLOUD on the blind warning line. `BiomeEffects.HAZARD_SHAPES` gains
`shatterWall`, `ashCloud`; `POWERUP_SHAPES` gains `goggles`, `heatShield`.

**Tests and gates.** `tests/src/biome-b2-content.test.js` (loader / schema, spec values, ward pairing, slot-rule fit,
shield-source helpers), `tests/src/biome-b2-effects.test.js` (shipped defs through the shipped RunScene / UIScene / Hazard /
PowerUp), `tests/src/biome-b2-presence.test.js` (presence, the fairness rule and its measured residue, determinism).
Changed pins: `data.test.js` lists the 6 + 6 biome defs; `biome-b1-content.test.js` counts only the B1 biomes' defs (the
total is pinned in the B2 file); `micro-swell-isolation.test.js` leaves B2-tagged defs out of its digest (B2 content is
meant to change masks 16 and 1024; nothing else moved). The built-game gate has 4 B2 checks on real `b2crystal13@16` and
`b2vertigo56@1024` runs (expected counts 45 -> 49 with boosts, 33 -> 37).

## Addendum: biome full treatment, B3 "Motion" (content + moving hazards + roll track rule; additive)

B3 ships Pyramid Peak's, Steampunk Slopes' and Micro Mountain's hazard and power-up (spec §4) and the two motion kinds
(`HazardDef.motion`, spec §5). Mask 0 is byte-identical (golden `shape` / `full` / `complete` unchanged): every def below
carries a `biome` field.

| Biome (bit) | Hazard (file) | Hazard | Power-up (file) | Power-up effect |
|---|---|---|---|---|
| Pyramid Peak (4) | `rollingBoulder` (`rolling-boulder.json`), ground 22x22, shape `boulder`, `danger`, chance 0.45 | `crash`; motion `roll` 140 px/s, range 160 px, dir -1 | `sandrunnerSkis` (`sandrunner-skis.json`), shape `skis`, amber, chance 0.4 | `glide` frictionMul 0.7, 4 s |
| Steampunk Slopes (256) | `gearGate` (`gear-gate.json`), ground 20x28, shape `gearGate`, `danger`, chance 0.45 | `crash` only while closed; motion `gate` period 1400 ms, open 900 ms | `clockworkTreads` (`clockwork-treads.json`), shape `treads`, cyan, chance 0.4 | `ward` mods `['conveyorBelt']` 4 s |
| Micro Mountain (512) | `dewDrop` (`dew-drop.json`), ground 18x16, shape `dewDrop`, `danger`, chance 0.45 | `crash`; motion `roll` 110 px/s, range 140 px, dir -1 | `royalJellyWax` (`royal-jelly-wax.json`), shape `jellyWax`, amber, chance 0.4 | `glide` frictionMul 0.7, 4 s (shared kind) |

**New data fields (optional, additive).** `HazardDef.motion`: `{kind: 'roll', speedPxS, rangePx?, dir?}` or
`{kind: 'gate', periodMs, openMs}`. `HazardSpawn.phase` (0..1): only on a Gear Gate spawn. The crash JSONs set
`colorKey: 'danger'` (RunScene's palette switch reads `def.colorKey` directly).

**`systems/HazardMotion.js` (pure; no Phaser, Math.random or Date).**
* Roll: `rollParams(motion)` (speed <= `ROLL_MAX_SPEED_PX_S` 200, range <= `ROLL_MAX_RANGE_PX` 200, `dir` -1 toward the
  sled / +1 downhill away), `rollSweep(motion)` (x span relative to the spawn: `{lo, hi}`), `rollOffsetAt(motion, msActive)`
  (signed, speed x time, clamped to the range), `emptyRollState()`, `rollStep(state, motion, x0, sledX, tMs)` (starts on the
  first step with `sledX >= x0 - ROLL_ACTIVATE_PX` (340); afterwards offset = rollOffsetAt(tMs - activeAtMs), so the frame
  rate never changes the position), `rollPredictX(state, motion, x0, tMs)`.
* Gate: `gateTiming(motion)` (open >= `GATE_MIN_OPEN_MS` 400, closed in [`GATE_MIN_CLOSED_MS` 100, `GATE_MAX_CLOSED_MS` 500]),
  `gateOpenAt(motion, phase, tMs)` (each cycle starts open), `gateNextChangeMs(motion, phase, tMs)`.
* `BiomeEffects.glideFriction(frictionMul, glideMul)`: the one place a glide changes friction; `PhysicsTuner.getEffective`
  calls it (was an inline multiply). Same numbers as before.

**Entity (`Hazard.js`).** A def with a `roll` or `gate` motion keeps every usual field and draws through the normal
`Hazard.draw` switch (corner brackets included). `update(timeMs, camLeft, camRight)` (signature unchanged) first calls
`stepMotion(timeMs, sledX?)` every frame, on or off camera, BEFORE its visibility early return:
* roll: `rollStep` with `scene.sled.x`; the sensor body (`Body.setPosition` / `setAngle`), the drawing and `cx` / `cy`
  move to `x0 + offset` on `scene.heightFn` (the generator's `heightAt`, i.e. the collider polyline, dew swell included) at
  `terrain.slopeDegAt`. `rolling`, `rollDir` and `spin` drive the drawing. `cx` tracks the moving box, so the hop hint,
  near-miss and the sim's hop policy see the real position.
* gate: `open` follows `gateOpenAt(motion, spawn.phase, run time)`; a flip redraws at once.
* New methods: `stepMotion`, `isPassable(tMs)` (true only for an open gate), and for a telegraph `predictX(tMs)` and
  `gateNextChangeMs(tMs)`. A telegraph needs, for a roll, `predictX` (it waits at `x0` until the sled is 340 px behind it,
  then moves toward the sled), and for a gate, `isPassable` / `gateNextChangeMs` at the sled's arrival time.

**RunScene.** One line at the top of `onHazard`: `if (h.isPassable && h.isPassable(this.runTimeMs)) return;` before
`h.hit` is set, so an open gate is passed and stays armed; `collisionactive` re-queues the contact, so a gate that closes
on an overlapping sled crashes it.

**Generator (`TerrainGenerator`).**
* Roll track rule (`_rollTrackClear`, called from `_biomeGroundAt`, so the slot-rule replacement inherits it): the whole
  `[x + sweep.lo, x + sweep.hi]` stays inside `BIOME_EDGE_MARGIN_PX`, off lip windows `[l.x - 40, zoneEnd]` and gaps +/- 96,
  `BIOME_HAZARD_CLEARANCE_PX` from every other hazard and 90 px from every power-up. The biome power-up slot keeps 90 px
  from a rolling hazard's whole track (`_trackDist`; equals `|q.x - x|` for every def without motion, so masks without a
  roll def are unchanged). A def with no x motion passes trivially.
* Gate phase: `biomeSpawn(def, x, y, rot, h3)` adds `phase` = the slot's 4th pre-drawn number (h3, drawn and unused by
  ground slots before B3). `BIOME_SLOT_DRAWS` stays 5; no stream moves.

**Presence (tests/src/biome-b3-presence.test.js).** Chunks 0-44, share of eligible biome chunks, 8 / 32 seeds: Rolling
Boulder 41.9 % / 35.4 %, Gear Gate 55.6 % / 39.5 %, Dew Drop 44.4 % / 37.2 %. Long range (4 seeds x 300 chunks): Rolling
Boulder 32.9 %, Gear Gate 36.1 %, Dew Drop 36.1 % of eligible chunks; Sandrunner Skis 35.4 %, Clockwork Treads 39.3 %,
Royal Jelly Wax 37.4 % of biome chunks.

**Fairness numbers (tests/src/biome-b3-presence.test.js).** Roll: starts with the sled 340 px away (B2's view probe:
>= 348 px of ground on screen ahead at any speed >= 100 px/s; the gate check confirms the hazard is inside `_view` at the
start); its range (160 / 140 px) is shorter than 340 px minus its width, so a sled stopped at the start line is never
reached. Hop window (sled underside above the crash box minus the closing pass) at the expected speed: Rolling Boulder
611-626 ms, Dew Drop 641-657 ms (1000-4000 m). Gate: closed spell 500 ms vs 560-878 ms on screen before reach at 1.2x the
expected speed (500-10000 m); open 900 ms vs a 71-116 ms crossing. A closed gate is also hop-clearable (28 px box, crash
box 22 px, hop apex ~72 px), like every ground hazard.

**HUD (`UIScene`).** `POWERUP_INFO` rows SANDRUNNER SKIS (amber), JELLY WAX (amber), CLOCKWORK TREADS (cyan) with their own
`_drawIcon` glyphs. `BiomeEffects.HAZARD_SHAPES` gains `boulder`, `dewDrop`, `gearGate`; `POWERUP_SHAPES` gains `skis`,
`jellyWax`, `treads`. Crash hazards end the run, so no `HAZARD_LABEL` rows.

**Tests and gates.** `tests/src/biome-b3-motion.test.js` (pure motion and glide math), `tests/src/biome-b3-content.test.js`
(loader / schema, spec values, motion blocks, ward and glide pairing), `tests/src/biome-b3-effects.test.js` (shipped defs
through the shipped Hazard motion, RunScene dispatch, UIScene and drawing; the Dew Drop rides the real dew swell
polyline), `tests/src/biome-b3-presence.test.js` (phase from the draw, roll track rule, presence, fairness numbers,
determinism). Changed pins (none re-pinned): `data.test.js` lists the 9 + 9 biome defs; `biome-b2-content.test.js` counts
only the B1 + B2 biomes' defs; `micro-swell-isolation.test.js` leaves B3-tagged defs out. The built-game gate has 6 B3
checks on real `b3pyramid54@4`, `b3steam63@256` and `b3micro26@512` runs (expected counts 49 -> 55 with boosts, 37 -> 43).

**Sim (B0 baseline `biomes-b0.json`, +/-15 %, git archive of f9f3f91).** Hop (48 seeds): mask 4 survival 18 -> 17 (-5.6 %),
distance -2.6 %, speed -0.1 %; mask 256 14 -> 15 (+7.1 %), +3.7 %, -0.5 %; mask 512 20 -> 17 (-15.0 %, at the line),
-1.5 %, -0.4 %. Mask 512 was already 17/48 (-15.0 %) on a fresh v2.9.0 run (T2 moved it): against v2.9.0, B3 leaves Micro
hop survival unchanged (17 -> 17), distance +1.6 %, speed +0.1 %. Flip distance +1.4 % / -6.8 % / -7.5 %, speed +0.5 % /
+0.1 % / +0.3 % (flip survival exempt). Crashes on the new hazards per 48 hop runs: Rolling Boulder 2, Gear Gate 2, Dew
Drop 1. At chance 0.5 the boulder took mask 4 hop survival to 15/48 (-16.7 %), hence 0.45.

## Addendum: readable chaos (fable-10x; additive)

### Phase 1: ground-hazard telegraph

* **Why**: measured on the built game, a ground hazard was first visible ~481 px ahead (camera geometry), a median 0.85 s
  (p10 0.67 s) before the sled reached it, the hop must be pressed ~0.38 s out, and every death is a hazard death. The only
  earlier warning was the first-run `SPACE HOP` hint. The air hazard already had `entities/AirTelegraph.js`.
* **`systems/HazardTelegraph.js`** (pure; no Phaser, clock or randomness):
  * `GROUND_WARN` (frozen): `leadS` 2.0, `minPx` 700, `maxPx` 1600 (1.33 s at 1200 px/s; terrain exists 3 screens = 1440 px ahead, so faster than ~720 px/s a hazard is announced when its chunk is generated),
    `hopLeadMs` 380 / `hopWindowMs` 250 / `minVxPxS` 60 (the hop oracle's numbers, `tools/sim/browser.js`), `maxMarks` 6,
    `warnGapMs` 220, `clearMarginPx` 60. UI timing, so it lives here and not in `TUNING`.
  * `hazardResponse(def)` -> `'hop'` (crash, or no `onHit`) | `'brace'` (any other effect) | `null` (air: not ours).
  * `warnDistancePx(speedPxS)` -> `clamp(speed x leadS, minPx, maxPx)`.
  * `inHopWindow(dx, vx)`: the oracle's rule, `hopLeadMs - hopWindowMs < dx / max(vx, 60) x 1000 <= hopLeadMs`.
  * `planTelegraph(hazards, sled, viewRight, {isMuted}?)` -> `TelegraphMark[]`, nearest first, at most `maxMarks`:
    `{ref, kind, state: 'warn'|'go'|'clear', color: 'danger'|'amber'|'lime', clear, dx, etaS, urgency, onScreen}`. Skips hit,
    passed, air and muted hazards. `go` (lime) only for a grounded sled inside the hop window. `clear` when airborne and
    the ballistic touchdown (`sled.landX`) is more than `clearMarginPx` past the box.
  * `TelegraphTracker.update(nowMs, marks)` -> events `{type: 'warn'|'go', kind, ref, sound}`: `warn` once per hazard at its
    first non-clear mark (`sound` false when another warn sounded under `warnGapMs` ago), `go` once when it first turns lime.
    `firstWarnMs(ref)`.
* **`entities/GroundTelegraph.js`** (drawing only; does not import Phaser): `update(timeMs, marks, view, zoom, heightAt)`,
  `setPalette`, `destroy`. Off-screen mark: a badge at `view.right - EDGE_INSET_PX / zoom` on the terrain line (glyph by
  `BiomeEffects.hazardDrawKind`, marching chevrons, proximity bar, response cue), stacked upward, at most `EDGE_MAX_STACK` (3).
  On-screen mark: a light column on the box (shortened to stay inside the view) with the cue on top. Cue shapes repeat the
  colour: open up-chevrons = hop, filled up-arrow = hop now, two bars = brace. Every size is game px (480 x 270) / zoom.
* **`RunScene`**: `updateGroundTelegraph(now)` is called from `updateFun` (live frames only) right after the air telegraph:
  it plans the marks (muting warded hazards via `Wards.isWarded` by id and by effect; `landX` from `sled.airEtaMs`), plays
  `groundWarn` (`opts.brace` for a brace hazard) / `hopCue`, stamps `hazard.teleAtMs` (read only by the measurement harness
  and the gate) and stores `_teleMarks`; `renderFrame` draws them after `_view` is computed (nothing while crashed).
  Nothing here reads into physics, terrain, score, the RunRecord or the ledger hash.
* **`AudioSynth`**: SFX `groundWarn` (hop: rising two notes; `opts.brace`: one soft low note) and `hopCue` (bright tick).
* **Tests**: `tests/src/hazard-telegraph.test.js` (pure rules, oracle agreement on a grid), `tests/src/hazard-telegraph-runscene.test.js`
  (the shipped `RunScene` methods on a prototype stub, the entity against a recording graphics fake, the sounds).

### Phase 1 on the biome hazards (rebased onto v2.10.0; additive)

* `hazardResponse` is unchanged: B3 Rolling Boulder / Dew Drop / Gear Gate -> `hop`; B1 Groomer Cat / Seaweed Tangle /
  Chocolate River (slow) and B2 Shatter Wall (blind) -> `brace`; Ash Cloud (air) -> `null`. `tests/src/hazard-telegraph-biomes.test.js`
  pins every shipped def in an explicit table.
* `GROUND_WARN` gains `arrivalHorizonMs` 4000, `arrivalStepMs` 20, `gateMarginMs` 150.
* `predictArrival(h, sled, nowMs)` -> `{etaMs, cxAtArrival}`: with `h.predictX` (Hazard, B3) and a run time, the centre at
  now + tau is `h.cx + predictX(now + tau) - predictX(now)`; the first tau where the sled (constant `max(vx, 60)`) reaches
  it, by 20 ms steps then bisection; `Infinity` past the horizon. Static (or no `predictX` / no `nowMs`): exactly `dx / vx`.
  No roll direction is assumed. Limit: `Hazard.predictX` holds a not-yet-started roll at its spawn x.
* `inHopWindowMs(etaMs)`: the oracle's window in time. `gateVerdict(h, arrivalMs)` -> `'open'` when `isPassable` holds at
  `arrivalMs - gateMarginMs` and `gateNextChangeMs` there exceeds `2 x gateMarginMs`, else `'closed'`; `null` without the
  gate API (or when `gateNextChangeMs` returns null).
* `planTelegraph(..., {isMuted, nowMs})`: marks gain `arrivalMs` (null without `nowMs`) and `gate`; `etaS` and the lime
  window come from `predictArrival`; `clear` compares `landX` with `cxAtArrival`; new state `'open'` (gate open at
  arrival: drawn dim with still chevrons, silent in `TelegraphTracker`, never lime). `RunScene.updateGroundTelegraph`
  passes `nowMs: runTimeMs` (the time base of `Hazard.stepMotion`).

### Phase 2: farther zoom-out at speed (supersedes the numbers in "Addendum: camera at speed")

* **`systems/CameraZoom.js`** (pure): `speedZoom(speedPxS, t = TUNING)` is the target zoom. Stage 1 is unchanged and still
  reads `TUNING.zoomMin` / `zoomSpeedLo` / `zoomSpeedHi` (1 -> 0.82 between 150 and 600 px/s). `ZOOM_STAGES` then eases
  (smoothstep) to 0.56 at 1000 px/s and to 0.47 at 1400 px/s (v2.6.0: one stage, 0.62 at 1200). `ZOOM_FLOOR` 0.45 is the
  hard clamp (was 0.6). `aheadPx(zoom, riderScreenX)` = `(GAME_WIDTH - riderScreenX) / zoom`. `TUNING` is not changed.
* **`RunScene.updateCamera`**: `zt = speedZoom(s.speed)`, clamp at `ZOOM_FLOOR`; easing (`TUNING.zoomLerp`), the 0.005 zoom
  step, the boost kick and the rider-keeps-its-screen-x pivot are as before. `ZOOM_FAR_MIN` / `ZOOM_FAR_SPEED_HI` are gone.
  New RunScene-local `LOOK_ULTRA_EXTRA_PX` 110 ramps in between 850 and 1300 px/s on top of `LOOK_FAR_EXTRA_PX`: the x
  follow (`cameraLerpX` 5.5 /s) lags `speed / 5.5` px, which left the rider ~130 px in at 1200 px/s. `RIDER_MIN_SCREEN_X`
  36 still bounds it.
* **Measured** (scratchpad `fable-10x/zoom-probe.cjs`, the shipped `updateCamera` at a steady speed over real terrain;
  before -> after): 650 px/s zoom 0.815 -> 0.81, 440 -> 442 px ahead, 0.68 s; 850: 0.745 -> 0.64, 512 -> 596 px, 0.60 -> 0.70 s;
  1000: 0.67 -> 0.56, 572 -> 736 px, 0.57 -> 0.74 s; 1200: 0.62 -> 0.515, 563 -> 862 px, 0.47 -> 0.72 s (rider at screen x 131 -> 36).
* **Still true at the new floor**: view width 480 / 0.45 = 1067 px, under the 3 generated screens (1440 px ahead of the
  sled); `applyZoomCompensation` counter-scales the background, flash and blind layers by exactly 1 / zoom (checked at
  0.565 on the built game); cull margins use the zoomed `_view`; sizes at 0.47: Packet Spike 9.4 game px, Glitch Chasm
  30, sled 19. The ground telegraph is drawn at a constant screen size, so it does not shrink with the view.
* **Tests**: `tests/src/camera-zoom.test.js` (curve identity below 600 px/s, anchors, monotone, floor, the shipped
  `updateCamera` settling on the curve, eased under hard acceleration, rider framing and pin).

## Addendum: readable chaos phase 3, death legibility (additive)

* **`systems/CrashReport.js`** (pure): `CRASH_BEAT` {slowMs 400, slowScale 0.25, hitStopScale 0.08, zoomIn 0.18};
  `killerName(cause, def)` (a crash def's `name`, else its id spaced and upper-cased; a non-crash def -> `'CRASH'`;
  causes `terrain` HEAD FIRST, `badLanding` BAD LANDING, `chasm` FELL INTO THE VOID); `hopTiming(lastHopMs, arrivalMs)`
  -> `{kind: 'none'|'early'|'late'|'onTime', s}` against `[arrival - hopLeadMs, + hopWindowMs]` (a hop over 1 s before
  the window is none); `verdictText`; `crashReport({runId, seed, biomeMask, cause, def, x, startX, pxPerMeter,
  lastHopMs, arrivalMs, crashMs})` -> `CrashReportData` `{runId, seed, biomeMask, x, distM, cause, hazardId, name,
  verdict, line}` (arrival falls back to crashMs); `crashBeat(msSinceCrash, hitStopMs)` -> `{fxScale, zoomMul}`;
  `deathMarkerX(lastCrash, seed, mask)`; `gameOverLine(lastCrash, rec)` (same run id and `cause: 'crash'` only).
* **`REG.LAST_CRASH`** (`constants.js`, additive): the last run-ending crash. Never in the RunRecord or the ledger hash.
* **`HazardTelegraph.TelegraphTracker.lastArrivalMs(ref)`**: latest finite planned arrival per hazard (clear / open marks too).
* **`RunScene`**: `onHazard` keeps the crashing entity in `_crashHazard` (`pendingCrash` keeps its `{cause, hazardId}`
  shape); the frame loop stamps `_lastHopMs` when a hop executes; `doCrash` calls `reportCrash(c, fs)` (an absorbed
  crash returns earlier in `resolveCrash`, so never reports); `renderFrame` scales FX by `crashBeat().fxScale` while
  crashed; `updateCamera` multiplies the zoom by `crashBeat().zoomMul` while crashed; `create` builds
  `entities/LastDeathMarker.js` (a BestMarker clone, `DIED HERE Nm`, lime `BEAT IT` once passed) when `deathMarkerX`
  matches. `CRASH_TO_GAMEOVER_MS` (950) is unchanged.
* **`UIScene.onCrash`**: the non-negated banner is `killerName(cause, content.hazards[hazardId])`.
* **`GameOverScene._buildHeader`**: `crashLine` (danger) from `gameOverLine`; y 42, or title scale 3 with rule y 33 / line y 43 when a rule line is shown.
* **Tests**: `crash-report`, `crash-legibility-runscene` (real create / onHazard / resolveCrash / doCrash), `crash-beat-runscene`, `crash-gameover`.
  Gate: 4 checks in the Readable Chaos block (66 -> 70 / 54 -> 58).

## Addendum: Micro Mountain glow-up (huge bees, Neon Sled Drone; additive, cosmetic only)

SledHEAD canon: Micro Mountain is the wild space Pete keeps for his bees, ridden as an RC micro sled drone. The
bees are ordinary bees, so next to the micro rider they are HUGE.

**Bees (`systems/MicroBees.js`, pure).**
* `beeLayout(seed)`: `BEE_COUNT` = 2 bees per `BEE_TILE` = 1800 px, from a seeded mulberry32.
* `beesAt(scrollX, timeMs, seed)`: the bees on screen. Parallax `BEE_PARALLAX` = 0.04 plus 7-14 px/s of their own;
  full height `BEE_HEIGHT` 0.3-0.4 of the screen; at most 2 visible; alpha fades at the screen edges.
* `beePrimitives(bees, depth)`: motifDecor-format primitives (palette keys, never `danger`; fills <=
  `BEE_MAX_FILL_ALPHA` 0.1, lines <= `BEE_MAX_LINE_ALPHA` 0.3; the `bg` stripes only darken), each tagged `bee: id`.
* `motifDecor(motif, scrollX, timeMs, seed, o = {})` gains an optional 5th argument. For `dew-drops` it appends
  the bees at the last silhouette layer's depth (over the moss and blades); `{bees: false}` leaves them out.
* `Background.bees` (default true) switches them and `Background.beeCount` is the number drawn last frame. The
  backdrop is one Graphics at depth -100, below the terrain (5), hazards (8), pickups (9) and sled (20).
* Zero gameplay effect: no generator, physics, presence or sim input; every digest is unchanged.

**Crystal Cavern harmonic lattice experiment (draft issue #256):** original bass/guitar/piano/other stems can feed a native 24-mode-per-stem chromatic sympathetic resonator (`crystallattice`), with original dry waveforms unmodified and a wet-only peak compressor. Ground uses user-liked 150%-default source-driven ringing; true physical airtime opens a separately controllable, high-frequency crystal-wet shimmer and longer wet feedback **independently from drum ducking**, and ducks source percussion; genuine noncrash touchdown swells source-fed crystal tails. Only a confidence-selected live bass-source FFT can trigger up to two short pitched glass tones; silence/noisy spectral ambiguity produces no fabricated note/chord. No new song clock, beat grid, MIDI melody replacement or source master changes. See `docs/music-review/20261123-crystal-cavern-harmonic-lattice.md`; **draft and unapproved for production merge**.

**Micro Mountain musical physics experiment (draft issue #254):** `src/systems/music/MicroBeeAudio.js` uses the same exact `beesAt(cam.scrollX,runTimeMs,Background.decorSeed)` points **after backdrop update** to produce at most two quiet stereo wing buzz voices, panned relative to the real rider's screen X. It never spawns bees or changes their visual location, and fades when no bees are on screen or outside Micro. Native `microbox` DSP in `MusicFXGraph` colors the **original** five instrument stems with a tiny 11/26-ms enclosed room (owner-liked provisional ground intensity 135% for all five); actual airborne state opens the enclosure, and real noncrash landing gives a bounded 320-ms physical plastic shake on the drums. `AudioSynth.setMicroBees` is read-only, the song transport/beat/MIDI vocals/game physics unchanged, and bee oscillators allocate lazily and are disposed on confirmed biome exit, menu transition and final teardown. See `docs/music-review/20261122-micro-mountain-box-and-bees.md`. This is a draft sound candidate, not owner-approved production audio.

**Neon Sled Drone (rider cosmetic).**
* Catalogue: `{id:'rider-drone', slot:'rider', price:0, unlockLevel:1, value:'drone', grant:'biome',
  biome:'micro-mountain', unlockText:'COMPLETE MICRO MOUNTAIN'}`. The `grant`, `biome` and `unlockText` fields are
  additive and mirrored in `data/cosmetics/cosmetics.json`.
* `isOwned`: a `grant:'biome'` item is owned when its id is in `unlocked.cosmetics` or its `biome` is in
  `biomeProgress.completed`. It is never owned through the price-0 level rule, and `purchase` refuses it.
* Grant: `creditRun` calls `grantBiomeCosmetics(base, next)` after merging `biomeVisits`. An item that the run made
  owned is written to `unlocked.cosmetics` through `grantAchievementReward`. It is reported in `awards.grants` and
  appended to `awards.achievements` after the decision-9-sorted defs, which is the Game Over toast list. A grant
  entry is `{id, kind:'cosmetic', grant:'biome', biome, slot, name, desc}`. It is never stamped into
  `profile.achievements`. A profile that completed Micro before this build owns the drone by its completion, so
  it gets no toast. No new profile field, no `PROFILE_VERSION` or `saveVersion` change, and nothing in the ledger.
* `resolveCosmetics` returns `riderShape` ('default' | a rider hue's `shape`). `COSMETIC_HUES.rider.drone` is
  `{color:'#8a7dff', shape:'drone'}`. The shape is resolved before the colourblind refusal, so under colourblind
  the drone is still drawn, with the hue refused, in the palette rider colour and palette keys.
* Sled: `_draw` calls `_drawRider` (the unchanged neon rider) or `_drawDrone`. The drone is a pod, a camera eye,
  rotor arms, rotor discs with a blade turning from sled time, and arm lights blinking out of phase every 250 ms.
  `lastRiderShape` and `drone` ({rotors, lights}) record the frame. `_buildBody` is unchanged, so the hitbox is
  the same.
* Shop: on the rider page, an unowned biome grant is `locked`, disabled, and reads its `unlockText`.

**Tests and gate.** `tests/src/micro-bees.test.js`, `tests/src/micro-drone-skin.test.js` and
`tests/src/micro-drone-draw.test.js`. `cosmetics-complete`'s `own()` helper earns a biome grant through a credited
completing run. The built-game gate adds 6 checks on `beegate0@512` (sector 2 is Micro, sector 3 base):
* bees drawn on Micro, behind the terrain, hazards, pickups and sled;
* none on a mask-0 run;
* the drone locked in the real shop;
* granted with the toast;
* EQUIP, then equipped;
* drawn by the next run's Sled.

Expected counts 58 -> 64 (with boosts) and 46 -> 52.


## Addendum: B3 tuning, felt glides and downhill rolls (Marvin's rulings 2026-11-15; additive)

Supersedes the B3 addendum's glide values, roll direction, roll speed model and the telegraph note on closing speed.
Mask 0 is byte-identical (golden digests untouched): every changed def carries a `biome` field.

**Glides are felt (`BiomeEffects.glideStrength`, `BiomeEffects.glideDrag`).** Ground friction is only about a quarter of
the sled's drag at cruise speed (groundResist ~48 px/s^2, frictionAir ~65, quadDrag ~69 at 480 px/s), so the old
friction-only x0.7 glide was hard to feel. `glideStrength(m)` = (1 - m) / (1 - GLIDE_MIN_FRICTION_MUL), 0 for no glide.
`glideDrag(frictionMul, glideMul, t = TUNING)` returns `{frictionMul, speedMul, quadMul}`: ground friction as before
(`glideFriction`), speedMul x (1 + `TUNING.glideSpeedLift` x s) (frictionAir / speedMul: the Packet Burst path) and
quadDrag x (1 - `TUNING.glideQuadCut` x s). `PhysicsTuner.getEffective` calls it; with no glide every output is exactly
the old one. TUNING gains `glideSpeedLift` 0.35 and `glideQuadCut` 0.35. No RunScene change: the strength comes from
the pickup's `frictionMul`, which RunScene already passes as `TunerContext.glideFrictionMul`.

| Pickup | effect | Flavour |
|---|---|---|
| Sandrunner Skis | `glide` frictionMul 0.3, 2 s (strength 0.875: speedMul x1.306, quadDrag x0.694) | short, punchy slick burst |
| Royal Jelly Wax | `glide` frictionMul 0.55, 5 s (strength 0.5625: speedMul x1.197, quadDrag x0.803) | longer, gentler glide |

**Rolls go downhill, away from the sled (`systems/HazardMotion.js`).**
* `rollParams(motion)`: `dir` defaults to +1 (downhill, +x); `speedPxS` is the roll's cap, clamped to
  `ROLL_MAX_SPEED_PX_S` 120 (under `TUNING.stallNudgeToPxS` 130). Shipped: Rolling Boulder cap 80 px/s, range 120 px;
  Dew Drop cap 75 px/s, range 120 px; both `dir: 1`.
* `rollTargetSpeed(motion, slopeDeg)` (new, pure): "fake but fun" slope-following speed. `ROLL_FLOOR_SHARE` 0.4 of the cap
  on flat or rising ground (it never stalls or rolls back), the cap from `ROLL_FULL_SLOPE_DEG` 20 down, linear between.
  The slope is read along the roll's direction.
* The speed starts at 0 when the roll starts and moves toward the target at `ROLL_ACCEL_PX_S2` 250. It is integrated
  (trapezoid) on a fixed `ROLL_STEP_MS` 10 ms grid counted from `activeAtMs`, so the position is a pure function of the
  run time since the start and the terrain; the frame rate never changes it.
* Signatures (additive: a new optional last argument `slopeFn`, x -> slope deg; missing = flat):
  `rollOffsetAt(motion, msActive, slopeFn?, x0?)`, `rollStep(state, motion, x0, sledX, tMs, slopeFn?)`,
  `rollPredictX(state, motion, x0, tMs, slopeFn?)`. `RollState` gains `vPxS` (signed x speed now) and the grid fields
  `simMs`, `simDist`, `simV`; `emptyRollState()` has them all at 0. A `tMs` earlier than the last grid point recomputes
  from the start. `rollSweep` is unchanged: `{lo: 0, hi: rangePx}` for `dir` +1.
* `Hazard.stepMotion` passes `terrain.slopeDegAt` (the surface it rides; y still follows `scene.heightFn`, the collider
  polyline with the Micro swell). `Hazard.predictX(tMs)` (signature unchanged) uses the same slope function.
* **Telegraph note (replaces the B3 one).** A roll waits at `x0` until the sled is 340 px behind it, then rolls
  downhill. Its current signed speed is `hazard.roll.vPxS`; **closing speed = sled speed - vPxS**, which is negative while
  a roll catches up a slower or stopped sled. `predictX(tMs)` integrates the same model forward.

**Placement (`TerrainGenerator._rollTrackClear`).** Unchanged except for one bound: the spawn keeps
`BIOME_EDGE_MARGIN_PX` (240), and the track (now `[x, x + range]`, downhill) must stay `ROLL_TRACK_EDGE_MARGIN_PX` (120,
new export, >= the spec §4 96 px) inside the chunk edges. A neighbour chunk's hazards sit >= 240 px inside its own edge,
so a track end is >= 360 px from them. The clearances from lips, gaps, other hazards (240) and power-ups (90) are the
same, with one addition: a sled landing from a lip gets the roll's whole range of ground before the track (lip window
`[l.x - 40, zoneEnd + range]`; the old uphill track had that for free, and without it the sim's hop runs landed on
boulders). The presence test now also checks the neighbour chunks' gaps and lips. Without the change the downhill track lost
placements near chunk ends (Rolling Boulder 32-seed presence 35.4 % -> 29.2 % at range 160).

**Sim (B0 baseline, +/-15 %, git archive of the rebased branch).** Hop (48 seeds): mask 4 18 -> 18 (0 %), distance -1.9 %;
mask 512 20 -> 17 (-15.0 %, unchanged from v2.10.0), -6.5 %; mask 256 15/48 unchanged. Flip distance -9.7 % / -4.2 %. At
Skis 2.5 s mask 4 fell to 15/48 and at a boulder cap of 100 px/s without the landing clearance to 14/48, hence 2 s and
80 px/s plus the `zoneEnd + range` lip window.

## Addendum: biome full treatment, B4 "Air" (content + low-gravity air-box rule; additive)

B4 ships Space Mountain's and Sky Jellyfish Mountain's hazard and power-up (spec §4). It adds no new effect kind: `gust`
and `stabilize` and their consumers came in B0 (`RunScene.onHazard` gust branch -> `BiomeEffects.gustImpulse` ->
`_addSledVelocity`; `onPowerUp` stabilize -> `resolveLanding` in `handleTricksAndLanding` and `stabilizeBounceMul` in
`physicsContext` -> `PhysicsTuner`). B4 verified that both are read on the real sled (built-game gate, below). Mask 0 is
byte-identical (golden `shape` / `full` / `complete` unchanged): every def below carries a `biome` field.

| Biome (bit) | Hazard (file) | Hazard effect | Power-up (file) | Power-up effect |
|---|---|---|---|---|
| Space Mountain (32) | `meteor` (`meteor.json`), name "Meteor", air 34x30 in jump arcs, shape `meteor`, danger, chance 0.75, minDistanceM 1000 | `crash` | `gravityStabilizer` (`gravity-stabilizer.json`), shape `gravStabilizer`, amber, chance 0.4 | `stabilize` +12 deg, 5 s |
| Sky Jellyfish Mountain (128) | `gustFront` (`gust-front.json`), name "Gust Front", air 64x40 in jump arcs, shape `gustFront`, cyan, chance 0.75 | `gust` impulsePxS [60, -150] (162 px/s, under the 180 cap) | `stabilizerRails` (`stabilizer-rails.json`), shape `stabRails`, lime, chance 0.3 | `stabilize` +12 deg, bounceMul 0.5, 5 s |

* Hazard defs carry an optional display `name` (additive; no schema change): Readable Chaos phase 3's
  `CrashReport.killerName` uses it, so a Meteor crash reads METEOR. A gust never queues a crash, so it is never the killer:
  whatever it pushes the sled into is (`biome-b4-effects.test.js`, gate).
* Both hazards use the existing air pass (`_placeBiomeSpawns`, generated jumps only, above the no-hop arc), like Seagull
  Dive and Ash Cloud. The Meteor is a crash hazard, so RunScene's `AirTelegraph` marks its lip (STAY LOW) and the
  near-miss rules apply; the Gust Front (no crash) is skipped by both and is read from its own drawing: a pale zone with
  wind streaks and an arrowhead pointing along its impulse.
* The Meteor is drawn around its box centre with a halo (like the seagull, no corner brackets); the Gust Front through the
  bracketed `Hazard.draw` switch.

**Low-gravity air-box rule (`TerrainGenerator.flightGravityMul`).** `_arcY` models a flight at the base gravity.
`flightGravityMul(zones, modMap, x0, x1)` is the product of every `gravityMul < 1` of the chunk zones overlapping the
flight `[lip.x, lip.landX]` (1 with none; `gravityMul > 1` counts as 1). The biome air path divides `hiMul` by its square
root, which is the same as running the clearance arc at that gravity, so the box keeps `AIR_CLEARANCE_PX` over the flatter
arcs under a lowGravity zone. Only the biome air path uses it (the base `'air'` pass is untouched); in shipped content only
Space Mountain's own `lowGravity` (x0.7) triggers it, and masks 2 and 1024 keep their T2 isolation digests. Measured on the
real sled before the rule: a hands-off flight at 1.3x the expected speed hit the Meteor in 2 of 26 cases, both under
lowGravity; after: 0 of 43 at 1x, 1.3x and 1.5x (10 seeds).

**HUD (`UIScene`).** `POWERUP_INFO` rows GRAV STABILIZER (amber) and STABILIZER RAILS (lime) with their own `_drawIcon`
glyphs; `HAZARD_LABEL.gustFront` names GUST FRONT on the gust warning line. `BiomeEffects.HAZARD_SHAPES` gains `meteor`,
`gustFront`; `POWERUP_SHAPES` gains `gravStabilizer`, `stabRails`. Taking one stabilizer while the other runs replaces
it (the first chip expires `replaced`, the B0 rule).

**Known limit: the bouncySpring bounce is not felt.** Measured on the real sled in the built game: a drop onto a
bouncySpring zone (restitution 0.0722) rebounds 0-16 px/s with 0-1 airborne frames, the same as ordinary ground (0.02);
the probe sees a bounce at restitution 0.26 (77-95 px/s, 9-11 airborne frames). No bounce pad ever falls inside a
bouncySpring zone (0 of 45 pads, 16 seeds), so the zone's `max(1, bounceMul)` pad boost never applies either. The Rails'
bounceMul 0.5 does cut the body restitution to 0.018 (gate-checked), but the felt counter is the landing tolerance.

**Tests and gates.** `tests/src/biome-b4-content.test.js` (loader / schema, spec values, counter pairing, 11 + 11 biome defs,
one of each per biome), `tests/src/biome-b4-effects.test.js` (shipped defs through RunScene / UIScene / Hazard / PowerUp,
gust never the killer), `tests/src/biome-b4-presence.test.js` (presence, `flightGravityMul`, the lift, determinism).
Changed pins: `data.test.js` lists the 11 + 11 biome defs; `biome-b3-content.test.js` counts only the B1-B3 biomes' defs;
`hazard-telegraph-biomes.test.js` classifies both new air hazards (null: AirTelegraph); `micro-swell-isolation.test.js`
leaves B4-tagged defs out of its digest. The built-game gate has 5 B4 checks at the end, on real `b4space15@32` and
`b4jelly54@128` runs (expected counts 70 -> 75 with boosts, 58 -> 63): meteor crash named METEOR; meteor STAY LOW mark
before the lip plus a hands-off ride under it; gust impulse on the real body, never the killer; each stabilizer saves a
real landing (same seed, pose, tilt input and frames: about 81 deg crashes without, sloppy with); Rails cut the
bouncySpring touchdown restitution.

## Addendum: decision 5, the Daily rotation cutover

`DailyPatch.biomeMaskForDate` is a pure function of the UTC day, with two cycles split at `DailyPatch.CUTOVER_DATE_KEY` (`2026-11-17`).
- **Before the cutover:** the original 9-day cycle `[0,0,0,0,1,2,4,8,16]`, indexed by the epoch day. Every past date's mask is unchanged.
- **From the cutover:** a 15-day cycle `[32,0,64,0,128,0,256,0,512,1024,1,2,4,8,16]`, indexed by days since the cutover.

`infoForDateKey` and the DAILY RUN button go through the same function, so the official check on a record still compares it against the mask its own date had. Changing the rotation again means a new cutover date. Never edit a cycle in place, or past dates change mask.


## v2.16 in-progress: BSOD gameplay authority / audio handoff

RunScene owns a pure BsodPursuit controller and emits EVT.BSOD_STATE_CHANGED on the global
scene.game.events emitter after physics substeps are resolved. ONE payload object per event,
with no audio callback or dependency from simulation. BSOD collision is from the
wall's leading/rightmost edge X to the compound Matter sled body's bounds.min.x;
signed gapPx = sledLeftEdgeX - wallX, zero = contact. World X is increasing forward.
The wall advances during each bounded <=8ms Matter step; it ignores shields and
opening/invulnerability grace. Deactivation emits a full inactive payload on run
termination/teardown. timeToImpactMs is a closing-speed estimate, never a death timer.

Payload: active, gapPx, wallSpeedPxS, worldTailwindPxS, sledVelocityXPxS,
relativeAirX, proximity01, timeToImpactMs, atmosphereDensity. Space Mountain
forces atmosphereDensity 0 and zero wind, although the wall still collides.
The player sees a camera easing toward the approaching BSOD and a wind-direction pom-pom.
The audio/music team should subscribe read-only; their setSpeed() music-intensity
contract remains untouched. Physically applying the new wind to parachute/airbrake
and balancing infinite high-risk flights are separate follow-up stages.

Settings: windEnabled default true is additive to already-shipped windVolume. Controls branch
owns SaveStore persistence and SettingsView toggle; music team owns consumption in
AudioSynth, so do not claim muting is functional before its audio-side change lands.

## v2.16 in-progress: atmospheric effects (separate gameplay slice)

Sled.applyControls accepts an optional authoritative BSOD state snapshot. A pure
BsodAerodynamics module applies signed wind-driven canopy propulsion, mild canopy
lift and speed-dependent airbrake lift. PHYSICS.parachuteDurationMs is 880ms,
consumed only while held airborne, preserved between releases and refilled on
landing or externally launched new flight. PhysicsTuner gates parachute and
airbrake gravity effects by atmospheric density; Space Mountain nulls both.
These numerical coefficients are provisional pending arcade playtesting.
No music source or audio rendering has been modified.

## v2.16 in-progress: asymmetric landings / predictable flip speed

TrickTracker.classifyLanding now accepts pitch bands [-22,+12] perfect,
[-38,+28] good and [-65,+55] sloppy (hard impacts still crash).
Numeric helicopter phase is graded independently at 40/75/120 degrees;
a backwards touchdown beyond 120 is a crash. The boolean legacy
midSpin indicator retains its original one-grade penalty contract for
older callers. Airborne tilt follows a 680deg/s target at 1300deg/s^2
rather than accumulating acceleration all the way to the old 900deg/s cap.
Values require player feel and high-speed replay validation.

## v2.16 in progress: Trick Deck control layouts (2026-11-18)

Saved `controlLayout` defaults to `tricksRight`; alternatives `tricksLeft`,
`classic`. Keyboard remapping is applied by InputRouter **only while
runActive**. Logical INPUT_ACTION events (up/down/left/right, N shortcut,
pause/cancel/confirm) remain unchanged in all menus. Layout changes release
stale held keyboard buttons before rebinding; touch overlays replace unused
push and reverse-helicopter controls with divebomb/corkscrew in Trick Deck,
but Classic retains the original overlay. No gamepad remapping yet.

Default Tricks Right: ArrowUp frontflip, ArrowDown backflip, ArrowRight
helicopter, ArrowLeft corkscrew; W parachute, A airbrake (ground brake),
S divebomb, D tuck; Space hop. Tricks Left swaps WASD and arrows by role.
Classic retains original WASD/arrow mapping. Corkscrew is a **separately
tracked compound yaw+pitch trick**, not a renamed reverse helicopter;
rotation is charged to corkscrew without simultaneous free flip/heli score.
Corkscrew earns its own 135-point base trick but does not increment the established
x2 maximum combo multiplier, preserving existing mission/achievement math.

Airborne Space hop: held input retains preexisting maximum ascent, releasing
it truncates the *player's own* launch only after 150ms of effective hold,
with no artificial taller maximum; spring/geyser launches must not be
truncated by releasing Space. New layouts disable legacy auto-stall-nudge
and manual push; airbrake is the grounded brake. Divebomb adds downward
velocity acceleration without reducing horizontal speed at baseline;
initial numeric tuning is provisional. RunScene owns gameplay state and
Settings controls; audio files belong to Music Friday's separate branch.

## 2026-11-18 — Wind pom-pom attachment correction

The pom-pom tether's world anchor is authored by `Sled._drawRider` using
the **actual helmet crown transform**, including Matter body angle,
body-to-draw origin, pose lean, squash and helicopter perspective.
Drone cosmetics attach to the transformed rotor mast instead. RunScene draws
the wind indicator from `sled.windPomAnchor` and removes it when the rider
is hidden; using an arbitrary offset from `sled.x/y` (Matter COM) was incorrect.
This is a visual/accessibility fix only: physical BSOD wind and audio stay
authoritative and unchanged.

## 2026-11-18 — Bitstream Bluffing scoring (feature branch, initial tune)

A pure BsodBluffTracker observes actual post-physics collision-edge gap,
closing direction, airborne state, BSOD tailwind and canopy. An attempt arms
inside 280px **only while the wall closes**. It awards a *single* bonus after
the rider survives and opens >=850px separation while airborne, having deployed
the canopy in positive atmospheric BSOD wind. Contact/collision, grounding,
stale snapshots and non-canopy escapes cannot score. Multiple close/escape
cycles within one airtime streak form **SURFING THE VOID**; landing breaks the
streak. Repeated awards require real world-X travel and elapsed time.
The initial award is 150 points, +75 per chain step, +40 for use of airbrake
during the dangerous approach, capped at 850 points per successful escape.
All numerical thresholds are candidates for human playtesting.

RunScene emits additive EVT.BSOD_BLUFF for the distinct mechanic AND the
established EVT.NEAR_MISS exactly once per scored escape, so the existing
ScoreManager bonus, missions, achievements, XP and HUD accounting stay aligned.
Music and physical BSOD pursuit code are unchanged; no artificial BSOD
unbeatable timer is introduced.

## 2026-11-18 — Permanent softcapped upgrades (feature branch, first-playtest parameters)

**Ownership/provenance:** Marvin established unlimited permanent purchases with
diminishing physical returns, stronger high-level riders, opt-in MODDED
competition and a BSOD which continues accelerating without a forced-death
timer. Friday chose the initial numerical cost/softcap curves and seven
catalogue IDs for playtesting; these are not permanently frozen owner decisions.

- Open **PROFILE → SHARD SHOP → PERMANENT UPGRADES**. The single-panel shop
  changes to a seven-row permanent catalog, with bank, rank/next-price and
  UPGRADE MODE ON/OFF. No extra Title row or independently overlaid text layer.
  Upgrades are purchased using existing credited Data Shards in the bank.
- `PermanentUpgrades.js` is the pure source for prices, validation, ranks,
  opt-in loadouts and physical benefit curves. An unlimited sequence of ranks
  has softcapped effect `cap * rank / (rank + k)` and an increasing next
  price `ceil(base + scale*rank*(1 + rank/12))`. No hard preset tier cap.
  Ranks, funds and toggle are persisted in the existing `bb.profile`
  object, without discarding old profile fields or changing W1 crediting.
  ProfileStore.buyUpgrade performs an atomic charge/persist transaction,
  failing without a debit when storage cannot commit. Default mode is OFF.
- First-playtest seven tracks: Race Speed (max +30% speed multiplier),
  Hop Height (+22% initial normal impulse), Flip Control (+33% target speed
  and acceleration), Parachute Fuel (+70% reservoir), Airbrake Lift (+55%
  BSOD aerodynamic lift), Divebomb Power (+48% downward impulse),
  BSOD Head Start (up to 25% reduction in wall acceleration). Finite
  asymptotes do not make permanent infinite flight free; the wall never
  stops accelerating.
- RunScene snapshots enabled ranks *once* at run start. In official Daily,
  all purchased upgrades are ignored regardless of toggle. In ordinary
  runs, if mode is ON and any rank exists, the run is MODDED (clean rankings
  excluded through the preexisting Ranking.js contract). Run records with
  upgrades carry `hashV:3` and a canonical `upgradeRanks` snapshot; the
  digest includes prior v2 gameplay/result fields AND all equipped ranks.
  Unupgraded runs remain v2, and the extra fields never appear on those.
- PhysicsTuner applies the speed and hop/flip/divebomb/airbrake multipliers;
  Sled manages its upgraded 880ms canopy reservoir, and BsodPursuit receives
  a run-start reduction in acceleration. Nothing reads audio to decide
  physics or permits upgrades to modify the official Daily.
- Validation gates: model tests for monotonic softcaps, atomic purchases,
  reloads/failed writes, unmodified legacy hashes, v3 tampering, mixed
  shop layout, and run-scene behavior; real Chromium shop purchase and
  physical run application tested; still requires gameplay feel/balance
  and sound checks before a merge into main.

## 2026-11-18 — Balance probe adjustment (feature branch only)

The real game's ten hands-off and ten scripted-hop seed sims generated 109
airborne phases: median around 0.75-0.85 s, longest 1.583 s, zero longer than
3 s. The optimistic pure-flight BSOD near-miss envelope (18 synthetic cases
at wall speed 300/600/900 and rank 0/10/30) produced **zero** accepted
bluffs under the first 280->850px requirement. These are diagnostics, not
human-playtest statistics. The first-pass force model also capped airbrake
lift near 215 px/s² versus baseline gravity of 900 px/s², so it could
not satisfy Marvin's meaningful upward airbrake requirement.

The revised experimental curve increases BSOD tailwind compression to
600px/s, creates a short near-wall sail impulse from the *relative* airflow
(`180+1400*proximity^4` times signed tanh(flow/420), times low-speed sail
efficiency), and converts the airbrake's separately paid horizontal-speed
loss to materially stronger upward lift (`1250*tanh(|vx|/450)`). A stopped
rider gets zero airbrake lift; airbrake cannot hover forever without losing
speed. The bluff detector now requires opening at least to 500px and a
net gain of >=170px from its closest sampled wall gap, while still needing
an observed closing approach, positive actual tailwind canopy use and
survival in-air. All values are unapproved first-playtest tuning.

## 2026-11-18 — Balance iteration 2 (verified feature-branch tuning)

**Observed, source-grounded limitation:** The first optimistic 18-case BSOD
airflow envelope looked promising after adjustment, but the real Matter
simulation showed a 600 px/s wall was still effectively impossible to bluff
after friction/drag. This is why a reduced-order test must NOT be reported
as a real-game success rate. The original scripted-hop generation of ten
seeds generated 92 real airborne phases; their longest was 1.583 s.

**Current implementation, all first-playtest values:** After staged
real-Matter tests, the near-wall compressed tailwind remains 600 px/s at
zero gap (tapered as gap grows); canopy sail factor
`0.30 + 0.70/(1+(|vx|/520)^2)`; signed canopy acceleration
`(180 + 2800*proximity01^4)*tanh(relativeAirX/420)*sailFactor`.
Wind velocity matching still causes zero thrust, a headwind slows the
rider, and a stalled rider presents more sail than a racer.
The airbrake keeps `1250*tanh(|vx|/450)` upward-force
coupling, with real horizontal speed loss from Sled's existing airbrake.
No stationary hover, no vacuum aerodynamics, no hard wall-speed cap.

Bluffing now requires a **real observed closing wall** within 280 px,
a parachute in positive actual tailwind and a genuine escape to >=450 px
AND >=170 px recovery from minimum gap, still airborne and alive.
No proximity-only or per-frame score farming. This is **not** a claim that
sustained same-flight Surfing the Void is easy or infinitely viable.

**Validation evidence:** The reduced-order pure envelope tests now use
a delayed canopy deployment, not magic sail power at the initial state;
all 18 favorable scripted cases score, but these exclude drag and
terrain and are NOT statistical success rates. The source tests
also explicitly reject a late BSOD already far faster than a plausible
rider. More importantly, a live Chromium Matter step test starts only
the initial position/velocity and the chase edge; real physics then
produces a 300 px/s physical bluff and, with 160 ms airbrake timing,
a 600 px/s wall bluff in baseline and staged level-30 physics;
real wall advancement, canopy fuel, upward speed-paid airbrake,
ground collision and score events were not injected or faked.
The timing probe must *observe closing* before opening the canopy.
The near-miss thresholds, coefficient curves, human execution and
audio mix still require Marvin's playtest/approval.

## 2026-11-18 — high-tier earned canopy re-pressurization (provisional)

A seven-setup **real Matter** autopilot without refills earned six single
Bluffs and zero same-flight double Bluffs, mostly because the second
approach ran out of its single shared parachute fuel tank. Controlled
diagnostics with a hypothetical 50–100% *post-success* recovery yielded
five successful same-flight doubles out of eight selected test setups,
including rank-30 and rank-100 flight. These are **staged autopilot**
observations, not representative human success probabilities. A still-faster
900px/s wall wiped out the staged rank-100 attempt; recovery did not
automatically guarantee indefinite survival.

The first implementation adds an **opt-in MODDED high-tier canopy milestone**
at rank 12: each genuinely scored BSOD Bluff can recover spent parachute
fuel, with initial `0.74*(rank-11)/(rank-9)/sqrt(chain)` of the
per-flight upgraded reservoir (then clamped to the full tank).
This milestone does not change clean runs or Daily mode, does not
grant infinite fuel merely by holding a button, and never triggers on
landing, collision, non-scoring proximity, or ordinary unearned trick events.
A HUD strip announces positive recovery separately from the near-miss
points. Numeric threshold and formula are **Friday balancing proposals,
not owner-frozen values**, pending successful real-Matter chain regression
and Marvin's playtest.


## 2026-11-18 — Marvin approves earned canopy recharge (design decision)

**Owner decision:** Marvin explicitly replied, "I like the fuel mechanic -
great idea!" to the demonstrated high-tier perk. The underlying mechanism
(successful close BSOD escapes earn partial canopy replenishment, permitting
repeated Surfing the Void attempts, with diminishing recovery per chain) is
accepted. **Not frozen by Marvin:** 12 as the unlock rank, exact 0.74
coefficient, 2-rank smoothing, purchase prices, and HUD copy are Gal Friday's
first-playtest balance proposals.

**Verified implementation:** The feature-branch code uses an actual
successful BSOD_BLUFF event to replenish only the equipped, enabled,
high-tier canopy tank. The Shard Shop now advertises the unlock at
CANOPY R12 and confirms when reached, rather than hiding the perk.
All tests and build checks: 134/134 source suites and 2236/2236 source
tests, plus targeted post-shop-edit layout tests, final Vite build,
seven deterministic true-Matter staged flight scenarios, physical
BSOD and relative-wind Chromium tests, WebAudio BSOD corruption,
continuous music, Music Lab, and upgrade-purchase browser checks.
A rank-30 and rank-100 selected pilot each earned two genuine Bluffs
in the same flight with NO injected in-flight fuel; the 900px/s wall
still defeated rank 100. Real player control timing remains untested.
The existing camera was validated from 300 to 2500px/s and needed no
source changes.


## 2026-11-18 — Hidden Surfing the Void, BSOD Gym discovery, and Space Mountain proposal

**Owner design decisions:** Marvin explicitly requested that Surfing the Void and
the ability to bluff the BSOD remain **secret**, without anticipatory tutorials,
streak popups, advance shop spoilers, or exposed controls. Valley-stall recovery
hints may explain how to hop and catch a tailwind; the BSOD and its tailwind can
be mentioned generally. After the *first real successful Bluff*, a one-time
toast can reveal a locked purchasable **BSOD Gym** item in the store. The Gym
should allow low-stakes practice without changing real progression.

**Implemented only on this feature branch (assistant engineering choices):**
- Removed the every-Bluff `SURFING THE VOID xN` announcement and the
  `CANOPY +NMS` streak popup. Only the first genuine scored BSOD escape
  displays `BITSTREAM BLUFF` and `BSOD GYM DISCOVERED`. Subsequent BSOD escapes earn points silently, with no repeat popup.
  Ordinary non-BSOD near misses still use the generic `NEAR MISS` label. Music and physical
  chase events remain unchanged.
- Removed the explanatory pre-discovery rank-12 fuel mechanic row from the
  Shard Shop. Before discovery, no BSOD Gym row exists. Once discovered,
  the existing **SHARD SHOP → PERMANENT UPGRADES** page reveals `BSOD GYM`
  with `LOCKED 200` (initial *assistant-proposed* price). A one-time atomic
  purchase changes that row to `ENTER`. ProfileStore persists
  `bsodGym:{discovered,owned}` with both flags default OFF. Discovery
  requires `RunScene.updateBsodBluff()` to emit a *legitimately scored*
  close escape; it is never awarded from proximity alone.
- Purchased Gym mode starts a separate practice session through the existing
  Title → RunScene route. It uses a calmer starting wall, a 1.5-second canopy
  reservoir, a special earned recharge, and **retry-on-collision** (the wall
  remains an actual catch). The entire mode is non-ranked: no real game-over
  record, XP, shards credited, leaderboard or profile progression; hitting
  the wall resets the challenge in-place. Gym entry requires an owned
  profile flag and always clears when starting a normal or Daily run.
  No scripted how-to instruction is displayed in the Gym.
- The standard stall hint now reads (Trick Deck Right) `STALLED? HOP + W SAIL`
  or (Tricks Left) `STALLED? HOP + UP SAIL`, with a generic touch/gamepad
  variant. It mentions *valley recovery* only, not Bluff timing, chains, or
  special events.

**Space Mountain discussion:** Marvin considered two possible design families:
(1) airless space with a little forward propulsion from Divebomb or Corkscrew;
(2) all tailwind from the BSOD pushing air through other biomes. Gal Friday's
engineering recommendation is **(1)**, retaining a true near-vacuum so the
BSOD pressure wave cannot make parachutes work where there is no atmosphere.
The initial *provisional* prototype uses a tiny **board-powered** vacuum-only
Divebomb impulse (+70 px/s² horizontally, +280 px/s² down); it trades remaining
altitude/time for modest forward purchase but creates **no atmospheric wind**.
Corkscrew remains an aerial rotation maneuver, not unexplained reactionless
vacuum translation. This numeric effect and the sci-fi mechanism are suggestions
for Marvin's playtest, **not a settled owner selection**.

The first Gym browser integration verified the pre-discovery absence, one real
Bluff unlocking the item, locked 200-shard purchase and persistent ownership,
and an authentic BSOD contact causing practice reset without changing the
saved run, bank, or lifetime stats. Music Friday's independent latest DSP
headroom corrections `6c1a2bd` and `e7a8698` were merged into a *separate*
integration worktree, not into this gameplay branch or main.


## 2026-11-18 — BSOD Gym playtest isolation and retry integrity

**Verified assistant QA finding, not a new owner request:** The first
BSOD Gym implementation correctly avoided `RUN_END`, persistent scores,
leaderboard entries and XP payout. However, Gym gameplay still emitted
normal `SCORE_CHANGED`, `TRICK`, `NEAR_MISS` and `SHARD_COLLECTED`
events, so `MissionsService._checkLive()` could display a completed
mission toast without the mission being banked. That was misleading in a
mode Marvin explicitly wanted to be low-stakes and consequence-free.

**Fix:** `RunScene` now announces `gym:true` on `RUN_START`;
`MissionsService` suppresses *only live mission evaluation* for the
Gym, and clears that suppression on abort/normal next run. All ordinary
run mission crediting and event contracts are unchanged. Each Gym
collision already respawned the rider rather than persisting a
`RunRecord`. Now it also resets local ScoreManager, TrickTracker, shard,
near-miss and combo counters and republishes a fresh score HUD. A new
attempt may immediately collect *new* distance points on the next
physics frame, which is correct. None of this modifies the profile.

**Practice UX:** The paused Gym uses a clearly labeled
`BSOD GYM // PRACTICE` panel with `UNLIMITED` retries,
`XP / SHARDS: NONE` and `NOT RANKED`. Its menu keeps
Resume/Restart/Settings/Quit, but hides leaderboard and run
share-code actions. Quitting clears the Gym registry flag; restarting
retains Gym mode. The normal pause menu and official Daily route
remain unchanged.

**Scope/provenance:** These are implementation QA repairs by
Gal Friday, preserving Marvin's approved *secret discovery and
consequence-free practice* concept. The exact 200-shard Gym price,
recovery coefficients and Space Mountain propulsion remain
provisional. Code was branched from the already tested combined
music/headroom-safe `ab029ac` baseline, not from `main`;
Music Friday's DSP source and other music features were not edited.


## 2026-11-18 — Astra review fixes and physically earned Gym discovery gate

**Source and decision provenance:** Marvin asked Control Friday to implement what
could be fixed after Astra Friday's independent, read-only review of
`581d2d2`. Astra independently identified a P1 audio/event exception leak and
P2 Gym retry HUD, trick, effects and score-origin problems. An additional
tutorial-history leak was noted by Control Friday. None of the work below
changes Marvin's intentional **hidden** Surfing the Void or BSOD Gym
discovery. Gym difficulty, the 200-shard trial price, rank-12 refill balance,
Space Mountain propulsion alternatives and musical mix decisions are *still
unapproved trial parameters*, not frozen owner preferences.

**Hardening implementation, new child branch `feature/astra-gym-safety-20261118`
off `581d2d2`:**

- RunScene's `publishBsodState` protects the authoritative simulation
  against *arbitrary* synchronous BSOD event observer exceptions; a bad
  listener cannot cancel the frame before `resolveCrash`. One diagnostic
  warning is recorded per run. `AudioSynth._onBsodState` independently catches
  mixer and wind AudioParam failures, so a failed DSP path does not block wind
  or other event listeners. No music source, stem mixing gain, BSOD danger,
  or physical chase coefficients were modified.
- `EVT.GYM_ATTEMPT_RESET` is a new **RunScene-owned, one-payload** event
  `{attempt: positive integer}`, emitted on each actual practice wall catch.
  UIScene consumes it to clear old shard/chain counters and displays,
  pending combos, stale HUD popups/strips, flow and warning effects, while
  preserving the audio and progression systems. The event is never fired
  for a normal or official Daily run.
- The common `RunScene.clearTemporaryEffects(reason)` is used by both
  ordinary manual respawns and Gym collisions. Slow, scramble, boost,
  slowdown, ward, blind, glide and stabilization states expire with HUD
  notifications. The cleanup also fixes manual respawn to use the actual
  boost ID rather than a hardcoded Packet Burst identifier.
- Gym retry clears `_airTricks`, landing/hop and chain clocks,
  contact/safe-ground samples and previous ScoreManager/TrickTracker
  values, so an old flight cannot contaminate a new landing. Each attempt
  has a `gymAttemptStartX` **score origin**, while the real physical terrain,
  sled and advancing BSOD stay in world coordinates; non-Gym scoring
  continues using `startX`.
- While playing Gym, normal tutorial-completion and tuck-hint-show counts
  can update ephemeral run state but are NOT saved to the ordinary
  first-run tutorial keys `bb.tutorialDone` or `bb.tuckShows`.
  Normal tutorial behavior is unchanged.
- Gym intentionally remains **loadout-faithful** for this playtest:
  current daily modifier, owned boosts and permanent upgrades continue
  applying as before. Astra's normalized-versus-faithful training mode
  is an **open owner choice**, not silently implemented.

**Evidence:** The complete source suite passed **135/135 suites and
2249/2249 tests**; the production Vite build succeeded. The existing
12-game/music Chromium workflows all passed, including true Matter
multi-Bluff scenarios, Gym isolation, wind and corrected musical BSOD DSP.
A new stress browser test stages genuine BSOD collision in both normal
and Gym modes with deliberately throwing WebAudio/third-party observers;
it verifies normal crash completion, two Gym retries, immediate HUD and
effect cleanup, no lost tutorial opportunities and no profile/ledger change.
A separate new physical-discovery browser test pilots a real Matter
airbrake/sail escape (staged initial flight, **not** fabricated near-miss
events), confirms it earned the initial scored Bluff after 88 scripted
frames, then RELOADS the browser and confirms the locked Shop item,
one-time 200-shard purchase and working low-stakes Gym.

**Limits:** The test scenarios stage flight starting conditions and do not
prove organic player discovery, play-feel, accessibility at extreme chase
speeds, full-song auditory quality, or fairness of the trial Gym price.
No human approval for these trial parameters is implied. Music Friday's
separate branch (including subsequent music-only updates) remains
untouched. `main` remains unmerged.


## 2026-11-18 — Marvin selects actual player upgrades in the Gym

**Direct owner decisions (Marvin, 2026-11-18):** The BSOD Gym should use
**the player's own upgrades**, not normalized gear. The initial **200-shard**
Gym purchase price is acceptable **for now**. The earned canopy recharge
balance sounds plausible but is **not frozen**; it still needs playtesting.
This resolves Astra Friday's open normalized-versus-player-equipment
question in favor of actual user equipment, with no more input needed.

**Gal Friday implementation, separate from those owner decisions:** The
existing `upgradeLoadoutForRun(profile)` continues to gate purchased
ranks behind Upgrade Mode; buying a rank does not turn that mode ON.
Physical speed, hop, flips, airbrake, divebomb and all other upgrade
multipliers were already used by the Gym's regular PhysicsTuner context.
However, Gym creation **overrode** two purchased benefits with fixed
practice values: canopyFuelFullMs = 1500 and wall acceleration = 0.65.
These now come from `gymChaseForLoadout(upgradeFx)`, preserving the
Gym's extra-forgiving *base* (1,500ms canopy, 0.65px/s² BSOD acceleration)
while applying the exact enabled Parachute Fuel multiplier and BSOD Head
Start acceleration reduction from the player's normal upgrade snapshot.
Both starting session and Gym contact retries use this same frozen
snapshot; none of this affects regular or official Daily run tuning.
This does **not** change the Gym's provisional extra recharge
(`0.68 * full / sqrt(chain)`) or the separate normal-run rank-12
earned refill. The price constant remains 200. No sound file, music
effect or UI spoiler text is touched.

**Verification (engineer-run, not owner human balance approval):** Pure
unit regressions assert default, bought-but-disabled, enabled ranks and
official Daily's clean loadout; invalid multipliers cannot cause a
zero-speed or infinite-fuel Gym. Chromium actual-run regressions inspect
the real initialized RunScene and subsequent real BSOD catch, with
independent profiles at no purchased ranks, purchased-but-disabled
ranks, enabled moderate ranks, and enabled high ranks. After catch the
Gym keeps those exact fuel and wall-acceleration coefficients, remains
non-ranked, and has no profile-bank, lifetime-stat, or run-record write.
The 200-shard Gym price is deliberately left subject to future playtest
judgment. Site instructional pages still reveal no Surfing the Void
instructions or pre-discovery Gym hint.


## 2026-11-18 — Pure recharge regression and bounded training economy

**No balancing values changed.** `gymRechargeMs(chain,fullFuelMs)` now owns
the existing Gym formula `0.68 * fullFuelMs / sqrt(chain)`, validating
finite positive fuel and safe integer chains. It always awards at most the
reservoir and strictly declines with greater chain length. Actual earned
fuel remains capped by the available remaining room in the tank.

**Deterministic baseline matrix (rounded milliseconds; first/second = first
and second successful scored BSOD Bluffs, not merely proximity):**

| Canopy rank (UPGRADE MODE ON) | Gym full tank | Gym refill 1 | Gym refill 2 | Normal-run refill 1 |
|---:|---:|---:|---:|---:|
| 0 | 1,500 | 1,020 | 721 | 0 |
| 11 | 1,962 | 1,334 | 943 | 0 |
| 12 | 1,985 | 1,350 | 954 | 287 |
| 30 | 2,216 | 1,507 | 1,065 | 870 |
| 80 | 2,394 | 1,628 | 1,151 | 1,010 |

**Interpretation:** Actual owned/equipped upgrades now matter in Gym.
The separate **practice-only recharge** deliberately allows repeat
practice even below the rank-12 normal-run earned-refill unlock.
Thus a successful Gym chain does not guarantee the same maneuver can
be sustained in a ranked run at low rank. Marvin said this balance
*seems okay* but has not approved final tuning. These computed data
and source unit gates are evidence for playtesting, **not** a reason
to alter the formula or reveal the hidden mechanic in public UI.


## 2026-11-18 — Optional musical timing for Gym READY/GO (design note, not yet enabled)

**Marvin's clarification:** By *downbeat* he means **on a regular musical
beat rather than on an upbeat/offbeat or syncopated subdivision**. He does
NOT mean the first beat of a measure/bar. After a Gym attempt is staged for
roughly one second, release on a real, reliable musical pulse when feasible;
do not wait for a bar boundary. This applies to first launch and retries.
This is an optional timing idea, not approval for arbitrary waiting, guessing
tempo, or changing music tracks.

**Actual source audit:** `StemMusicDirector.nextBeat()` and
`CaptionSequencer.nextBeatTime()` support the next *individual beat*
from the active audio transport's `AudioContext.currentTime`, but use
`pack.bpm`. As of 2026-11-18, **all four installed
`public/music/packs/*/pack.json` files omit validated `tempo`**;
`MusicPack` therefore normalizes BPM to `null`, and
`nextBeatTime()` falls back to current time. There is currently **no trusted quarter-note pulse phase or tempo**, so
invoking `nextBeat()` does *not* yield real musical synchronization for
the installed songs. Bar/meter/downbeat metadata may be useful elsewhere,
but **is not required for Marvin's on-beat-vs-offbeat release preference**.

**Recommended future metadata owned by Music Friday, not fabricated:**
Each validated recording/arrangement needs a reliable **pulse grid** with
source provenance and confidence: BPM plus measured on-beat phase, or
per-event beat markers for rubato/variable tempo. Meter, beat-one and
bar-markers are OPTIONAL enrichment; never infer those as prerequisites
or pretend that every on-beat event is a measure downbeat. Maintain
timings in the original recorded performance's sample/second
coordinates and translate through actual transport pause/resume,
seek, track switch, and `clockStart` to `AudioContext.currentTime`.
A manual listening/spot-check gate must reject dubious markers.
A confidence-labeled transport timing snapshot can then be offered
through a small public (not `_stemMusic` private) API to gameplay.

**Safety and feel rule, still a recommendation:** The one-second frozen
Gym release is authoritative and works with music muted, missing,
disabled, suspended, or changed mid-READY. Optionally select the next
*validated beat* after that minimum hold ONLY when the extra delay is
small (e.g. no more than 300ms); otherwise use the ordinary one-second
GO. Avoid offbeat/syncopated timing; do NOT wait for the next bar boundary,
which could keep the rider frozen for multiple extra seconds. Never couple
the gameplay clock or Matter step to audio scheduling, and never let
an exception or stalled audio block release. Test paused/silent and
low-confidence tracks, shuffled transitions, different BPMs, and an
honest long-wait fallback before enabling. Music-only animations/SFX
may synchronize even without delaying gameplay.


## 2026-11-18 — Gym setup menu interaction and shop page preservation

Gal Friday's post-integration browser QA exercised the **actual** MenuList
`left`/`right` and `confirm` actions on the earned advanced Gym setup screen,
not just calling individual setter callbacks directly. Selecting and reversing
a launch speed, changing the wall gap, exiting through both nested BACK rows,
reloading the page, and launching practice all passed. The setup values
persist through ProfileStore's already-atomic bounded configuration writes;
the bank is never charged for tuning.

The QA identified one minor UI bug: `ShopView._build()` used to assign
`layout.page` for any screen except Permanent Upgrades. The nested Gym setup
layout intentionally has no catalogue `page`, so opening it could overwrite
the previous regular Shop category selection with `undefined`. The view now
updates its saved page **only** when rendering the ordinary Shop layout.
The regression opens the Gym screen from catalogue category index 2, uses
both BACK actions, and verifies category 2 is preserved.

This changes **no** Gym physics, reward gating, unlock prerequisites,
recharge quantities or music release timing. The correct owner preference
for a potential music-aligned launch remains **on a regular beat, not on
an upbeat/offbeat or syncopated subdivision**, with a guaranteed fallback to
the existing one-second frozen READY/GO until trusted beat-grid metadata
is available.

## 2026-11-18 — Stronger Gym-only secret mastery regression

An expanded live-browser integration test now verifies the negative cases,
using the **real BSOD Bluff tracker and RunScene scoring path** (the fixture
controls the simulated proximity/canopy observations, not the unlock method).
Four scored airborne Bluffs, followed by a grounded update, do **not** unlock
setup. Four more airborne Bluffs after that landing still do **not** unlock it.
An in-place Gym collision/retry resets the chain again and stays locked. Only
five consecutive airborne scored escapes in the **next uninterrupted Gym
attempt** unlock setup once; the observed sequence is `1,2,3,4`, `1,2,3,4`,
`1,2,3,4,5`. The test then reloads the page, tunes all five bounded setup
options, and confirms forward-only pursuit with the saved wildest settings.

This is a deterministic browser integration regression for score origin and
unlock isolation. The independent **physical** controller result appears in
the next section; neither test yet establishes human control fairness.

## 2026-11-18 — Five uninterrupted Gym Bluffs proven with *real Matter physics*

The previous five-Bluff regression used actual `BsodBluffTracker` observations
but scripted the near-wall gap; that proved **correct gating**, not natural
playability. An additional Chromium `headlessStep` probe now controls **only
the rider's regular held AIRBRAKE and PARACHUTE buttons** based on the actual
post-physics BSOD gap (brake until 240px, sail until 460px). Once the default
Gym starts, it never teleports the rider, modifies wall position/speed, changes
gravity, injects Bluff events, or calls unlock methods. Normal finite canopy,
real near-wall wind, Matter collisions, score events, and earned rank-12+
canopy refills all remain active.

With the hidden advanced setup **locked**, the ordinary 460px gap / 240px/s
wall / 260px launch height / 280px/s launch velocity / -330px/s rise is
physically playable for five consecutive scored Bluffs by a scripted rider
with opt-in **Parachute Fuel rank 25 and Airbrake Lift rank 25** (other
permanent upgrade ranks zero). The validated trace scored chains 1 through
5 at 3.317, 8.817, 14.217, 19.600, and 24.717 seconds of the play clock.
No terrain landing, BSOD collision, retry or non-ranked persistence change
occurred; the *actual* fifth score unlocked the previously hidden setup.
See `tools/bsod-gym-real-five-flight-browser-smoke.mjs`, which asserts all
these conditions against the running browser game.

**Same-seed comparisons** on the frozen `gym-physical-probe-aero-25`
terrain found five with both ranks **24 and 25**, but only four with both
ranks **22 and 23**; these are results of one deterministic controller on
one course, not minimum required ranks. Earlier mixed-seed probes are NOT
valid rank comparisons. Rank 25 fuel alone reached only two before landing.
A clean/unupgraded rider reached one with this naive controller. This does **not** certify that rank 12 or a clean rider cannot
succeed with better driving, nor that human play will feel fair. Granting
pre-owned ranks is a **test fixture only**, not a shop cheat or gameplay
adjustment. Future playtests should evaluate upgrade accessibility, human
control timing, and whether the unlock is excessively prestigious.

**Upgrade cost caveat:** Under `PermanentUpgrades.nextUpgradePrice`,
buying both rank 25 tiers from zero costs 4,400 (canopy) + 3,594
(airbrake) = **7,994 shards**, plus the separate 200-shard Gym purchase.
The same-seed rank-24 success would cost **7,282 shards** for both tiers.
The browser fixture pregrants ranks for reproducibility; it does not prove
that the hidden setup is economically accessible or comfortable for humans.

### Alternative launch conditions tested, not adopted

Four **bounded**, test-only advanced launch fixtures were tried with canopy
rank 12 + airbrake rank 12, on the same frozen seed and with the same simple
controller. `gap / wall speed / height / speed / rise` in game px units:

- `trial12-fast`: 220 / 450 / 700 / 450 / -700: zero Bluffs, two catches
- `trial12-sprint`: 460 / 850 / 700 / 700 / -700: zero Bluffs, two catches
- `trial12-tall`: 680 / 450 / 1100 / 450 / -900: one Bluff, two catches
- `trial12-wild`: 220 / 850 / 1100 / 700 / -900: zero Bluffs, two catches

The normal default course yielded two scored Bluffs at rank 12 with this
controller, so none of these four was an evidence-backed improvement.
They do not establish impossibility for a better controller or human.
**No default or gameplay balancing values were changed.**

## 2026-11-18 — READY wall-clock integrity at low frame rates

The first Gym READY implementation subtracted `dt` (the **50ms capped
physics delta**) from the 1000ms hold. At 5 FPS, 200ms real frame intervals
were counted as only 50ms, stretching a one-second READY to four seconds.
That incorrectly coupled player-visible launch timing to the physics safety
clamp. The pure `advanceGymReadyMs` helper now subtracts the **actual
nonnegative finite Phaser frame delta** from the READY hold; Matter's 50ms
limit and all running-game physics are unchanged.

Unit tests cover slow, normal, invalid and overlong frames. Chromium
`tools/bsod-gym-ready-lowfps-browser-smoke.mjs` stages the owned Gym
and then a real BSOD-collision retry at 5 FPS: five 200ms frames release
each READY exactly once, without moving rider or wall or incrementing the
game clock. Physics resumes the next frame. This is *not* musical phase
synchronization and does not assume that Music Friday's beat API exists.

## 2026-11-18 — Public verified Gym music timing API (Music Friday feature)

`AudioSynth.getBeatTiming({maxWaitMs:300,expectedRevision:null})` returns an immutable
read-only source-recording pulse snapshot (`trusted:true`, `release:'on-beat'`,
`trackId`, `transportRevision`, `gridVersion`, `beatFrame`, `beatSeconds`,
`audioContextTime`, `dueAudioTime`, `waitMs`, `confidence`) **only** for a
verified quarter-note grid section in the actively playing WebAudio transport.
Otherwise it returns `{trusted:false,release:'immediate',reason}`; it must not
start, stop, seek, or pause the song or manipulate gameplay physics. Control
Friday's Gym timer owns the minimum 1000ms READY and may wait **at most 300ms
extra** for a returned, imminent verified regular pulse. Gameplay releases
normally after READY if timing is unavailable, muted, suspended, stale or
unverified. Before an optional beat-delayed release, check
`AudioSynth.isBeatTimingCurrent(snapshot)` and release regardless of the answer
(failure means *unsynchronized* GO, never more waiting). Changes of track,
seek, playback generation, pause, source decoding and AudioContext state
invalidate any previous pulse snapshot.

`src/systems/music/BeatGridTiming.js` implements strict frame-indexed and
section-aware validation, and `BeatGridCatalog.js` is currently explicitly
**unverified for all four released songs**. Machine onset candidates are
research only; no human-reviewed beat-phase grid is authorized yet. The legacy
`StemMusicDirector.nextBeat()` BPM/zero-phase helper must NOT be used for Gym.
Tests and Control handoff: `docs/MUSIC-GYM-VERIFIED-BEAT-TIMING-20261118.md`.

## 2026-11-18 — Music Friday's verified beat API integrated into BSOD Gym (isolated branch)

On `integration/gym-verified-beats-20261118`, the music-owned public interface
from commit `5325f5b` is cherry-picked without altering its beat grid validator,
production catalog, or the legacy BPM-only `nextBeat()` helper. **All four real
recording grids remain unverified**: normal Gym starts/releases after its
one-second real-time READY exactly as before.

The gameplay-owned READY state machine now queries
`audio.getBeatTiming({maxWaitMs:300})` **exactly once**, only after the minimum
READY has completed, and accepts only an internally consistent trusted pulse
with a finite positive `waitMs <= 300`, matching WebAudio clock timestamps and
a non-empty transport revision. Missing, muted, unavailable, uncertain,
malformed or throwing audio gives immediate GO. For a trusted pulse, the
single extra real-time Gym countdown freezes rider, pursuer, scores, timers and
run clock; there is no new Matter step or music-owned timer. At completion,
`audio.isBeatTimingCurrent(snapshot)` is evaluated for `onBeat` telemetry,
**never** as a condition on GO. Changes of track, seek, mute, pause, or stalled
AudioContext can invalidate that status; there is never a second lookup or
additional wait. The optional snapshot is cleared on collision retry, scene
shutdown, and successful release. Low-FPS READY logic and the five-Bluff Gym
mastery rule are unchanged.

The new Chromium `tools/bsod-gym-beat-release-browser-smoke.mjs` exercises the
real unverified production catalog, a trusted synthetic 200ms extra wait,
stale transport, throwing music, malicious 1200ms advice, and reset while
waiting. `tools/bsod-gym-real-audio-beat-browser-smoke.mjs` goes further:
actual original OGG playback through the real WebAudio clock, actual
`AudioSynth` public API, and actual frozen Gym READY/GO. It uses a test-only,
browser-injected **FAKE pulse grid** which is never committed to the release
catalog; success proves wiring and transport timing, **not musical verification**.
The music-side real-OGG smoke now also handles title music already playing
rather than accidentally toggling it off by clicking Play twice. Music Friday
retains ownership of real recording-specific beat certification.

### 2026-11-18 — Pause/resume invalidates optional beat wait

A real Phaser lifecycle regression exposed one edge case after verified-beat
integration: pausing inside the optional 0–300ms music window preserved a
now-stale music deadline across resume. `RunScene._onResume` now **discards**
any pending music snapshot and calls the existing one-shot GO release without
waiting, requerying or setting an `onBeat` flag. It deliberately does *not*
call the music validator on this invalidated snapshot. A pause during the
minimum 1000ms READY keeps its remaining time instead; quitting from a
pending beat wait cancels its snapshot during scene teardown.

`tools/bsod-gym-beat-lifecycle-browser-smoke.mjs` reproduces and guards these
three transitions in actual Chromium/Phaser scenes, asserting the wall,
player, run clock, scores and progression remain unchanged through the hold.
This is a gameplay-only lifecycle fix: Music Friday's public timing API,
production beat catalog and original audio assets remain untouched.

## 2026-11-18 — Manual pause turntable audio contract (Control-owned gameplay)

To support Marvin's approved descending-scratch Pause / mirrored-scratch
Resume feature, `RunScene.pauseRun()` now emits an additive
`EVT.GAME_PAUSE {runTimeMs,runId,reason:'manual',pauseToken,gym}` **once**
per explicit player pause. Duplicate calls before Phaser's queued scene
transition are ignored. `PauseScene.resume()` emits the matching
`EVT.GAME_RESUME` payload with the same token; `PauseScene.restart()` and
`quit()` instead emit `EVT.RUN_ABORT` with `reason:'restart'|'quit'`
and the token, never a synthetic `GAME_RESUME`. Real crashes and Gym
collision retries do not emit the manual pause signal.

This is a **gameplay event contract only**. The original soundtrack
transport, scratch DSP/samples, pause-menu jukebox override semantics,
volume/mute/accessibility behavior and audio anti-stacking are explicitly
**Music Friday-owned and not yet integrated**. Existing Gym one-second READY
and stale-beat invalidation are unchanged. Browser contract/regression:
`tools/manual-turntable-pause-gameplay-browser-smoke.mjs`. Full handoff:
`docs/TURNTABLE-MANUAL-PAUSE-GAMEPLAY-HANDOFF-20261118.md`.

Manual pause/resume/restart/quit scene transitions are also protected against
synchronous exceptions from audio/event observers; exceptions are logged and
scene navigation continues. Every subscriber should still catch its own
exceptions, since the EventEmitter may not deliver to later listeners after
one throws. The Chromium smoke injects intentional observer exceptions.

### 2026-11-18 — Vinyl merge compatibility: continuous soundtrack MUST survive death

Music Friday's vinyl worktree started from a commit predating the merged
continuous soundtrack/menu-shuffle integration. Its inherited `AudioSynth`
`RUN_END` / `RUN_ABORT` handlers call `stopMusic()`; that is NOT a vinyl
feature and MUST NOT replace the current integration's `_enterMenuMusic()`
handlers. A real OGG Chromium regression proves the unchanged song and
WebAudio clock anchor still advance through an actual fatal BSOD death:
`tools/manual-turntable-death-soundtrack-continuity-browser-smoke.mjs`.
When vinyl commits arrive, transplant only vinyl-specific code on top of
this up-to-date branch, retain all existing continuous-music behavior, and
run `tests/src/continuous-soundtrack-menu-shuffle.test.js` plus both vinyl
and Gym browser suites before any promotion.

### 2026-11-18 — Death-music count-in: AUTHORIZED to implement (supersedes hold)

Marvin wants the complete fatal-crash sequence: scratch, 1–3 silent musical
beats, four drum-only beats from the current recording, and full-band return.
The sequence **continues through an immediate retry** without blocking game
physics, score, initials, shop or scene transitions. Earlier in the day this
was approved as a design but held from implementation; Marvin's subsequent
explicit approval **supersedes that temporary hold**. As of the approval
update, the music implementation had **not yet appeared in the reviewed
branch**. Manual Pause/Resume vinyl effects are a separate, completed feature.
Do not confuse fatal crashes with shield-negated hits or in-place Gym resets;
never fake verified music pulses. Music Friday owns the audio feature,
Control owns the scene event contract and integration tests. No unauthorized
merge/deploy. Full provenance and musical validation rules:
`docs/MUSIC-DEATH-TURNTABLE-COUNT-IN-DESIGN-20261118.md`.

### 2026-11-18 — Combined turntable integration and exact resume readout

Music Friday's committed, continuity-safe vinyl implementation `8cc95fc`
was cherry-picked to the dedicated combined branch as `561f0dc`, based on
Control's `7605387` (manual pause tokens, real Escape-key lifecycle checks,
continuity through fatal death, and future-only crash count-in design).
Only intentional Pause/Resume runs the 205ms vinyl gestures. The original
six-stem OGG survives fatal death, Game Over, ordinary title/menu transitions,
and user-selected PauseScene jukebox changes remain authoritative. No crash
scratch/count-in implementation and no real song beat-grid promotion occur.

The inherited deterministic Gym beat-wait smoke occasionally compared the
simulated 200ms countdown with the unrelated *real* WebAudio clock, causing
an early legitimate release when a real clock advanced between synthetic
frames. Its test-only fake clock is now pinned while exercising the
artificial countdown; the independent real-original-OGG/WebAudio smoke tests
the genuine clock in Chromium. This changes test isolation only.

On a manually resumed song, the WebAudio director schedules first audible
sources about 120ms in the future and gates source offsets at the exact
saved frame. Before that first audible frame, `transportSnapshot().position`
used to temporarily report a position ~120ms earlier than where the player
paused, even though the sources weren't rewinding. The jukebox position
readout now clamps to the already-existing `_resumeGateAt` while awaiting
source playback, so its displayed position stays at the saved point and
then advances with the live clock. No source scheduling, timing grid, mix,
clip content or physics behavior changed. Two unit tests cover the gate and
normal/paused semantics; two sequential full-original-OGG browser tests
verified no visible backward position jump. All changes remain on the
isolated integration branch; not on `main` or either owner worktree.

### 2026-11-18 — Control's explicitly identified fatal-crash audio trigger

To implement Marvin's newly approved death scratch/silence/four-drum-beat/
band-return sound independently of gameplay, `RunScene` now adds `runId`
and `fatal` to *existing* `EVT.CRASH` payloads. Shield-absorbed impact uses
`negated:true,fatal:false` and survives; genuine run-ending collision uses
`negated:false,fatal:true` followed by one `EVT.RUN_END` for that same run.
Gym catches still emit only `EVT.GYM_ATTEMPT_RESET`. An immediate Game Over
retry emits `EVT.RUN_START` with a new runId; **no music timer can delay it**.
The payload additions do not alter run records, hash, score, physics, or
existing manual vinyl behavior. Chromium regression:
`tools/fatal-death-countin-gameplay-contract-browser-smoke.mjs`. Full
approved music contract:
`docs/MUSIC-DEATH-TURNTABLE-COUNT-IN-DESIGN-20261118.md`. Actual fatal
music scratch/count-in DSP remains **Music Friday-owned and not present in
this gameplay branch**; integration is a separate follow-up.

The fatal `EVT.CRASH` emission is exception-contained at its producer, so a
broken synchronous music listener cannot prevent the actual run record from
being finalized and delivered via `RUN_END` (or prevent GameOver). The
Chromium contract smoke injects a throwing fatal-audio observer after an
immediate retry, forces another real physical BSOD death, and verifies the
new run record and one `RUN_END` still complete. A throwing EventEmitter
observer can still suppress *later* listeners on the same `EVT.CRASH`; each
subsystem should contain its own audio callback failures. No synth/music
exception is permitted to hold gameplay hostage.

### 2026-11-18 — Actual Game Over retry → fatal count-in cross-scene integration gate

Added `tools/fatal-death-countin-real-retry-audio-browser-smoke.mjs` as a
Control-owned **integration test**. Originally prepared as pending before Music
Friday committed the real fatal count-in implementation; now available for
combined verification. It differs from her
music smoke's synthetic `RUN_START`: forces genuine BSOD fatal physics,
progresses the actual GameOverScene, calls its real retry(), and verifies
that a new RunScene starts immediately while the **same AudioContext song,
clock anchor, count-in generation, and four original drum cue positions**
continue through to full-band recovery. Uses real OGG and WebAudio; no
synthetic beat grids are added to any release catalog. Before `bfd7778`, integration lacked `getFatalCountInStatus`; the test
**PASSED** against `e3d88a9` plus Control's integrated event contract:
real BSOD fatal collision, actual GameOverScene retry, same drum recovery
generation, original song clock and transport, full-band return in the new
run. The beat pulses remain synthetic and cannot be released as verified.


### 2026-11-18 — Music Friday fatal crash count-in implemented on ISOLATED MUSIC branch

**Newest branch-only audio implementation:**
`feature/music-fatal-countin-20261118` descends from the integrated
manual-vinyl base `9abb3f7`, and has incorporated Control Friday's fatal
identity/fault-isolation gameplay commits `1000852` and `afeff56`.
The music-owned implementation is in `src/systems/music/FatalCrashCountIn.js`,
`src/systems/music/MusicFXGraph.js`, and `src/systems/AudioSynth.js`.
This newer status supersedes the *historical*, accurate previous-section
statement that music crash processing was not yet implemented at that time.

A **strictly genuine** `EVT.CRASH {fatal:true,negated:false,runId}` triggers
one short descending record scratch, two **synthetic** 0.5-second silent
pulses, exactly four short accents cut from the original track's decoded
`drums.ogg` AudioBuffer, and the complete same original six-stem source
return. The source mixer has a distinct per-source recovery gain ahead of
motion and adaptive routing; the same source transport, original track token,
WebAudio playback clock and note/beat catalog remain unchanged. The extra
four accents share the **existing mixer**: no second player, no new song,
no rewind. `RUN_END` and immediate `RUN_START` never cancel the sequence,
but explicit user jukebox choices, manual pause, mute and song changes do.
Repeated `CRASH` events with the same runId cannot restart the effect;
shield-negated hits and Gym catches never start it.

**The research 0.5-second beat grid is unverified and NOT release-grade.**
The two silent pulses and four accents are deterministic test fixtures,
not newly approved song beat positions. `getBeatTiming()` and
`isBeatTimingCurrent()` fail closed while an automatic fatal count-in is
active; neither the Gym's verified-pulse catalog nor original OGG tracks
were modified. Once real human-reviewed source quarter-note grids are
available, replace the research pulse selection without changing gameplay
or creating another source transport.

**QA:** `tests/src/fatal-crash-countin.test.js` covers strict event metadata,
source-derived drum transient selection, duplicate fatal events, exact
four-hit scheduling, cross-run carry and cancellation. Chromium checks
`tools/music/smoke-fatal-crash-countin-original-ogg.mjs`,
`tools/music/smoke-fatal-countin-four-songs-ogg.mjs`, and
`tools/music/audit-fatal-countin-real-webaudio.mjs` validate the actual
original song sources and audible waveform envelopes. Control's
`tools/fatal-death-countin-gameplay-contract-browser-smoke.mjs` validates
shield, real fatal BSOD, Game Over, instant retry, Gym catches and
fault isolation. Full implementation contract and remaining musical-review
gates: `docs/MUSIC-FATAL-CRASH-COUNTIN-AUDIO-HANDOFF-20261118.md`.

**No merge to `main`, gameplay deployment, or human listening sign-off**
occurs by creating this feature branch.


### 2026-11-18 — Fatal scratch/count-in CONTROL + MUSIC integration VERIFIED

Published Music Friday commit `bfd7778` was cherry-picked into the isolated
Control integration branch as `e3d88a9` (documentation conflict only, both
notes preserved). The previously pending REAL Game Over retry test now
**passes**: actual Matter fatal BSOD collision emits `fatal:true`/runId,
GameOver opens, immediate retry launches a different runId without waiting,
then all **four original-OGG drum excerpt cues** and full-band return keep
the same WebAudio clock, original song transport and count-in generation.

The three music real-OGG/real-WebAudio checks pass, including source selection
for the remaining shipped recordings, audible four-cue envelope, silence and
full-band recovery. Manual vinyl transport, jukebox, Gym pause READY, shield
nonfatal handling, and real five-Bluff flight also remain browser-green.
The independent combined full run: 150/157 passing suites and 2371/2380
passing tests; the identical seven pre-existing failing suites and nine tests
remain (not newly introduced by this integration). Production Vite build
passes. Tests do not imply human rhythm verification.

**Release blocker:** Synthetic test pulse = 0.5s, deliberately NOT a verified
source recording-specific beat/phase. The 81/161 BPM interpretation remains
open, and no production beat grid was promoted. Listening and pulse review
are still required before shipping. Isolated branch only: `main` and the live
site were not merged/deployed.

### Cosmetic synthetic beat/measure clock (not musical verification)

`AudioSynth.getSyntheticMeterTiming()` is an additive, **read-only** API for cosmetic beat/measure experimentation. It shares the existing fatal-count-in default half-second beat length (`SyntheticMeterTiming.js`), assumes **4/4**, and anchors its artificial measure 1 at **original recording source t=0**. This is intentionally **not** a claim about the actual first musical bar. `null` means audio unavailable, paused, muted, loading, fatal recovery, or outside the source recording. It never starts, stops or seeks song audio.

A non-null frozen result contains `trusted:false`, `timingKind:'synthetic-unverified'`, `use:'cosmetic-only'`, `canAuthorizeGameplay:false`, `trackId` and `transportRevision` as stale-callback guards, `sourceTimeSeconds`, `beatSeconds:.5`, `beatsPerMeasure:4`, `measureSeconds:2`, zero-based `beatIndex` and `measureIndex`, one-based `beatInMeasure`, `beatStartSeconds`, `measureStartSeconds`, `nextBeatSeconds`, `nextMeasureStartSeconds`, `isMeasureStartBeat`, `atMeasureStart` (approx. 50ms boundary window), and corresponding WebAudio `*AudioTime` fields. Time fields use the same real source-transport clock as the original OGG music; no extra player, timers, or derived 160 BPM claim. Visual consumers (e.g. a future optional World Dance rhythm mode) should react to **changes of `(transportRevision, beatIndex)` or `(transportRevision, measureIndex)`** once per boundary, never retrigger continuously while `isMeasureStartBeat` remains true. Never gate gameplay, Gym starts, collision, scoring or release pacing on this value. The existing `getBeatTiming()` verified-only fail-closed interface is unchanged.

The existing `planFatalCountIn()` additionally reports `beatInMeasure:[1,2,3,4]`, one `measureStartOnsets` timestamp at the first drum accent, `beatsPerMeasure:4`, `measureSeconds`, and `syntheticMeterOrigin:'count-in-first-drum'`, without changing scheduling. This is an **independent artificial count-in** and should not be assumed aligned with the song-wide fake meter, much less an actual source downbeat. Actual source measure verification remains separate research; release beat catalogs stay unverified.
