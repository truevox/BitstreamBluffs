# Simulation / presentation causal isolation (issue #140)

Status: diagnostic evidence, Team B, 2026-11-21/22, base `b51ab36`, merged with `origin/main` at `9c928ee`. The digest used
here is a **test tool and is non-authoritative**. Replay Contract v1.0 (#152) and the `fingerprintState` of #165 (now on
main) are authoritative. Nothing in `src/` imports the digest.

## Verdict

For a fixed per-tick input tape, the sim's authoritative state was **bit-identical on every tick** under all of
these changes: render cadence (30, 60, 120 and 144 Hz, plus a jittery 4-45 ms schedule), camera zoom, scroll and
shake, particles (off or flooded), audio (muted, absent, no `AudioContext`, every call throwing), viewport size,
aspect ratio and DPR (including resizes mid-run), the HUD scene stopped, pause/resume, and reduced-motion /
screen-shake settings changed mid-run. The authoritative state covers sled compound pose and velocity (all 6
parts), the physics/scramble RNG, Matter world membership **and order**, contact warm-start impulses, terrain
chunks, hazards, pickups, shards, Kodiaks, score, BSOD, crash and timers.

The matrix found three real problems and all three are fixed:

| # | Leak | Effect | Fix |
|---|---|---|---|
| L1 | **Palette / colour-blind toggle mid-run** (Pause > Settings) rebuilt every live terrain collider | Sled pose, Matter world order and contact pairs diverged from the next tick (301 after a toggle at 300) on all 4 fixtures. Kodiak and score state followed | `TerrainMesh.redrawChunk` repaints graphics only; the palette setting uses it |
| L2 | **A throwing audio engine** froze the game | `renderFrame` read `audio.getWorldDanceSample()` unguarded. Phaser's RAF step reschedules only after the frame callback returns, so one throw stopped the loop and the simulation | `WorldDance.readWorldDanceAudio` never throws (warns once); the jukebox/billboard reads in `create` and the track-change handler are guarded too |
| L3 | **Biome-sector entry** repainted through the same collider rebuild as L1 (deterministic, but a repaint feeding physics) | `biome` fixture: a twin with the biome repaint stubbed out diverged at the **entry tick 398** (world order, terrain colliders; contacts from 496) | **Owner-approved physics change**: `refreshPalette` always uses `redrawChunk`; `SIM_REVISION` 1 → 2 (below) |

One known camera read is detected and left to its own issue:

| # | Read | Effect today | Owner |
|---|---|---|---|
| K1 | `updateGroundTelegraph` passes `this._view.right` (the rendered camera, one frame stale) to `planTelegraph` | **Only** the `onScreen` flag of telegraph marks differs, and only the renderer reads it. Warn/hop SFX, `teleAtMs`, crash-report arrival and all physics are camera-independent. Seen in 11 matrix cells (zoom, shake, 30 Hz, jitter) | #155 (not fixed here); `tests/determinism/telegraph-camera-independence.test.js` holds an expected failure that flips when #155 lands |

## Method

- **Real built game** (`npm run build` + `vite preview`), headless Chromium (SwiftShader WebGL), one fresh page per
  run. `RunScene.update` is held until the scene exists, the loop sleeps, and frames are stepped with
  `game.step(t, dt)`.
- **Per-tick input tape.** The probe installs a tape as `run.tapePlayer` (the ghost-replay hook), so every tick
  sees the same pad whatever the display rate. This separates "render cadence changes how many ticks run per frame"
  (allowed) from "presentation feeds the sim" (a leak). Frame-granular input, which is #115's territory, runs as
  separate `*-polled` cases, report only.
- **Digest after every `simTick`**: `tools/conformance/causal-digest.mjs`. Subsystems fall into three classes:
  - *authoritative*: `sled, rng, world, contacts, terrain, hazards, powerups, shards, kodiaks, score, bsod, crash, timers`;
  - *cue*: gameplay information shown to the player that is not physics: `telegraph, sfx` (scene `playSfx` calls
    inside the tick), `events` (game events emitted inside the tick, wall-clock fields masked), `crashReport`, `glitch`;
  - *cache*: `terrainCache` (generator chunks that cosmetic `heightAt` reads may build early; allowed).
- **Verdicts**: `isolated`, `cue-leak` (only cues differ), `causal-leak` (an authoritative subsystem differs).
  The report gives the first divergent tick and its subsystems, plus a field-level diff at that tick.
- **Positive control** `control-physics-nudge` adds 1e-9 px/step to the sled's velocity at tick 300. It is caught as a
  causal leak at tick 301 on every fixture, at the 1e-13 px level in pose and 1e-10 in velocity. Jest tests pin
  1e-12 sensitivity and world-order sensitivity.

### Fixtures (`FIXTURES` in the probe)

| Fixture | Seed / setup | Exercises | Baseline outcome |
|---|---|---|---|
| `tricks` | `RPLAY59`, scramble on all run, 1200 ticks | hops, helicopter spin, flips, parachute + air brake in the air, tuck; physics/scramble RNG drawn every tick | 555 airborne ticks, score 520 |
| `hazards` | `RPLAY59` from x=50 000, 1200 ticks | biome hazard hit (brace), ground telegraph warn SFX | score 4227 |
| `kodiak` | `BEAR0`, Sync Level 6, 450 m credit | Kodiak pack spawn, telegraph, pass, crash | crashed (hazard) at tick 978, 4 Kodiak events |
| `bsod` | `BSOD140`, wall 260 px behind | BSOD pursuit, wind, catch | caught (`bsod`) at tick 1155 |
| `biome` | `BIOME140@4294967295` (all biome bits), sled 1500 px before the first biome sector boundary (x=30 000) | biome repaint mid-ride, under the sled | enters the biome at tick 398, score 2272 |

Every page runs with `Date` shifted to a fixed day (`FIXED_DATE`, default 2026-11-21T12:00Z; it still advances).
Non-daily runs play *today's* daily rule (`DailyPatch.getDailyInfo()` reads the clock), and without the pin the
`bsod` fixture stopped ending in a catch after midnight UTC. That is a known wall-clock input (Replay Contract v1 C-list,
manifests record `dailyRuleId`), not a presentation leak.

## Matrix (head build, after all fixes)

Game code at `bf84bd4` (after the merge with main and the L3 fix), 91 cells, `EXPECT_ISOLATION=1` gate passes (exit 0):
**72 isolated, 11 cue leaks (all K1 telegraph `onScreen`, allow-listed), 8 causal = the 5 positive controls + 3
frame-polled input cases (#115)**. No presentation perturbation changed any authoritative subsystem. The other four
fixtures gave exactly the same cells as the first head run at `71836d8`.

Cells give the verdict against the fixture's 60 Hz per-tick baseline; `tele@N` means a cue leak in `telegraph` first
at tick N (K1, #155). Fixtures other than `tricks` run the core set (`-` = not run).

| Perturbation | tricks | hazards | kodiak | bsod | biome |
|---|---|---|---|---|---|
| baseline repeat | isolated | isolated | isolated | isolated | isolated |
| cadence 30 Hz | isolated | isolated | tele@739 | isolated | isolated |
| cadence 120 Hz | isolated | - | - | - | - |
| cadence 144 Hz | isolated | isolated | isolated | isolated | isolated |
| cadence jitter 4-45 ms | isolated | tele@443 | tele@739 | isolated | isolated |
| camera zoom 0.5 | isolated | tele@401 | tele@697 | isolated | isolated |
| camera zoom 2 | isolated | tele@445 | tele@739 | isolated | isolated |
| camera scroll +700/-250 | isolated | - | - | - | - |
| camera shake every frame | isolated | tele@439 | tele@737 | isolated | isolated |
| screen shake off | isolated | - | - | - | - |
| Fx off (fx + trail) | isolated | - | - | - | - |
| Fx storm (extra `visual/fx` draws) | isolated | isolated | isolated | isolated | isolated |
| audio muted | isolated | - | - | - | - |
| audio absent | isolated | isolated | isolated | isolated | isolated |
| audio throwing (from mid-run) | isolated | isolated | isolated | isolated | isolated |
| no `AudioContext` | isolated | - | - | - | - |
| viewport 1920x1080 | isolated | - | - | - | - |
| viewport 390x844 DPR 3 | isolated | - | - | - | - |
| resize mid-run (3 sizes) | isolated | isolated | isolated | isolated | isolated |
| HUD scene stopped | isolated | isolated | isolated | isolated | isolated |
| pause + 30 frames + resume | isolated | - | - | - | - |
| reduced motion / shake off mid-run | isolated | - | - | - | - |
| palette toggle mid-run | isolated | isolated | isolated | isolated | isolated |
| combo (jitter + 390x844 DPR 2 + zoom 0.6 + shake + Fx + no audio + no HUD + resize) | isolated | tele@422 | tele@715 | isolated | isolated |
| positive control (1e-9 nudge) | **causal@301** | **causal@301** | **causal@301** | **causal@301** | **causal@301** |
| biome visuals frozen (repaint stubbed; L3 check) | - | - | - | - | isolated (was causal@398) |

### Before the fixes (same probe; palette row on the unmodified game code at `db4cae8`, audio row at `94e8cf6`, biome row at `f9df088`)

| Perturbation | tricks | hazards | kodiak | bsod | biome |
|---|---|---|---|---|---|
| palette toggle mid-run (tick 300) | causal@301: sled, world, contacts, terrain, score; bsod@303 | causal@301: world, contacts, terrain | causal@301: sled, world, contacts, terrain, kodiaks; score@305, crash report@978 | causal@301: sled, world, contacts, terrain, score; bsod@304 | - |
| audio throwing (from mid-run) | **game loop stopped** (`audio down getWorldDanceSample` escaped `game.step`) | - | - | - | - |
| biome visuals frozen (`biome` fixture only) | - | - | - | - | causal@398 = biome-entry tick: world order, terrain colliders; contacts@496 |

At tick 301 the palette divergence is small: the sled's x moved by 2e-13 px, and the world order changed because
the colliders were re-added. It is still a real fork. The pairs under the sled lose their warm-start impulses, and
the divergence spreads into the Kodiak pack and score. Within these 10 s windows the integer score and the crash
tick stayed the same. The practical failure: a ghost tape recorded live through a mid-run palette toggle would fail
`TapePlayer.check` at its next exact checkpoint, because the toggle is not part of the tape.

### Input sampling (#115, report only)

| Case | Compared with | Result |
|---|---|---|
| 60 Hz polled | per-tick tape | diverges at tick 312 (sled, contacts, score, bsod). Frame sampling holds the hop edge's `hop` for both ticks of the frame, and the per-tick tape for one |
| 30 Hz polled | 60 Hz polled | identical (every tape edge falls on a 30 Hz frame boundary) |
| 144 Hz polled | 60 Hz polled | diverges at tick 312 |
| jitter polled | 60 Hz polled | diverges at tick 312 |

This is the frame-to-tick fan-out (`SimClock.padsFor`), which belongs to #115. With a fixed per-tick tape, cadence has no effect.

## Version handling for L3 (Replay Contract v1 §7.2)

- `SIM_REVISION` 1 → 2 (`src/systems/replay/ruleset.js`). `LAST_RELEASED_SIM_REVISION` is still 0, so the contract
  would also have allowed a `behavior-change-unreleased:` attestation without a bump. The owner asked that old
  recordings fail visibly rather than desync silently, so the revision is bumped.
- New ruleset archived: `sha256:477b227b38f0221439af2fec4b26a30bcb7050ec99c0832e08a023813bfe6e55`
  (`tools/ruleset/current.json`). The source tripwire is attested `sim-revision-bumped`, and `build-ruleset.mjs --check` is clean.
- Manifests recorded under revision 1 resolve to the archived revision-1 ruleset. `resolveVerifier` then refuses them
  as `historical-verifier-required` instead of reporting a `diverged` replay.
- `GHOST_PHYSICS_VERSION` stays 1, because §7.2(3) says it is not bumped further. Legacy ghost tapes keep §5.3 outcomes
  (`consistent-with` / `inconclusive-legacy`, never "verified"). Ghost riders draw from the recorded trace and are unaffected.
- Two #165 review tests (`tests/replay/fingerprintReview.test.js`) pinned the old rebuild. They now pin the repaint
  keeping colliders: the same pad sensor with its cooldown intact, an unchanged `staticOrder`, and fingerprints equal to a
  twin that never repainted.
- Golden canaries (#117): `hazard-transition` (mask 4, crosses a biome boundary) and `bump` were re-recorded on the new
  build. Both are exact PASS against the committed goldens (`feel-diff --use-out`). The other five are mask 0 and never repaint.
- Biome gameplay is data and is unchanged. Zone mods come from `getZoneDefs` → `PhysicsTuner`, hazards and pickups from
  `takeChunk`, and collider material is fixed in `TerrainMesh._takeBody`. A repaint only ever changed body identity and order.

## Other observations

1. **Biome-entry repaint (L3), fixed with owner approval.** See "Version handling" below.
2. **BSOD Gym READY can wait up to 300 ms for a music beat** (`gymBeatSuggestion`, `RunScene.update`). **Owner decision
   (2026-11-21): intended and accepted** as a deliberate audio-to-sim path. It is Gym only (unranked, never taped).
3. **`settings.controlLayout` mid-run** changes `normalizePad` (`variableHop`, `noAutoNudge`). **Owner decision
   (2026-11-21): a gameplay setting recorded in tapes (pad bits), not a presentation leak; nothing to fix.**
4. **Cosmetic terrain reads** (minimap, Fx ground tests, hazard drawing) can build generator chunks early.
   `streamTerrain` gates their physical insertion (#59). The `terrainCache` class allows this, and no matrix cell
   showed it.
5. **Guardrail audit (owner comment, 3D readiness).** All camera reads in the sim path were checked. Only K1 reads
   the rendered camera inside `simTick`. `renderFrame`'s hazard, pickup, shard and mesh culling and `KodiakRider`
   use `_view` for visibility only, and the matrix confirms that.

## Mapping to Replay Contract v1 subsystems

| This digest | Contract v1 (`FP_SUBSYSTEMS`) | Note |
|---|---|---|
| `tick`, `timers.runTimeMs` | `clock` | |
| `rng` | `rng` | same field (`physicsScramble.state`) |
| `sled` | `sled` | subset (pose/vel of all parts + controller timers) |
| `world`, `contacts` | `matter` | **stricter**: absolute body ids and world order are hashed here; the contract excludes ids |
| `terrain` | `terrain` | |
| `hazards` | `hazards` | |
| `powerups`, `shards` | `pickups` | |
| `timers` (effects part) | `effects` | |
| `bsod` | `bsod` | |
| `kodiaks` | `kodiak` | includes per-bear RNG state |
| `score` | `score` | |
| `crash` | `recovery` (partly) | |
| `telegraph`, `sfx`, `events`, `crashReport`, `glitch` | not hashed (presentation, section 6.1) | kept as *cue* class here |

Without ids, L1 would still show in the contract's `sled` and `matter.pairs` (lost warm-start impulses), as
`tricks`, `kodiak` and `bsod` show.

## Limitations

- Chromium only (SwiftShader). Firefox and WebKit are not covered here; they belong to #120 / #161.
- Five fixtures of 8-12 s each. There is no Gym and no ghost riders on screen.
- The browser matrix is manual (not wired into CI or `npm test`). Only the Jest pieces gate regressions in CI-less runs.
- Headless audio: `AudioContext` exists, but it is not tied to a real output device's clock.
- Viewport changes go through Phaser's FIT scaling. The camera works in fixed logical units (960x540), so the
  viewport cannot reach `_view`. That is why viewport cells are expected to be isolated.
- The digest is diagnostic. 32-bit FNV per subsystem per tick is fine for honest divergence and not meant for anything adversarial.

## Running it

```sh
npm run build
npx vite preview --port 8411 --strictPort &
GAME_URL=http://localhost:8411/ RESULTS=cells.json node tools/conformance/causal-isolation-probe.mjs
# options: FIXTURES=tricks,bsod  CASES=camera-zoom-2,cadence-144  OUT=matrix.json  PARALLEL=3
#          EXPECT_ISOLATION=1  (exit 1 on: no result, page errors, a stalled or short run, a length mismatch, a causal leak
#                               outside the #115 cases, a missed positive control, or a cue leak other than K1 telegraph)
#          FIXED_DATE=2026-11-21T12:00:00Z  (the wall-clock day the pages see)
#          RESULTS=cells.json  (each finished cell is saved at once, keyed by build; reruns skip finished cells)
#          CHROMIUM_PATH=...  (defaults to the image's headless shell when Playwright's build is missing)
npm test -- tests/determinism
```

A full run is about 95 browser runs, roughly 45 minutes on a loaded 4-way container.
