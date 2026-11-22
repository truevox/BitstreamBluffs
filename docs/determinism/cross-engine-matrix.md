# Cross-engine replay conformance matrix (issue #120)

**Status: diagnostic evidence, non-authoritative.** The per-tick digests used here live in `tools/conformance/cross-engine-page.js`. They are not a replay format and not a canonical hash; they are to be replaced by the Replay Contract fingerprints (#152, #118/#165) when those land. Subsystem names below are the Replay Contract v1.0 `FP_SUBSYSTEMS` names; this digest is coarser than the contract's 13-way split (see the mapping note in the generated section). Nothing in the game, tape format or header was changed.

**Playwright WebKit is not iPhone Safari.** It is a Linux build of WebKit 27.2 with a Mac Safari user agent. A pass or fail there says nothing about real Safari or iOS. No real iPhone, Safari, ARM, Node or hardware GPU was available, so those columns do not exist: they are **unsupported in this environment**, not "passing".

## What was run

Real built game (`vite build`, Phaser 3.90 + Matter), `window.__bbGame`, stepped frame by frame with `game.step(t, dt)` (loop asleep, `RunScene.update` held), so display cadence reaches `SimClock` exactly as in play. Only the final WebGL draw call (`renderer.render`) is skipped (`RASTER=1` restores it); every JS path including `renderFrame`, camera and telegraph still runs.

* 9 fixtures, recorded **once** in Chromium with the game's own `GhostRecorder` (an autopilot drives live input; the committed tape is the fixture: `tools/conformance/fixtures/cross-engine/*.tape.json`, 240 KB total) and replayed on every engine through `TapePlayer`.
* 5 engine configurations: `chromium-headless-shell` 157 (SwiftShader), `chromium-full-headless` 153 (headless=new), `chromium-shell-defaultgl` 157 (no ANGLE flags), Firefox 159 (**headed under Xvfb**: headless Firefox cannot create WebGL here), Playwright WebKit 27.2. All Linux x64, 4 vCPU container.
* 4 display cadences (30, 60, 120, 144 Hz stepping) x 2 fresh browser contexts per cell x 10 runs per session (the 9 fixtures in order, then fixture 1 again) = 400 rows.
* Reference: each fixture as run #1 of its own fresh context on `chromium-headless-shell` at 120 Hz. Every other run is compared tick by tick against it (digest per tick for 9 groups, raw sled state for the first differing tick), plus the game's own `TapePlayer` checkpoint check.
* On a divergence, a second pass traces every `Math.*` call per tick (argument hash, result hash) in both engines, logs the exact calls at the divergent tick, and then re-runs both engines with the differing ops replaced by an engine-independent pure-JS implementation (the counterfactual). The page clock is pinned to the recording day (see finding 3).

Fixture coverage: fifth-run-in-session (recorded as the 5th run of one page, re-verified in a fresh context; live vs fresh replay identical: `fixtures/cross-engine/record-meta.json`), collision-heavy, chunk/sector boundaries with biomes (sector 2 at 500 m, mask 2047), BSOD pursuit and catch (run ends `cause: bsod`), airborne tricks (heli CW/CCW), parachute + air brake, Kodiaks on, Daily rule via a `daily-YYYY-MM-DD` seed (practice; an official Daily needs today's date). **Not covered:** BSOD Gym (the game never records a tape in the Gym, so no replay exists), Draft mode, upgraded/boosted loadouts, GameOver/retry and pause/resume inside a run, tab-background frames, slow-mo/hit-stop as a targeted case, every biome individually, gamepad/touch, 144 Hz input-edge scheduling (replays feed per-tick pads, so cadence only exercises `SimClock`).

## Findings

1. **Chromium is cadence- and build-stable.** Three Chromium configurations (two builds, SwiftShader vs default GL, headless shell vs headless=new) x 30/60/120/144 Hz x 2 sessions: every digest identical to the reference, final tick, distance, score and crash cause identical, TapePlayer checkpoints all matched. No telegraph-only (#155) differences appeared: planned telegraph marks were identical across cadences.
2. **Firefox and WebKit diverge from Chromium on every fixture, independent of cadence.** In a fresh context the first divergent tick is 19 to 2054 (Firefox 255 to 764 on the eight comparable fixtures, 373 on chunk-biome; WebKit 19 to 2054); the TapePlayer checkpoint check also desyncs (first at tick 120 to 2520). Within an engine the result is the same at 30/60/120/144 Hz and in both sessions. The cause is `Math.*` implementation differences: for identical arguments `Math.hypot` (WebKit and Firefox), `Math.exp` (Firefox, 1 ulp from tick 1 on every run), and intermittently `sin`, `cos`, `tan`, `atan2`, `tanh` return results that differ in the last bit; most differences are absorbed, and the state diverges at a tick where such a call feeds a collision or angle. **With those ops replaced by one pure-JS implementation in both engines, no divergence occurs over the whole run for every diagnosed case** (see the counterfactual lines below). This is evidence for conditional issue #121 (portable math). It does not say which single op is sufficient; the replaced set per case is listed. The harness does not fix physics math.
3. **A replay depends on the calendar date.** For seeds that are not `daily-YYYY-MM-DD`, `RunScene` applies today's Daily rule modifiers (`DailyPatch.getDailyInfo()`); the tape header stores `dailyRuleId` but replay ignores it. The same cruise tape replayed with the clock at 2026-11-21 ended at 2401 ticks / 591 m (rule `featherweight`); on 2026-11-22 it desynced at the tick-120 checkpoint and ended at 1746 ticks / 352 m (rule `slickLines`). 8 of 9 fixtures changed overnight, which is how this was found. The harness pins the page `Date` (`CE_DATE`, default 2026-11-21T12:00Z). Reported to #152.
4. **Session state leaks between runs.** `chunk-biome-boundaries` replayed as run #4 (after the terrain-crash run `collision-heavy`) diverges from its fresh-context replay at tick 1 (`matter`), on all three Chromium configurations, all cadences and both sessions: 815 m survived instead of 835 m crash, TapePlayer desync at tick 120. The Matter world array order differs between a fresh run and a later run (sled and power-up bodies first vs terrain first; same body set, different global ids); no other registry difference except `lastCrash` was found. Other fixtures at other positions were unaffected, and run #10 (repeat of fixture 1) matched run #1. Root cause not isolated. Until it is, a verifier must use a fresh context per run. Cross-engine comparisons for this fixture use the fresh-context numbers.
5. **The profile Sync Level is not in the tape.** `BsodPursuit` reads `prof.level`. Replaying the Kodiak tape (recorded at level 8) at level 1 differs from tick 1 in the BSOD digest (`record-meta.json`: `levelSensitivity`); the sled outcome there is unchanged only because the wall never gets close. The harness replays at the recorded level.

## Unavailable or unsupported in this environment

* Real Safari / iPhone / iPadOS, Edge, Chrome-for-Android, Node, ARM64, Windows, macOS, hardware GPUs: not testable here.
* Firefox headless: no WebGL (Phaser is WebGL-only), so Firefox ran headed under Xvfb with Mesa software GL.
* Playwright 1.65 expects Chromium build 1254 but 1243 is installed: the harness resolves the installed binaries by `executablePath`; nothing was reinstalled.
* Rasterisation is skipped by default for speed (16x), so GPU draw differences are not covered; `RASTER=1` enables it.

## Reproduce

```
npm run build && npx vite preview --port 8412 &
export GAME_URL=http://localhost:8412/
# (re)record fixture tapes in Chromium and verify live vs fresh-context replay
xvfb-run -a node tools/conformance/cross-engine.mjs record
# full matrix (all engines, 30/60/120/144 Hz, 2 sessions); add --resume to continue after an interruption
xvfb-run -a node tools/conformance/cross-engine.mjs matrix --resume
# narrow it: ENGINES=webkit HZ=120 SESSIONS=1 FIXTURES=cruise-baseline OUT=/tmp/x.json ...
node tools/conformance/cross-engine-report.mjs   # regenerates the tables below from docs/determinism/results/cross-engine-results.json
```

Every finished session is journaled to `tools/conformance/.cache/cross-engine.journal.jsonl` (git-ignored); a session is the unit of replay state, so an interrupted session restarts from its first run. Firefox needs `xvfb-run` (or any `DISPLAY`). `npx playwright install firefox webkit` (and `install-deps`) provides the browsers.

## Results (generated)

<!-- BEGIN GENERATED -->
### Environments

| Engine id | Browser / version | Headless mode | OS / arch | GL renderer | Status |
|---|---|---|---|---|---|
| chromium-headless-shell | chromium 157.0.8103.78 | headless (chrome-headless-shell, SwiftShader) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| chromium-full-headless | chromium 153.0.8010.12 | headless=new (full Chromium, SwiftShader) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| chromium-shell-defaultgl | chromium 157.0.8103.78 | headless (chrome-headless-shell, default GL, no ANGLE flags) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| firefox | firefox 159.0 | HEADED under Xvfb (headless Firefox has no WebGL here; Mesa llvmpipe) | Linux 6.18.44-fc-v726 x64 | llvmpipe, or similar | ran |
| webkit | webkit 27.2 | headless (Playwright WebKit, not Safari) | Linux 6.18.44-fc-v726 x64 | Apple GPU | ran |

### Reference outcomes (chromium-headless-shell, 120 Hz stepping, each fixture replayed as run #1 in its own fresh browser context)

| Fixture | Ticks | Final outcome | Distance | Score | Covers |
|---|---|---|---|---|---|
| cruise-baseline | 2401 | ended at tick limit (no crash) | 591 m | 876 | baseline grounded + air |
| fifth-run-in-session | 1801 | ended at tick limit (no crash) | 472 m | 717 | recorded as the 5th run in one page session; re-verified in a fresh browser context |
| collision-heavy | 1669 | crash: terrain | 289 m | 399 | many contact pairs, hazards, hard landings |
| chunk-biome-boundaries | 3431 | crash: hazard | 835 m | 1175 | crosses procedural chunk borders and the 500 m sector boundary (biome sectors from sector 2) |
| bsod-pursuit-catch | 12150 | crash: bsod | 437 m | 0 | BSOD pursuit; the rider brakes and spams manual reset (respawn) until the wall catches it (~100 s) |
| airborne-tricks | 2224 | crash: hazard | 513 m | 2428 | heli / corkscrew / divebomb tricks |
| parachute-airbrake | 2146 | crash: hazard | 332 m | 790 | parachute deploy, air brake presses, ground brake |
| kodiaks-on | 2637 | crash: hazard | 606 m | 991 | hostile Kodiak packs (Sync Level >= 6 at record time) |
| daily-practice-rule | 2401 | ended at tick limit (no crash) | 724 m | 1399 | Daily rule + biome mask derived from a past date seed (practice run; official Daily needs today's date) |

### Matrix: first divergent tick vs the reference (per engine, cadence; both sessions and every run position)

A cell is `ok` when every run of that fixture in every session (including the repeat of run 1 at the end of each session) had a digest sequence identical to the reference; otherwise `FIRST_TICK subsystem(s)` (the earliest across runs; `*` marks inconsistent results across runs of the same cell).

**cruise-baseline**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (4) | ok (4) | ok (4) | ok (4) |
| chromium-full-headless | ok (4) | ok (4) | ok (4) | ok (4) |
| chromium-shell-defaultgl | ok (4) | ok (4) | ok (4) | ok (4) |
| firefox | 554 terrain/hazards/pickups (4/4) | 554 terrain/hazards/pickups (4/4) | 554 terrain/hazards/pickups (4/4) | 554 terrain/hazards/pickups (4/4) |
| webkit | 971 sled+matter (4/4) | 971 sled+matter (4/4) | 971 sled+matter (4/4) | 971 sled+matter (4/4) |

**fifth-run-in-session**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 489 terrain/hazards/pickups (2/2) | 489 terrain/hazards/pickups (2/2) | 489 terrain/hazards/pickups (2/2) | 489 terrain/hazards/pickups (2/2) |
| webkit | 714 terrain/hazards/pickups (2/2) | 714 terrain/hazards/pickups (2/2) | 714 terrain/hazards/pickups (2/2) | 714 terrain/hazards/pickups (2/2) |

**collision-heavy**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 580 terrain/hazards/pickups (2/2) | 580 terrain/hazards/pickups (2/2) | 580 terrain/hazards/pickups (2/2) | 580 terrain/hazards/pickups (2/2) |
| webkit | 732 sled+matter (2/2) | 732 sled+matter (2/2) | 732 sled+matter (2/2) | 732 sled+matter (2/2) |

**chunk-biome-boundaries**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) |
| chromium-full-headless | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) |
| chromium-shell-defaultgl | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) |
| firefox | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) |
| webkit | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) | 1 matter (2/2) |

**bsod-pursuit-catch**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 764 sled+matter (2/2) | 764 sled+matter (2/2) | 764 sled+matter (2/2) | 764 sled+matter (2/2) |
| webkit | 508 sled+matter (2/2) | 508 sled+matter (2/2) | 508 sled+matter (2/2) | 508 sled+matter (2/2) |

**airborne-tricks**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 255 sled (2/2) | 255 sled (2/2) | 255 sled (2/2) | 255 sled (2/2) |
| webkit | 2054 terrain/hazards/pickups (2/2) | 2054 terrain/hazards/pickups (2/2) | 2054 terrain/hazards/pickups (2/2) | 2054 terrain/hazards/pickups (2/2) |

**parachute-airbrake**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 523 terrain/hazards/pickups (2/2) | 523 terrain/hazards/pickups (2/2) | 523 terrain/hazards/pickups (2/2) | 523 terrain/hazards/pickups (2/2) |
| webkit | 696 sled+matter (2/2) | 696 sled+matter (2/2) | 696 sled+matter (2/2) | 696 sled+matter (2/2) |

**kodiaks-on**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 586 terrain/hazards/pickups (2/2) | 586 terrain/hazards/pickups (2/2) | 586 terrain/hazards/pickups (2/2) | 586 terrain/hazards/pickups (2/2) |
| webkit | 796 sled+matter (2/2) | 796 sled+matter (2/2) | 796 sled+matter (2/2) | 796 sled+matter (2/2) |

**daily-practice-rule**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 484 terrain/hazards/pickups (2/2) | 484 terrain/hazards/pickups (2/2) | 484 terrain/hazards/pickups (2/2) | 484 terrain/hazards/pickups (2/2) |
| webkit | 19 terrain/hazards/pickups+sled+matter (2/2) | 19 terrain/hazards/pickups+sled+matter (2/2) | 19 terrain/hazards/pickups+sled+matter (2/2) | 19 terrain/hazards/pickups+sled+matter (2/2) |

Subsystem names are the Replay Contract v1.0 names (`clock, rng, sled, matter, terrain, hazards, pickups, effects, bsod, kodiak, score, tricks, recovery`). This harness digest is coarser: its `terrain` group also covers hazard/pickup counts, `score` also covers trick counters, `world` is the whole Matter world (`matter`), `timers` is `clock`. Native names stay in the raw JSON.

### Telegraph (presentation-derived, issue #155) differences

No run had a telegraph-only difference: the digest of the planned ground-telegraph marks was identical to the reference whenever the causal digests were.

### Outcomes per engine (final distance / score / ticks / cause) when they differ from the reference

| Engine | Hz | Session/run | Fixture | Ticks | Crash | Distance | Score | Reference |
|---|---|---|---|---|---|---|---|---|
| chromium-headless-shell | 120 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-headless-shell | 30 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-headless-shell | 60 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-headless-shell | 144 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-full-headless | 30 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-full-headless | 60 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-full-headless | 120 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-full-headless | 144 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-shell-defaultgl | 30 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-shell-defaultgl | 60 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-shell-defaultgl | 120 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| chromium-shell-defaultgl | 144 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| firefox | 30 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| firefox | 60 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| firefox | 120 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |
| firefox | 144 | s1/#4 | chunk-biome-boundaries | 3431 | no | 815 | 1115 | 3431 / hazard / 835 / 1175 |

### TapePlayer checkpoint desync (game-native check, exact sled state every 120 ticks)

| Engine | Hz | Fixture | First desync tick (checkpoint) | Runs desynced / runs |
|---|---|---|---|---|
| chromium-headless-shell | 120 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-headless-shell | 30 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-headless-shell | 60 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-headless-shell | 144 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 30 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 60 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 120 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 144 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 30 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 60 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 120 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 144 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 30 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 30 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 30 | kodiaks-on | 1920 | 2/2 |
| firefox | 30 | daily-practice-rule | 1320 | 2/2 |
| firefox | 60 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 60 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 60 | kodiaks-on | 1920 | 2/2 |
| firefox | 60 | daily-practice-rule | 1320 | 2/2 |
| firefox | 120 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 120 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 120 | kodiaks-on | 1920 | 2/2 |
| firefox | 120 | daily-practice-rule | 1320 | 2/2 |
| firefox | 144 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 144 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 144 | kodiaks-on | 1920 | 2/2 |
| firefox | 144 | daily-practice-rule | 1320 | 2/2 |
| webkit | 30 | cruise-baseline | 1080 | 4/4 |
| webkit | 30 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 30 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 30 | parachute-airbrake | 720 | 2/2 |
| webkit | 30 | kodiaks-on | 2520 | 2/2 |
| webkit | 30 | daily-practice-rule | 120 | 2/2 |
| webkit | 60 | cruise-baseline | 1080 | 4/4 |
| webkit | 60 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 60 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 60 | parachute-airbrake | 720 | 2/2 |
| webkit | 60 | kodiaks-on | 2520 | 2/2 |
| webkit | 60 | daily-practice-rule | 120 | 2/2 |
| webkit | 120 | cruise-baseline | 1080 | 4/4 |
| webkit | 120 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 120 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 120 | parachute-airbrake | 720 | 2/2 |
| webkit | 120 | kodiaks-on | 2520 | 2/2 |
| webkit | 120 | daily-practice-rule | 120 | 2/2 |
| webkit | 144 | cruise-baseline | 1080 | 4/4 |
| webkit | 144 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 144 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 144 | parachute-airbrake | 720 | 2/2 |
| webkit | 144 | kodiaks-on | 2520 | 2/2 |
| webkit | 144 | daily-practice-rule | 120 | 2/2 |

### Math.* isolation (second pass, only where a divergence was found)

- **firefox / cruise-baseline / 30 Hz**: first state divergence in the matrix at tick 554. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2401 ticks, first @1), hypot (2050 ticks, first @1), sin (20 ticks, first @487), atan2 (139 ticks, first @543), cos (26 ticks, first @580), tan (3 ticks, first @626). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 591 m / score 876.
- **firefox / fifth-run-in-session / 30 Hz**: first state divergence in the matrix at tick 489. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (1801 ticks, first @1), hypot (1592 ticks, first @1), atan2 (107 ticks, first @300), cos (15 ticks, first @511), tan (2 ticks, first @575), sin (17 ticks, first @636). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1801 ticks / 472 m / score 717.
- **firefox / collision-heavy / 30 Hz**: first state divergence in the matrix at tick 580. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (1669 ticks, first @1), hypot (1462 ticks, first @1), sin (12 ticks, first @2), atan2 (109 ticks, first @3), cos (13 ticks, first @404), tan (1 ticks, first @681). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1669 ticks / 289 m / score 399.
- **firefox / bsod-pursuit-catch / 30 Hz**: first state divergence in the matrix at tick 764. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (12150 ticks, first @1), hypot (1910 ticks, first @1), cos (32 ticks, first @326), sin (36 ticks, first @375), atan2 (206 ticks, first @375), tan (3 ticks, first @1579). At the divergent tick: exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 12150 ticks / 437 m / score 0.
- **firefox / airborne-tricks / 30 Hz**: first state divergence in the matrix at tick 255. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2224 ticks, first @1), hypot (1897 ticks, first @1), atan2 (410 ticks, first @240), cos (39 ticks, first @255), sin (34 ticks, first @258), tan (2 ticks, first @623). At the divergent tick: hypot, cos, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2224 ticks / 513 m / score 2428.
- **firefox / parachute-airbrake / 30 Hz**: first state divergence in the matrix at tick 523. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2146 ticks, first @1), hypot (1855 ticks, first @1), atan2 (417 ticks, first @240), sin (47 ticks, first @285), cos (37 ticks, first @312), tan (2 ticks, first @564), tanh (4 ticks, first @1275). At the divergent tick: atan2, hypot, cos, sin, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2146 ticks / 332 m / score 790.
- **firefox / kodiaks-on / 30 Hz**: first state divergence in the matrix at tick 586. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2637 ticks, first @1), hypot (1644 ticks, first @1), sin (23 ticks, first @493), cos (19 ticks, first @563), atan2 (164 ticks, first @564), tan (3 ticks, first @666). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2637 ticks / 606 m / score 991.
- **firefox / daily-practice-rule / 30 Hz**: first state divergence in the matrix at tick 484. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2401 ticks, first @1), hypot (1416 ticks, first @1), cos (8 ticks, first @286), sin (22 ticks, first @305), atan2 (200 ticks, first @473), tan (3 ticks, first @662). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877867321923866, 21.67922875311475): ref 52.55738900122058 vs 52.557389001220585 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 724 m / score 1399.
- **webkit / cruise-baseline / 30 Hz**: first state divergence in the matrix at tick 971. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (805 ticks, first @1), sin (7 ticks, first @552), atan2 (2 ticks, first @1150). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(16, 6.9634642610001265): ref 17.44963708832439 vs 17.449637088324387 (1 ulp, tick 971).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 591 m / score 876.
- **webkit / fifth-run-in-session / 30 Hz**: first state divergence in the matrix at tick 714. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1564 ticks, first @1), tan (1 ticks, first @320), sin (5 ticks, first @487), atan2 (59 ticks, first @601). At the divergent tick: atan2, hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); atan2(2.8302191711541127, 16): ref 0.1750776524532713 vs 0.17507765245327134 (1 ulp, tick 714).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1801 ticks / 472 m / score 717.
- **webkit / collision-heavy / 30 Hz**: first state divergence in the matrix at tick 732. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1439 ticks, first @1), sin (4 ticks, first @577), tan (1 ticks, first @1399). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(533.6686953810204, 128.47531104640439): ref 548.9154597733159 vs 548.9154597733158 (1 ulp, tick 732).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1669 ticks / 289 m / score 399.
- **webkit / bsod-pursuit-catch / 30 Hz**: first state divergence in the matrix at tick 508. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1486 ticks, first @1), atan2 (307 ticks, first @326), sin (4 ticks, first @1814), tan (1 ticks, first @5839). At the divergent tick: none identified. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 12150 ticks / 437 m / score 0.
- **webkit / airborne-tricks / 30 Hz**: first state divergence in the matrix at tick 2054. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1870 ticks, first @1), sin (11 ticks, first @593), tan (1 ticks, first @1154), cos (3 ticks, first @1418), atan2 (40 ticks, first @1682). At the divergent tick: hypot, atan2. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(629.4983482544334, 140.981949350182): ref 645.0923038586318 vs 645.0923038586317 (1 ulp, tick 2054).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2224 ticks / 513 m / score 2428.
- **webkit / parachute-airbrake / 30 Hz**: first state divergence in the matrix at tick 696. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (818 ticks, first @1), sin (2 ticks, first @522), atan2 (16 ticks, first @760). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(661.3997491626651, 101.41190964944143): ref 669.1292876650841 vs 669.129287665084 (1 ulp, tick 696).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2146 ticks / 332 m / score 790.
- **webkit / kodiaks-on / 30 Hz**: first state divergence in the matrix at tick 796. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (2250 ticks, first @1), sin (16 ticks, first @580), atan2 (10 ticks, first @866), tan (2 ticks, first @1360). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(620.828510987958, 101.1304687620577): ref 629.0114559907145 vs 629.0114559907146 (1 ulp, tick 796).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2637 ticks / 606 m / score 991.
- **webkit / daily-practice-rule / 30 Hz**: first state divergence in the matrix at tick 19. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (39 ticks, first @1), atan2 (6 ticks, first @662), sin (1 ticks, first @1417). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877867321923866, 21.67922875311475): ref 52.55738900122058 vs 52.557389001220585 (1 ulp, tick 2); hypot(16, 6.956997999374835): ref 17.4470576649275 vs 17.447057664927502 (1 ulp, tick 19).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 724 m / score 1399.
- **chromium-headless-shell / chunk-biome-boundaries / 120 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: none. Ops that returned different results for identical arguments (vs chromium-headless-shell): none. At the divergent tick: none identified. 
- **chromium-full-headless / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: none. Ops that returned different results for identical arguments (vs chromium-headless-shell): none. At the divergent tick: none identified. 
- **chromium-shell-defaultgl / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: none. Ops that returned different results for identical arguments (vs chromium-headless-shell): none. At the divergent tick: none identified. 
- **firefox / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: tick 373 (matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (3217 ticks, first @1), hypot (673 ticks, first @1), cos (6 ticks, first @304), atan2 (105 ticks, first @427), tan (3 ticks, first @722), sin (5 ticks, first @922). At the divergent tick: hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 3431 ticks / 835 m / score 1175.
- **webkit / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: tick 19 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (69 ticks, first @1), tan (2 ticks, first @1890), atan2 (8 ticks, first @2534). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 3431 ticks / 835 m / score 1175.

### Session-position and repeat checks

**Session-position leak on Chromium**: 24 Chromium runs diverged from their fresh-context reference although engine and cadence were identical. Examples: chunk-biome-boundaries as run #4 @tick 1 (matter).
Per engine, cadence and fixture, both fresh sessions gave one identical digest roll, and the repeat of fixture 1 at run #10 matched run #1. (Session position effects are measured against the fresh-context reference above, not by this line.)

Rows: 400 (400 ok, 0 errors). Raw JSON: `docs/determinism/results/cross-engine-results.json`. Generated 2026-11-22T03:47:06.035Z from commit fb23678f183ae712ef37ae6a54c71a930f135095.
<!-- END GENERATED -->
