# Cross-engine replay conformance matrix (issue #120)

**Status: diagnostic evidence, non-authoritative.** The per-tick digests live in `tools/conformance/cross-engine-page.js`. They are not a replay format and not a canonical hash; they are to be replaced by the Replay Contract fingerprints (#152, #118/#165) when those land. Subsystem names are the Replay Contract v1.0/v1.1 `FP_SUBSYSTEMS` names (unchanged in v1.1); this digest is coarser than the contract's 13-way split (mapping note in the generated section). No game code, tape format or header was changed by this PR.

**Playwright WebKit is not iPhone Safari.** It is a Linux build of WebKit 27.2 with a Mac Safari user agent (its GL renderer string is a masked value, not a real GPU). A pass or fail there says nothing about real Safari or iOS. No real iPhone, Safari, ARM, Node or hardware GPU was available: those columns are **unsupported in this environment**, not "passing".

## What was run

Real built game (`vite build` of the merge with main 7d5780fe (v2.18.1), no src changes, Phaser 3.90 + Matter, `window.__bbGame`), stepped frame by frame with `game.step(t, dt)` (loop asleep, `RunScene.update` held), so display cadence reaches `SimClock` exactly as in play. Only the final WebGL draw call is skipped (`RASTER=1` restores it); all JS paths including `renderFrame`, camera and telegraph run.

* 9 fixtures, recorded **once** in Chromium with the game's own `GhostRecorder` on the merged build (so headers carry `syncLevel` and `dailyRuleSource`, Replay Contract v1.1 / PR #164), committed as `tools/conformance/fixtures/cross-engine/*.tape.json` and replayed through `TapePlayer`.
* 5 engine configs: `chromium-headless-shell` 157 (SwiftShader), `chromium-full-headless` 153 (headless=new), `chromium-shell-defaultgl` 157, Firefox 159 (**headed under Xvfb**: headless Firefox cannot create WebGL here), Playwright WebKit 27.2. Linux x64, 4 vCPU.
* **Digest groups.** *Causal* (decide divergence): `rng`, `timers` (=`clock`), `terrain` structure (chunk count/ends, hazard and pickup counts), `kodiaks`, `bsod`, `sled`, `world` (=`matter`, all bodies), `score` (with trick counters). *Derived, never counted as divergence, own column*: `heightAt/slopeAt` read at the sled x (an `atan2` inside) and the camera-derived telegraph marks (#155).
* **Fresh-context cells** (the headline): every engine x fixture as run #1 of its own fresh browser context at 120 Hz. **Matrix**: 4 cadences (30/60/120/144 Hz) x 2 fresh sessions x 10 runs per session (the 9 fixtures in order, then fixture 1 again) = 400 rows, each compared tick by tick with the reference (fixture as run #1 of a fresh context on `chromium-headless-shell`, 120 Hz), plus the game's own `TapePlayer` checkpoint check (exact sled state every 120 ticks) and the final outcome.
* On a causal divergence, a second pass traces every `Math.*` call per tick in both engines and logs the exact calls at the divergent tick; then both engines are re-run with the differing ops replaced by one engine-independent pure-JS implementation (counterfactual).
* The page clock is pinned to the recording day (`CE_DATE`); `record` also verifies that moving the clock to another day and using a level-1 profile does not change a replay of these tapes (it does not: v1.1 header fields now govern, see finding 5).

Coverage: fifth-run-in-session (recorded as the 5th run of one page, verified in a fresh context), collision-heavy, chunk/sector boundaries with biomes (500 m sector 2, mask 2047), BSOD pursuit and catch (`cause: bsod`), airborne tricks, parachute + air brake, Kodiaks on, Daily rule via a `daily-YYYY-MM-DD` seed (practice). **Not covered:** BSOD Gym (no tape is recorded in the Gym), Draft, upgraded/boosted loadouts, GameOver/retry and pause/resume inside a run, tab-background frames, slow-mo/hit-stop as a targeted case, every biome individually, gamepad/touch, input-edge scheduling at 144 Hz (replays feed per-tick pads, so cadence only exercises `SimClock`).

## Findings (corrected after independent review)

1. **Chromium: 8 of 9 fixtures are stable; the 9th depends on run position.** In fresh contexts all three Chromium configs are identical to the reference in 27/27 cells (digests, TapePlayer, outcome), at every cadence and in both sessions. In the matrix, `chunk-biome-boundaries` as run #4 (after `collision-heavy`) diverges at tick 1: that is finding 4, not an engine difference.
2. **Firefox and WebKit are not bit-identical to Chromium, but the final outcomes mostly are.** Fresh-context, 120 Hz, 18 cells: first *causal* divergence in 13/18 (Firefox 5/9, WebKit 8/9). In the other 5 (Firefox cruise, fifth-run, collision, parachute; WebKit airborne-tricks) only the derived `heightAt/slopeAt` probe differs (a 1-ulp `atan2` difference in a read-only function) and nothing else, no sled delta, no TapePlayer desync. Of the 13 causal cells, the exact TapePlayer checkpoint check desyncs in 10 (the other 3 diverge in the digest between checkpoints but their checkpoints still match). **The final outcome (ticks, crash cause, distance, score) equals the reference in 17/18 cells**; the exception is Firefox `chunk-biome-boundaries` (815 m, no crash, vs 835 m hazard crash). Within an engine the result does not depend on cadence (30/60/120/144 Hz) or session. First causal tick: Firefox 255 to 1698, WebKit 19 to 971 (table below, with the sled delta in ulps). The earlier headline "diverges at tick 554 in terrain" was a probe artifact and is withdrawn.
3. **`Math.*` is the cause, and the counterfactual shows only that the engines then agree.** For identical arguments, `Math.hypot` (WebKit and Firefox), `Math.exp` (Firefox, 1 ulp from tick 1), and intermittently `sin`, `cos`, `tan`, `atan2` return different last bits; most are absorbed, and the state diverges where one feeds a collision or angle. With the differing ops replaced by one pure-JS implementation in **both** engines (installed before the game loads), there is no divergence over the whole run in all 13 diagnosed Firefox/WebKit cells (30 Hz stepping, run #1 of one fresh context, one session each; none of the ops was left unreplaced: `tanh` is now in the shim and no `tanh` difference occurred in this run). Caveats: this is "patched A == patched B", not "restores the recording": the patched sim desyncs from the recorded tape at the first checkpoint (tick 120) in every case, because the recording used native Math. No per-op ablation was done (left to #121). Evidence for #121, not a fix.
4. **Session-position leak: real game bug for biome-mask runs, fix proposed in PR #219 (open, not merged).** One page, tape A then tape B, B compared with B as run #1 of a fresh context (Chromium shell, 120 Hz): `collision-heavy -> chunk-biome-boundaries` diverges at tick 1 (`matter`: same body set, different world-array order), TapePlayer desyncs at tick 120, 815 m survived instead of 835 m crash. Controls `cruise-baseline -> chunk-biome-boundaries` and `airborne-tricks -> chunk-biome-boundaries` are clean. **Root cause (found in #219): `RunScene.create()` never reset `_biomeSector` / `_lastBiome`. With a biome mask, tick 1 of a fresh page sees a sector change and calls `refreshPalette`, which removes and re-adds every collider and reorders the Matter world; a later run whose previous run ended in the same sector does not. It therefore only affects biome-mask fixtures such as `chunk-biome-boundaries`.** #219 resets those fields; nothing is fixed in this PR. The same crash fixture twice in a row also shows a smaller difference in the causal `terrain` structure group (hazard/pickup/chunk counts) in this harness: `airborne-tricks` run #2 at tick 1728, `parachute-airbrake` 968, `kodiaks-on` 2150, `bsod-pursuit-catch` 7003, with sled, checkpoints and final outcome unchanged. #219 could **not** reproduce the airborne-tricks tick-1728 case on current main, either through this harness path or through the real crash -> GameOver -> `retry()` path (513 m both ways), and these fixtures have biome mask 0, so the `_biomeSector` leak cannot explain them; the cause of this structure-count difference is **unexplained** and has no sim or outcome effect that this harness can see. The harness itself force-stops scenes and calls `TitleScene.startRun`; it does not use the real retry flow.
5. **Date and Sync Level (Replay Contract v1.1).** On the pre-merge build the same cruise tape ended at 2401 ticks / 591 m with the clock on 2026-11-21 and desynced at tick 120 / 352 m on 11-22 (today's Daily rule applied, header `dailyRuleId` ignored), and `BsodPursuit` read the live profile level. Main now records `dailyRuleSource` and `syncLevel` in the tape header and replays from them (v1.1 plus PR #164). With the re-recorded tapes, replays on another calendar day and on a level-1 profile are identical to the recording (`fixtures/cross-engine/record-meta.json`: `dateIndependence`, `levelSensitivity`). Tapes recorded before that change still depend on the clock and profile.

## Unavailable or unsupported in this environment

* Real Safari / iPhone / iPadOS, Edge, Chrome for Android, Node, ARM64, Windows, macOS, hardware GPUs.
* Firefox headless (no WebGL here; Phaser is WebGL-only): Firefox ran headed under Xvfb with Mesa software GL.
* Playwright 1.65 expects Chromium build 1254 but 1243 is installed: the harness resolves installed binaries via `executablePath`; nothing was reinstalled.
* GPU rasterisation is skipped by default for speed (16x); `RASTER=1` enables it.

## Reproduce

```
npm run build && npx vite preview --port 8412 &
export GAME_URL=http://localhost:8412/
xvfb-run -a node tools/conformance/cross-engine.mjs record               # (re)record tapes in Chromium; verifies live vs fresh replay, date and level independence
xvfb-run -a node tools/conformance/cross-engine.mjs matrix --resume      # 400-row matrix (all engines, 4 cadences, 2 sessions)
xvfb-run -a node tools/conformance/cross-engine.mjs fresh --resume       # fresh-context cells (the headline)
node tools/conformance/cross-engine.mjs positions                        # session-position probe
node tools/conformance/cross-engine-report.mjs                           # regenerate the tables below
# narrow: ENGINES=webkit HZ=120 SESSIONS=1 FIXTURES=cruise-baseline OUT=/tmp/x.json ...
```

`--resume` reads `tools/conformance/.cache/*.journal.jsonl` (git-ignored). The journal is keyed by a fingerprint (build index hash, URL, `CE_DATE`, harness code, fixtures and every tape hash); any mismatch discards it and starts fresh, so stale cells are never reused. A session is the unit of replay state, so an interrupted session restarts from its first run.

## Results (generated)

<!-- BEGIN GENERATED -->
### Environments

| Engine id | Browser / version | Headless mode | OS / arch | GL renderer | Status |
|---|---|---|---|---|---|
| chromium-headless-shell | chromium 157.0.8103.78 | headless (chrome-headless-shell, SwiftShader) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| chromium-full-headless | chromium 153.0.8010.12 | headless=new (full Chromium, SwiftShader) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| chromium-shell-defaultgl | chromium 157.0.8103.78 | headless (chrome-headless-shell, default GL, no ANGLE flags) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| firefox | firefox 159.0 | HEADED under Xvfb (headless Firefox has no WebGL here; Mesa llvmpipe) | Linux 6.18.44-fc-v726 x64 | llvmpipe, or similar | ran |
| webkit | webkit 27.2 | headless (Playwright WebKit, not Safari) | Linux 6.18.44-fc-v726 x64 | Apple GPU (masked string reported by WebKit on Linux; not a real Apple GPU) | ran |

### Headline: fresh-context results (each cell = run #1 of its own fresh browser context; no session-position effects)

- Chromium (3 configs, 27 cells): causal digest identical to the reference in 27/27 cells; TapePlayer desync in 0; outcome equal to reference in 27/27.
- Firefox + WebKit (18 engine x fixture cells at 120 Hz): first CAUSAL divergence (groups rng, clock, terrain structure, kodiak, bsod, sled, matter, score) in 13/18; the exact TapePlayer checkpoint check (sled state every 120 ticks) desyncs in 10/18 (3 cells with a causal-digest divergence never desync at a checkpoint); the derived terrain probe (heightAt/slopeAt reads, not state) differs in 17/18 and is the EARLIEST difference in 8; **final outcome (ticks, crash cause, distance, score) equals the reference in 17/18 cells**.

| Engine | Fixture | First causal divergence | Sled delta at that tick | Derived-read first diff (not state) | TapePlayer first desync | Final outcome == reference |
|---|---|---|---|---|---|---|
| firefox 120 Hz | cruise-baseline | none | - | 554 | never | yes |
| firefox 120 Hz | fifth-run-in-session | none | - | 489 | never | yes |
| firefox 120 Hz | collision-heavy | none | - | 580 | never | yes |
| firefox 120 Hz | chunk-biome-boundaries | tick 373 (matter) | none (sled bit-identical) | 594 | 840 | NO (3431 ticks, no crash, 815 m, 1115) |
| firefox 120 Hz | bsod-pursuit-catch | tick 764 (sled+matter) | y 1 ulp, angle 10 ulp, vy 512 ulp, w 7881299347898368 ulp | 765 | 840 | yes |
| firefox 120 Hz | airborne-tricks | tick 255 (sled) | none (sled bit-identical) | 597 | never | yes |
| firefox 120 Hz | parachute-airbrake | none | - | 523 | never | yes |
| firefox 120 Hz | kodiaks-on | tick 1698 (sled+matter) | angle 1 ulp, w 128 ulp | 586 | 1920 | yes |
| firefox 120 Hz | daily-practice-rule | tick 1087 (matter) | none (sled bit-identical) | 484 | 1320 | yes |
| webkit 120 Hz | cruise-baseline | tick 971 (sled+matter) | y 1 ulp, vx 1024 ulp, vy 1024 ulp, w 52776558133248 ulp | 972 | 1080 | yes |
| webkit 120 Hz | fifth-run-in-session | tick 829 (sled+matter) | y 1 ulp | 714 | never | yes |
| webkit 120 Hz | collision-heavy | tick 732 (sled+matter) | y 1 ulp | none | never | yes |
| webkit 120 Hz | chunk-biome-boundaries | tick 19 (sled+matter) | y 4 ulp | 24 | 120 | yes |
| webkit 120 Hz | bsod-pursuit-catch | tick 508 (sled+matter) | y 1 ulp | 522 | 600 | yes |
| webkit 120 Hz | airborne-tricks | none | - | 2054 | never | yes |
| webkit 120 Hz | parachute-airbrake | tick 696 (sled+matter) | angle 1 ulp | 709 | 720 | yes |
| webkit 120 Hz | kodiaks-on | tick 796 (sled+matter) | y 1 ulp | 877 | 2520 | yes |
| webkit 120 Hz | daily-practice-rule | tick 19 (sled+matter) | x 1 ulp, y 7 ulp, vy 4 ulp | 19 | 120 | yes |

Chromium cells not listed above are identical in every column (27 cells).

### Session-position probe (Chromium headless shell, 120 Hz, harness path: Title.startRun after force-stopping scenes (NOT the GameOver/retry flow))

Each sequence replays tape A then tape B in one page; B is compared with B as run #1 of a fresh context. The harness does not use the real GameOver/retry flow (it force-stops scenes and calls `TitleScene.startRun`). The tick-1 `matter` divergence is the `_biomeSector`/`_lastBiome` leak fixed in PR #219 (biome-mask runs only); the later `terrain`-structure differences of repeated crash fixtures are unexplained and showed no sim or outcome effect (#219 could not reproduce airborne-tricks tick 1728 on main via the real retry path).

| Sequence (run 1 -> run 2) | Run 1 ended | Run 2 first causal divergence | Run 2 TapePlayer desync | Run 2 outcome == fresh |
|---|---|---|---|---|
| cruise-baseline -> cruise-baseline | no crash (tick limit) | none | never | yes |
| fifth-run-in-session -> fifth-run-in-session | no crash (tick limit) | none | never | yes |
| collision-heavy -> collision-heavy | terrain | none | never | yes |
| chunk-biome-boundaries -> chunk-biome-boundaries | hazard | none | never | yes |
| bsod-pursuit-catch -> bsod-pursuit-catch | bsod | tick 7003 (terrain/hazards/pickups) | never | yes |
| airborne-tricks -> airborne-tricks | hazard | tick 1728 (terrain/hazards/pickups) | never | yes |
| parachute-airbrake -> parachute-airbrake | hazard | tick 968 (terrain/hazards/pickups) | never | yes |
| kodiaks-on -> kodiaks-on | hazard | tick 2150 (terrain/hazards/pickups) | never | yes |
| daily-practice-rule -> daily-practice-rule | no crash (tick limit) | none | never | yes |
| cruise-baseline -> chunk-biome-boundaries | no crash (tick limit) | none | never | yes |
| collision-heavy -> chunk-biome-boundaries | terrain | tick 1 (matter) | 120 | NO (815 m no crash vs 835 m hazard) |
| airborne-tricks -> chunk-biome-boundaries | hazard | none | never | yes |

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

### Matrix: first CAUSAL divergent tick vs the fresh reference (per engine, cadence; both sessions; each fixture at its fixed run position in the session)

A cell is `ok` when every run of that fixture in every session (including the repeat of run 1 at the end of each session) had a digest sequence identical to the reference; otherwise `FIRST_TICK subsystem(s)` (causal groups only; derived probe reads are in their own table) (the earliest across runs; `*` marks inconsistent results across runs of the same cell).

**cruise-baseline**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (4) | ok (4) | ok (4) | ok (4) |
| chromium-full-headless | ok (4) | ok (4) | ok (4) | ok (4) |
| chromium-shell-defaultgl | ok (4) | ok (4) | ok (4) | ok (4) |
| firefox | ok (4) | ok (4) | ok (4) | ok (4) |
| webkit | 971 sled+matter (4/4) | 971 sled+matter (4/4) | 971 sled+matter (4/4) | 971 sled+matter (4/4) |

**fifth-run-in-session**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | ok (2) | ok (2) | ok (2) | ok (2) |
| webkit | 829 sled+matter (2/2) | 829 sled+matter (2/2) | 829 sled+matter (2/2) | 829 sled+matter (2/2) |

**collision-heavy**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | ok (2) | ok (2) | ok (2) | ok (2) |
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
| webkit | ok (2) | ok (2) | ok (2) | ok (2) |

**parachute-airbrake**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | ok (2) | ok (2) | ok (2) | ok (2) |
| webkit | 696 sled+matter (2/2) | 696 sled+matter (2/2) | 696 sled+matter (2/2) | 696 sled+matter (2/2) |

**kodiaks-on**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 1698 sled+matter (2/2) | 1698 sled+matter (2/2) | 1698 sled+matter (2/2) | 1698 sled+matter (2/2) |
| webkit | 796 sled+matter (2/2) | 796 sled+matter (2/2) | 796 sled+matter (2/2) | 796 sled+matter (2/2) |

**daily-practice-rule**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 1087 matter (2/2) | 1087 matter (2/2) | 1087 matter (2/2) | 1087 matter (2/2) |
| webkit | 19 sled+matter (2/2) | 19 sled+matter (2/2) | 19 sled+matter (2/2) | 19 sled+matter (2/2) |

Subsystem names are the Replay Contract v1.0 names (`clock, rng, sled, matter, terrain, hazards, pickups, effects, bsod, kodiak, score, tricks, recovery`). This harness digest is coarser: its `terrain` group also covers hazard/pickup counts, `score` also covers trick counters, `world` is the whole Matter world (`matter`), `timers` is `clock`. Native names stay in the raw JSON.

### Derived probe reads (heightAt/slopeAt at the sled x; read-only, not simulation state)

Runs where the derived probe differed from the reference: 176/400 (Chromium rows here are only the session-position leak rows below); of the 152 Firefox/WebKit runs, 48 had NO causal divergence (probe-only), i.e. the sled and all other state were bit-identical. Earliest derived difference: firefox tick 14, webkit tick 14.

### Telegraph (presentation-derived, issue #155) differences

Runs where only the camera-view-derived telegraph digest differed from the reference (causal digests identical): 32. Examples: firefox/30Hz/fifth-run-in-session@1154, firefox/30Hz/collision-heavy@521, firefox/30Hz/parachute-airbrake@1117, firefox/30Hz/fifth-run-in-session@1154, firefox/30Hz/collision-heavy@521, firefox/30Hz/parachute-airbrake@1117.

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

- **chromium-headless-shell / chunk-biome-boundaries / 120 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: none. Ops that returned different results for identical arguments (vs chromium-headless-shell): none. At the divergent tick: none identified. 
- **chromium-full-headless / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: none. Ops that returned different results for identical arguments (vs chromium-headless-shell): none. At the divergent tick: none identified. 
- **chromium-shell-defaultgl / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: none. Ops that returned different results for identical arguments (vs chromium-headless-shell): none. At the divergent tick: none identified. 
- **firefox / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: tick 373 (matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (3217 ticks, first @1), hypot (673 ticks, first @1), cos (6 ticks, first @304), atan2 (105 ticks, first @427), tan (3 ticks, first @722), sin (5 ticks, first @922). At the divergent tick: hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 3431 ticks / 835 m / score 1175.
- **firefox / bsod-pursuit-catch / 30 Hz**: first state divergence in the matrix at tick 764; as run #1 of a fresh context on both sides: tick 764 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (12150 ticks, first @1), hypot (1910 ticks, first @1), cos (32 ticks, first @326), sin (36 ticks, first @375), atan2 (206 ticks, first @375), tan (3 ticks, first @1579). At the divergent tick: exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 12150 ticks / 437 m / score 0.
- **firefox / airborne-tricks / 30 Hz**: first state divergence in the matrix at tick 255; as run #1 of a fresh context on both sides: tick 255 (sled). Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2224 ticks, first @1), hypot (1897 ticks, first @1), atan2 (410 ticks, first @240), cos (39 ticks, first @255), sin (34 ticks, first @258), tan (2 ticks, first @623). At the divergent tick: hypot, cos, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 2224 ticks / 513 m / score 2428.
- **firefox / kodiaks-on / 30 Hz**: first state divergence in the matrix at tick 1698; as run #1 of a fresh context on both sides: tick 1698 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2637 ticks, first @1), hypot (1644 ticks, first @1), sin (23 ticks, first @493), cos (19 ticks, first @563), atan2 (164 ticks, first @564), tan (3 ticks, first @666). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 2637 ticks / 606 m / score 991.
- **firefox / daily-practice-rule / 30 Hz**: first state divergence in the matrix at tick 1087; as run #1 of a fresh context on both sides: tick 1087 (matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2401 ticks, first @1), hypot (1416 ticks, first @1), cos (8 ticks, first @286), sin (22 ticks, first @305), atan2 (200 ticks, first @473), tan (3 ticks, first @662). At the divergent tick: atan2, hypot, sin, exp, tan. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877867321923866, 21.67922875311475): ref 52.55738900122058 vs 52.557389001220585 (1 ulp, tick 2).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 2401 ticks / 724 m / score 1399.
- **webkit / cruise-baseline / 30 Hz**: first state divergence in the matrix at tick 971; as run #1 of a fresh context on both sides: tick 971 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (805 ticks, first @1), sin (7 ticks, first @552), atan2 (2 ticks, first @1150). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(16, 6.9634642610001265): ref 17.44963708832439 vs 17.449637088324387 (1 ulp, tick 971).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 2401 ticks / 591 m / score 876.
- **webkit / fifth-run-in-session / 30 Hz**: first state divergence in the matrix at tick 829; as run #1 of a fresh context on both sides: tick 829 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1564 ticks, first @1), tan (1 ticks, first @320), sin (5 ticks, first @487), atan2 (59 ticks, first @601). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(685.056595305723, 210.46868886553054): ref 716.6586410311708 vs 716.6586410311709 (1 ulp, tick 829).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 1801 ticks / 472 m / score 717.
- **webkit / collision-heavy / 30 Hz**: first state divergence in the matrix at tick 732; as run #1 of a fresh context on both sides: tick 732 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1439 ticks, first @1), sin (4 ticks, first @577), tan (1 ticks, first @1399). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(533.6686953810204, 128.47531104640439): ref 548.9154597733159 vs 548.9154597733158 (1 ulp, tick 732).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 1669 ticks / 289 m / score 399.
- **webkit / chunk-biome-boundaries / 30 Hz**: first state divergence in the matrix at tick 1; as run #1 of a fresh context on both sides: tick 19 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (69 ticks, first @1), tan (2 ticks, first @1890), atan2 (8 ticks, first @2534). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 3431 ticks / 835 m / score 1175.
- **webkit / bsod-pursuit-catch / 30 Hz**: first state divergence in the matrix at tick 508; as run #1 of a fresh context on both sides: tick 508 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1486 ticks, first @1), sin (4 ticks, first @1814), atan2 (306 ticks, first @2066), tan (1 ticks, first @5839). At the divergent tick: none identified. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 12150 ticks / 437 m / score 0.
- **webkit / parachute-airbrake / 30 Hz**: first state divergence in the matrix at tick 696; as run #1 of a fresh context on both sides: tick 696 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (818 ticks, first @1), sin (2 ticks, first @522), atan2 (16 ticks, first @760). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(661.3997491626651, 101.41190964944143): ref 669.1292876650841 vs 669.129287665084 (1 ulp, tick 696).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 2146 ticks / 332 m / score 790.
- **webkit / kodiaks-on / 30 Hz**: first state divergence in the matrix at tick 796; as run #1 of a fresh context on both sides: tick 796 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (2250 ticks, first @1), sin (16 ticks, first @580), atan2 (10 ticks, first @866), tan (2 ticks, first @1360). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(620.828510987958, 101.1304687620577): ref 629.0114559907145 vs 629.0114559907146 (1 ulp, tick 796).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 2637 ticks / 606 m / score 991.
- **webkit / daily-practice-rule / 30 Hz**: first state divergence in the matrix at tick 19; as run #1 of a fresh context on both sides: tick 19 (sled+matter). Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (39 ticks, first @1), atan2 (6 ticks, first @662), sin (1 ticks, first @1417). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877867321923866, 21.67922875311475): ref 52.55738900122058 vs 52.557389001220585 (1 ulp, tick 2); hypot(16, 6.956997999374835): ref 17.4470576649275 vs 17.447057664927502 (1 ulp, tick 19).
  - Counterfactual at 30 Hz stepping, run #1 of one fresh context per engine, reference side chromium-headless-shell at 120 Hz (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (patched A == patched B); the patched sim TapePlayer-desyncs from the recording at tick 120 (it is not the recorded sim); final outcome 2401 ticks / 724 m / score 1399.

### Session-position and repeat checks

**Session-position leak on Chromium**: 24 Chromium runs diverged from their fresh-context reference although engine and cadence were identical. Examples: chunk-biome-boundaries as run #4 @tick 1 (matter).
Per engine, cadence and fixture, both fresh sessions gave one identical digest roll, and the repeat of fixture 1 at run #10 matched run #1. (Session position effects are measured against the fresh-context reference above, not by this line.)

Rows: 400 (400 ok, 0 errors). Raw JSON: `docs/determinism/results/cross-engine-results.json`. Generated 2026-11-22T14:11:13.262Z from commit 26eb0b0a5937ad4fb1a51cc318fd9b4d08ace137.
<!-- END GENERATED -->
