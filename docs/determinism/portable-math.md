# Portable deterministic math (issue #121)

**Status: implemented (Phase B, owner decision "option A": make every authoritative transcendental portable). Phase A evidence follows in sections A1 to A6 and is kept as history.**
Digests used as evidence are diagnostic and non-authoritative; they are to be replaced by the Replay Contract (#152) fingerprints.

## B1. What shipped

* `src/systems/pmath.js`: the single import point for `sin cos tan asin acos atan atan2 exp expm1 log log1p log2 log10 pow hypot tanh sinh cosh cbrt`, a thin facade over the exactly pinned, Apache-2.0 `@stdlib/math-base-special-*` packages (library evaluation in B2; the hand-written fdlibm port described in A4 was removed, last present at commit `f47e8579`).
* Every authoritative simulation file uses it: `Sled`, `Hazard`, `TerrainMesh`, `RunScene` (the mixed files are entirely on pmath), `PhysicsTuner`, `TerrainGenerator`, `TerrainContact`, `BsodAerodynamics`, `BsodPursuit`, `ScoreManager`, `ShardMagnet`, `TrickTracker`, `BiomeEffects`.
* **Boundary** (`tests/determinism/sim-math-boundary.test.js`, an allowlist): in every `src/` file except an explicit presentation list, each use of `Math` must be `Math.<member>` for an exactly-specified member (`abs floor ceil round trunc sign min max sqrt imul fround clz32 PI E LN2 LN10 LOG2E LOG10E SQRT2 SQRT1_2`), and `**` may only combine two integer literals. Everything else fails, whatever the syntax: calls, destructuring (with or without a semicolon), aliasing (`const M = Math`), bracket access, optional chaining, `globalThis.Math`, `Phaser.Math`, passing `Math` as a value, `Math.random`, `x ** 0.5`, `x ** 2`. The scanner has negative fixtures for every one of those bypasses (19 cases) and positive ones. The presentation list (backgrounds, audio, UI, menus, markers, telegraph drawing, music processors, `PauseScene`) is exempt as a whole except for files that are also causal tripwire files (`PowerUp.js`, `Shard.js`): there each native call must sit on a line carrying a `pmath-exempt: draw-only` comment, so an edit that feeds native math into a body or collection position is caught. Runtime check (`attribution.mjs`, unminified build, two fixtures): after the change the only native transcendental calls made inside `simTick` are audio (`bsodThreatParameters`, `AudioSynth`) and `Fx` particles, none from a sim file, none from Matter, and none outside `simTick` from a sim file.
* `src/systems/MatterPortable.js`: replaces the nine Matter functions that use trig/pow/acos on the shared Matter module objects at `RunScene.create` (next to `installTerrainContactFix`, before any body is built): `Axes.rotate`, `Vector.rotate`, `Vector.rotateAbout`, `Vector.angle`, `Vertices.rotate`, `Vertices.chamfer` (acos and `pow(r, 0.32)` / `pow(r, 2)` included, so the sled's chamfered deck and torso are portable), `Bodies.polygon`, `Body.rotate`, `Composite.rotate`. Bodies are line-for-line copies of Phaser 3.90.0's Matter with only the Math calls swapped; nothing is forked. `phaser` is now pinned exactly (`3.90.0`) in `package.json`. `tests/determinism/matter-portable.test.js` asserts `Phaser.VERSION === '3.90.0'`, exact pins in `package.json` and the lockfile, an exact per-file count of every transcendental call in Phaser's whole `matter-js` folder (so a Phaser change fails the test), idempotent install, and a contract check of every replaced function against the original. One more native call exists in Phaser's `poly-decomp` (`collinear()`, `Math.acos`): it is only reached by `Bodies.fromVertices` on a concave shape, which the sim never builds (the only caller is `TerrainMesh`, with 4-vertex trapezoids that are always convex; `sim-math-boundary.test.js` pins the call site and checks that generated terrain has strictly increasing x everywhere). Phaser's `Force.js`/`MatterPhysics.js` thrust helpers use native trig too and are never called (also scanned).
* `SIM_REVISION` is **5** (main was at 4 after #47, #160 and #222 canonical colliders; `LAST_RELEASED_SIM_REVISION` 5 as in those releases), release v2.19.12, ruleset `sha256:90fd71ffc90edcc62c8e0b64bb5ce125c743aab8c8ef83811b8daa4c814778a9`, tripwire re-attested (`sim-revision-bumped` for the math source; a later `no-behavior-change` for the v2.19.11 stable-id merge delta), `src/systems/MatterPortable.js`, `src/systems/pmath.js` and the lock manifest added to the tripwire list, and the first two registered as causal ruleset sources with no data (like `terrainContact`). **Merge-order rule (applied):** #222 merged first with revision 4 and the same `rulesetId` this PR originally had for different physics (the id is data plus `SIM_REVISION`; `canonicalBytes` stays 22,745), so this PR took revision 5 and the next free patch. Later it was merged with the released v2.19.11 stable-hazard-id source (#224) at v2.19.12; that merge adds identity keys and JSON snapshot hooks in `RunScene`/`HazardTelegraph` but moves no top-level causal constant, so revision 5's ruleset identity is unchanged and the v2.19.7 revision-4 archive `sha256:89e2cdab…` stays untouched. Any later physics-breaking PR takes 6 and sets `LAST_RELEASED_SIM_REVISION` the same way.
* Library identity (no contract change): the ruleset document does not include the math library, so `src/systems/pmath-stdlib-lock.json` records every `@stdlib` package in the lockfile closure (182: name, exact version, sha512 integrity, with a digest), derived by `tools/determinism/portable-math/stdlib-lock.mjs`. It is a **source-tripwire file** (added to `TRIPWIRE_FILES`), so a lockfile refresh that moves any kernel changes a tripwire file and demands an attestation. `tests/determinism/pmath-lock.test.js` asserts the 19 direct pins are exact in `package.json` and the lockfile, that every package in the closure has an exact version, integrity and registry URL, that the committed manifest equals a fresh derivation from the lockfile, and that every package the code can reach at runtime (found by following its `require`s, 94 packages) is in the closure and installed at the locked version. The golden-hash test (`docs/determinism/results/portable-math-golden.json`, run in four runtimes) is the behavioural backstop. The concrete `engine.pmath` proposal for #152 is the same list (all reachable packages with version and integrity), derived from the lockfile the way `engine.phaser` is. `pmath.js` and `MatterPortable.js` are registered as causal ruleset sources with no data (`pmath`, `matterPortable`, like `terrainContact`), not as non-causal modules; the ruleset id is unchanged by that.
* Terrain generation changes in the last bits too (it uses tan/atan2/hypot/cos): 9.9% of the numbers in 20 seed/mask pairs x 300 chunks differ, at most 8.7e-11 px (6e-16 relative), **zero structural differences** (`terrain-delta.mjs`). Digests pinned in `micro-swell-isolation`, `biome-slot-rule` and `terrain.test.js` were re-pinned once for that reason; the first two headers now state the new anchor (#121) and the tolerance comparison (max 1.2e-10 px, zero structural differences) that justifies it, and say not to re-pin without redoing it.

## B2. Library evaluation: @stdlib versus our own fdlibm port

Decision rule (owner): if stdlib passes, use it. **All 19 functions pass, no per-function fallback was needed.** Packages (all Apache-2.0, exact pins): `-sin 0.3.1, -cos 0.3.1, -tan 0.3.1, -asin 0.2.4, -acos 0.2.4, -atan 0.2.4, -atan2 0.3.1, -exp 0.2.5, -expm1 0.2.4, -ln 0.2.5 (our `log`), -log1p 0.2.4, -log2 0.3.1, -log10 0.3.1, -pow 0.3.1, -hypot 0.2.4, -tanh 0.2.4, -sinh 0.2.4, -cosh 0.2.4, -cbrt 0.2.3`. Reproduce: `tools/determinism/portable-math/stdlib-eval/run.mjs`; raw data `docs/determinism/results/portable-math-stdlib-eval.json`.

| Criterion | Result |
|---|---|
| Purity | The 19 entry points reach 94 packages / 226 files. No native transcendental `Math.*` anywhere in them; the only Math used is `floor abs sqrt round ceil` (exactly specified). `**` appears only in comments. `global` appears only in error-message formatting. Endianness is detected (`os-byte-order`) and both branches compute the same thing. No FMA/extended-precision reliance (not expressible in JS). 182 packages get installed (all Apache-2.0, no install scripts); the non-@stdlib ones (`debug`, `resolve`, ...) are pulled by unreachable tooling packages and are not bundled. |
| Cross-engine determinism | Golden hashes (all 19 functions x 4000 fixed inputs plus special values, `golden.cjs`) identical in **Node, Chromium, Firefox and WebKit**; the same for the final `pmath` facade bundle (`engines.mjs`) |
| Accuracy vs host V8 | 8 of 19 are 100% bit-identical to V8 over 40,000 random arguments (tan, exp, expm1, log, log1p, log2, cbrt, hypot); sin 99.1% and cos 99.0% identical, atan 97%, the rest 75 to 98%; worst case is 2 ulp (atan2, log10, tanh, sinh, `pow(x,3)`). Our port was 85% for sin/cos and up to 4 to 8 ulp for tanh/sinh/expm1/non-integer pow |
| Large arguments | stdlib uses Payne-Hanek: `sin(1e22)` equals V8 bit for bit. Our port returned 0 there and was 1e-2 off at 1e15 |
| Cost at the real in-simTick op mix (103 calls/tick, in-page, 31 interleaved reps) | native / our port / stdlib in us per tick: Chromium 3.84 / 5.52 / **2.75**, Firefox 1.95 / 4.40 / 4.15, WebKit 1.30 / 2.30 / 1.80 |
| Bundle (standalone esbuild) | stdlib 85.7 KB min, 21.6 KB gzip, vs our port 6.9 KB min, 3.0 KB gzip. In the real Vite build the game bundle goes from 2,276,346 B (596,107 B gzip) to 2,485,576 B (621,386 B gzip): **+209 KB raw, +25.3 KB gzip (+4.2%)** |
| Licence, pins | Apache-2.0; exact versions in `package.json` (`devDependencies`, like `phaser`) and `package-lock.json` |

Side effect that matters: because stdlib is bit-identical to V8 for 8 functions and 99% for sin/cos, the new simulation stays very close to the native-Chromium physics (about 1% of sin/cos results and about 10% of terrain numbers differ in the last bit).

## B3. Cross-engine evidence (the fix)

**Archived final run (main after #222, SIM_REVISION 5, pre-#224, v2.19.8 heading):** the 24 tapes were re-recorded on that build and replayed in fresh contexts on Chromium, Firefox and WebKit: causal digests identical in **24/24**, outcomes equal 24/24, 0 TapePlayer desync, max position delta 0, 77,553 ticks per engine (`docs/determinism/results/portable-math-results-merged-v2.19.8.json`; a 3-fixture spot check on the merged build before the re-record was also 3/3 identical). These numbers predate the v2.19.11 stable-id hazard source (#224); they are historical evidence, **not** a fresh verification of the v2.19.12 combined source. The detailed tables below are from the pre-#222 build (two runs plus the main comparison), where the tapes had 77,762 ticks per engine.

**v2.19.12 combined-source re-verification (this takeover, `friday/209-takeover-v21912`, merge of `origin/main` `81032df`):** on the combined source (released v2.19.7 SIM_REVISION 4 canonical colliders + v2.19.11 stable-id `TelegraphTracker` + this portable math, one SIM_REVISION 5 identity `sha256:90fd71ff…`) 7 representative committed tapes were replayed in fresh contexts on Chromium and Firefox (Firefox headed under Xvfb) through the real built game: causal digests identical **7/7**, outcomes equal **7/7**, max sled position delta **0**, 0 desync on the tapes that record checkpoints (`cruise-baseline`, `collision-heavy`, `chunk-biome-boundaries`, `kodiaks-on`, `airborne-tricks`, `broad-allbiomes`, `bsod-pursuit-catch`; 33,580 ticks/engine). This is the diagnostic `experiment.mjs run native` harness (`native` applies no in-page patch, so it measures the shipped pmath build), not the committed re-record corpus; it is a spot check on the combined source, not a 24/24 replacement. **WebKit was not run in this takeover:** the shared Playwright cache has no WebKit and the downloadable build needs GTK4/GStreamer system libraries that are not installed and were not added. Real Safari/iOS/ARM also remain untested. The #224 hazard restore contract was re-verified here on the combined source: `tools/savestate-experiment` `hazard:full`, K=480→1000, 520 post-save ticks, `firstDivergentTick=null`, `maxSledPosErrPx=0`, `audit=[]`, 3 live hazards (2 moving), pool 0.

24 fixture tapes (the 9 #120 fixtures plus 15 broader ones: other seeds, single-biome masks 1/2/4/8/16/64, all-biome mask, reckless, tricks, parachute, BSOD, Kodiaks, a daily seed; up to 9,000 ticks), re-recorded in Chromium with this build (`experiment.mjs record`; live recording equals fresh-context replay with no TapePlayer desync), then replayed in a fresh context per cell on Chromium, Firefox 159 (headed under Xvfb) and Playwright WebKit 27.2 (not Safari): 77,762 ticks per engine, 18 of 24 runs end in a crash, the rest at the tick cap.

| Build | fixtures with identical causal digests on all 3 engines | outcomes equal | TapePlayer desync | `terrain` group divergence | max sled position delta |
|---|---|---|---|---|---|
| this PR, run 1 (`native`) | **24 / 24** | 24 / 24 | 0 | 0 | 0 |
| this PR, run 2 (`native-rep2`, new contexts) | **24 / 24** | 24 / 24 | 0 | 0 | 0 |
| main `b5b969dc` (native Math), same 24 tapes | 6 / 24 (Firefox diverges in 12, WebKit in 15) | 24 / 24 | 30 of 72 cells (the tapes were recorded on the portable build, so native-math checkpoints drift) | 42 of 48 Firefox/WebKit cells | 10.8 px (chunk-biome, WebKit); others below 1e-3 px |

So before the fix 18 of 24 runs differ somewhere in causal state on at least one engine (mostly last-bit noise that never changes the outcome on these tapes; the one recorded real outcome fork in Phase A was Firefox `chunk-biome-boundaries`), and after it none do, over 466,000 engine-ticks. Claims stay corpus-level: no real Safari/iOS, no ARM, one Chromium major, 120 Hz stepping only. `tools/determinism/portable-math/fixtures/` holds the tapes, `docs/determinism/results/portable-math-results.json` the per-fixture rows.

## B4. Cost in real runs (before / after, same fixtures, interleaved fresh contexts, 5 reps each)

Median `RunScene.simTick` ms per 120 Hz tick, main `97ba4f5c` (v2.19.1, measured before the last merge) vs this PR (`docs/determinism/results/portable-math-perf-*.json`):

| Engine | cruise-baseline | airborne-tricks | broad-allbiomes (7,123 ticks) |
|---|---|---|---|
| Chromium | 0.237 to 0.218 | 0.234 to 0.240 | 0.164 to 0.157 |
| WebKit | 0.217 to 0.243 | 0.263 to 0.278 | 0.198 to 0.207 |
| Firefox | 0.260 to 0.318 | 0.306 to 0.301 | 0.229 to 0.239 |

Chromium is flat (differences inside run-to-run range), WebKit about +0.01 to +0.03 ms, Firefox up to +0.06 ms on one fixture (ranges overlap in most cells). The worst observed delta, +0.059 ms/tick, is 0.7% of the 8.33 ms tick budget, and the controlled micro-benchmarks above bound the op cost at +1 to +18 us/tick. Perf is not a decision factor.

## B5. Tests

Full `npm test` (after merging main v2.19.5): 227 suites pass, 7 fail (9 tests: `env-detection`, `memory-usage`, `terrain-interaction`, `multi-chunk-terrain`, `input-playback`, `combo-scoring`, `start-scene`), the same 7 that fail on main. New suites: `tests/determinism/pmath.test.js` (ulp bounds, special values, large arguments, golden hashes), `matter-portable.test.js`, `sim-math-boundary.test.js`.

---

# Phase A (historical): evidence and recommendation before the owner decision

**Note: sections A1 to A6 describe the Phase A experiments with a hand-written fdlibm port that was later replaced by @stdlib (B2); numbers about "our port" refer to it. "Native Math" runs there are the pre-#121 game.**

Setup: built game at `b51bee72`, nine #120 fixture tapes (recorded once in Chromium, replayed unchanged), 120 Hz stepping, page clock offset-pinned (`Date.now()` starts at 2026-11-21T12:00Z and then advances with real time; it is not frozen, which is harmless for runs of seconds),
Chromium headless-shell 157 (SwiftShader), Firefox 159 (headed under Xvfb), Playwright WebKit 27.2 (not Safari). One cell = (config, engine, fixture);
the full matrix cell cache is `tools/determinism/portable-math/.cache` (not committed); summaries: `docs/determinism/results/portable-math-*.json`.
Tooling: `tools/determinism/portable-math/` (`experiment.mjs run|report|perf`, `attribution.mjs`, `accuracy-bench.mjs`, `tick-mix-bench.mjs`,
`wasm-boundary-bench.mjs`, `engines.mjs`, `golden.cjs`, prototype `portable-math.cjs`) and the Jest test `tests/determinism/portable-math.test.js`.

## A1. Inventory of non-IEEE-exact Math on the authoritative path

`+ - * / sqrt` are IEEE-exact. Static: `src/` has ~290 call sites of `sin cos tan atan2 exp log log1p log2 pow hypot tanh`; most are presentation
(Background, Hazard drawing, Fx, UI, audio). Dynamic, measured by replaying all nine fixtures (30,860 ticks) with counting wrappers, calls made
**inside `RunScene.simTick`** per tick: sin 39.8, cos 39.2, hypot 13.0, atan2 6.2, exp 3.2, pow 1.2, tan 0.25, tanh 0.09, log 0.05 (about 103 calls/tick;
`log1p` once at BsodPursuit construction; `atan`, `asin`, `acos`, `cbrt` never **inside simTick**). Outside simTick, at body construction, `Sled._buildBody` calls Matter's `Vertices.chamfer` for the deck and torso (`Sled.js:108-109`), which uses `Math.acos` and `Math.pow(r, 0.32)` (and `Bodies.polygon`, `Vector.rotate` use cos/sin); those run before tick 1 and are part of the authoritative initial state. The page also makes 16.5 M `sin` calls over the corpus (Background and other presentation).

Call-site attribution (unminified dev build, `collision-heavy`, `attribution.mjs`; results in `portable-math-attribution-collision-heavy.json`):
* **Phaser's bundled matter-js does use transcendentals on the sim path**: `Axes.rotate`, `Vertices.rotate`, `Vector.rotateAbout`, `Vector.angle`
  (and, at body construction, `Vector.rotate`, `Vertices.chamfer` (pow, acos), `Bodies.polygon`, `Body.rotate`, `Composite.rotate`). They account for
  about 83% of in-simTick sin/cos calls and 18% of atan2 calls. Matter has no `exp`, `hypot`, `tanh`, `log`.
* `src/` sim callers: `Sled.js` (hypot, exp, cos/sin of slope, `log` in air-brake decay), `PhysicsTuner.js` (atan2, exp, cos/sin), `TerrainContact.js` (hypot, cos),
  `ShardMagnet.js` (hypot), `BsodAerodynamics.js` (pow, tanh), `BsodPursuit.js` (log1p), `TrickTracker.js`, `RunScene.js`, `TerrainGenerator.js` (tan, atan2, hypot, cos; runs at chunk build, **outside simTick**),
  `Sled._buildBody` (Matter construction, outside simTick), `ScoreManager` (pow).
* Not on the sim path though they call Math: camera (`RunScene.updateCamera` exp), `Sled.render`, hazard drawing (`hash01` uses `sin(x)*43758`, visual only), audio, UI.
  Read-only probes outside simTick (`Sled.speed` getter, `TerrainGenerator.slopeDegAt` atan2) feed the `terrain` digest group and the ground telegraph, not causal state.

## A2. How much do engines really diverge today (native Math)?

Chromium is the reference; two independent fresh-context sessions per engine (`native`, `native-rep2`) gave identical results, so the divergence is reproducible, not flaky.

| Native, causal state vs Chromium | Firefox 159 | WebKit 27.2 |
|---|---|---|
| fixtures with any causal divergence | 5 / 9 (first ticks 255, 373, 764, 1087, 1698) | 8 / 9 (first ticks 19 to 971; `airborne-tricks` clean) |
| TapePlayer checkpoint desync | 4 / 9 | 6 / 9 |
| final outcome (ticks, crash cause, distance, score) equal | 8 / 9 | 9 / 9 |
| max sled position delta over the run | 0 to 7e-9 px in 8 / 9 | 0 to 8e-6 px in 9 / 9 |

* Divergence is last-bit noise that mostly never amplifies: in 17 of the 18 cells the largest sled position error over the whole run is below 1e-5 px and the outcome is identical.
* **One real fork**: `chunk-biome-boundaries` on Firefox diverges causally at tick 373 (`world`), reaches a 393 px position error and a different outcome (survives, 815 m / 1115; Chromium and WebKit crash on a hazard at 835 m / 1175). That is a knife-edge hazard contact, not systematic drift.
* The digest hook reads `terrain.heightAt`/`slopeAt` every tick, and `_chunkAt` can in principle extend the live chunk window; to check that these probes are not what causes or hides anything, all 27 native cells were rerun with the probe reads removed (`NOPROBE=1`): causal digests and outcomes are identical in 27/27 cells. In #161 the "first divergence" in many cells was the `terrain` group alone (probe reads); here those are excluded: `terrain` first-diverges at ticks 484 to 597 in cells with no causal difference.
* So today the impact is: strict bit-level replay equality fails across engines (a *verification* problem), while gameplay outcomes differ in about 1 of 18 engine-fixture cells (a *rare* but real fairness problem for shared ghosts/leaderboards).

## A3. Leave-one-out and minimal set (global substitution, all three engines, 9 fixtures)

"Identical" = causal per-tick digests equal on chromium, firefox and webkit for all ticks.

| Config | fixtures identical across 3 engines | outcomes equal |
|---|---|---|
| native (no substitution) | 0 / 9 (twice) | 8 / 9 |
| all used ops replaced (sin cos tan atan2 pow exp hypot log log1p tanh) | **9 / 9 (twice)** | 9 / 9 |
| all minus sin / tan / pow / log / log1p / tanh | 9 / 9 each (not needed in this corpus) | 9 / 9 |
| all minus cos | 8 / 9 (bsod, Firefox, tick 764) | 9 / 9 |
| all minus exp | 8 / 9 (airborne, Firefox, tick 255) | 9 / 9 |
| all minus atan2 | 5 / 9 | 9 / 9 |
| all minus hypot | 2 / 9 | 9 / 9 |
| **{hypot, atan2, exp, cos}** (minimal set) | **9 / 9** | 9 / 9 |
| {hypot, atan2, exp, cos, sin, tan} | 9 / 9 | 9 / 9 |

Rerun note: after adding `acos`/`asin` to the prototype and to the all-ops set, `all` (twice), `all-scoped`, `matter-only` and `src-only` were rerun with identical results; the leave-one-out and minimal-set cells predate that addition (acos is only called at construction with constant arguments). Caveats: this is a corpus statement. `sin`, `cos`, `tan`, `tanh` differences are intermittent (a given argument may differ, most do not); `sin`/`tan`/`tanh`/`pow`/`log` simply did not hit a differing argument that mattered in these nine tapes, so the *safe* policy is to replace every transcendental on the authoritative path, not just the minimal set. Tapes were recorded on native Chromium, so the substituted sim leaves the recorded checkpoints (TapePlayer desync at tick 480 to 1920 in 6 / 9 fixtures; one outcome changes, `chunk-biome` survives like native Firefox): legacy tapes stop verifying, which is the accepted pre-release cost (physics-breaking, needs `SIM_REVISION`/`physicsVersion` bump and re-recorded fixtures).

Where the substitution must reach (Matter vs `src/`):

| Config | identical 3 engines |
|---|---|
| Matter-internal functions only (src native) | 0 / 9 |
| `src/` only (Matter keeps native trig) | 8 / 9 (bsod / Firefox fails) |
| both | 9 / 9 |
| Math swapped in only while `RunScene.simTick` runs (`all-scoped`) | 9 / 9 on this corpus, but terrain generation and body construction run outside simTick with native Math, so this is not a sufficient design |

## A4. Options

**(a) Localized portable implementation (prototype `portable-math.cjs`).** Pure `+ - * / sqrt floor` plus typed-array bit casts, fdlibm/msun kernels (sin, cos, tan, atan, atan2, exp, expm1, log, log1p, pow, tanh, hypot).
Accuracy vs Node's native (`accuracy-bench.mjs` for the numbers, and `tests/determinism/portable-math.test.js` as an asserting Jest test): atan, atan2, exp bit-identical to V8 (V8 is itself fdlibm there); sin/cos 84% identical, all within 1 ulp for |x| up to 2e6 rad; log 99.9% / 1 ulp; hypot, log1p, tanh within 2 to 5 ulp; tan within 3 ulp; acos/asin (new, via atan2) within a few ulp; `pow` with non-integer exponent up to 8 ulp (the sim uses integer powers; the non-integer ones are `pow(r, 0.32)` in Matter's chamfer at construction and `**0.45` in presentation). Not correctly rounded, which is fine: the requirement is a fixed algorithm, not exact rounding. **Large arguments degrade**: beyond 1.6e6 rad the reduction is a simple deterministic fallback, not Payne-Hanek: measured relative error `sin(1e7)` 2.8e-9, `sin(1e9)` 2.4e-8, `sin(1e15)` about 1e-2, `sin(1e22)` returns 0 (`cos(1e22)` returns 1). It is identical in every engine, so it is an accuracy limit and not an engine-parity problem; in play the largest `body.angle` over the nine fixtures is 3.4 rad, and 1.6e6 rad needs hours of continuous spin. Engine independence of the implementation itself is checked by fixed-input golden hashes (`golden.cjs`): identical in Node, Chromium, Firefox and WebKit (`engines.mjs`, `portable-math-engines.json`).
Cost: the in-simTick op mix is about 103 calls/tick. **The real-run timing data cannot resolve this effect**: `perf` (4 fresh sessions per cell, 3 fixtures, 3 engines) shows simTick 0.4 to 2.0 ms/tick with +/-0.4 ms swings between repeats and sign flips between fixtures (e.g. Chromium `kodiaks-on` 0.43 vs 0.81 ms/tick, `cruise-baseline` the reverse), so it is reported only as a sanity check, not as evidence. The quantitative bound comes from controlled micro-benchmarks of exactly that op mix, native vs portable interleaved in one process: Node (`tick-mix-bench.mjs`, noisy shared machine) **+4 to +18 us/tick** (the independent review measured +18.25 us/tick worst case), and in-page per engine (`engines.mjs`, 31 interleaved reps, idle machine): Chromium +2.0, Firefox +2.9, WebKit +1.0 us/tick. Worst case +18 us/tick is about 0.2% of the 8.33 ms tick budget. Perf is not a decision factor.
Needs: a sim-only Math module that all sim callers import, plus a plan for Matter (section 5), a ruleset/physics version bump, and a lint/test that forbids native Math in sim files. The proposed ban list: `sin cos tan asin acos atan atan2 exp expm1 log log1p log2 log10 pow hypot tanh sinh cosh cbrt`, and `**` with a non-integer or non-literal exponent (the counting wrappers cannot see `**`; the sim path has none today, only `ui/Motion.js` and `Background.js` do). `sqrt`, `abs`, `floor`, `min`, `max`, `imul` stay allowed.

**(b) Pinned canonical verifier runtime (headless Chromium), clients unchanged.** Evidence from #120: three Chromium builds (headless-shell 157, headless-shell default GL, full 153) are bit-identical on all 9 fixtures. It fixes the verification question cheaply (no sim change, no tape invalidation) but: it only attests "this tape verifies on pinned build X" (a different Chromium major can change V8's libm, which has changed before), the binary and its checksum become part of the verifier contract, and it does nothing for Firefox/Safari clients (ghost tapes and any shared-outcome comparison across engines still fork, e.g. the Firefox `chunk-biome` outcome). Cross-engine claim stays unsupported.

**(c) Deterministic WASM.** WASM f64 arithmetic is IEEE-deterministic exactly like JS, so a WASM libm gives no determinism advantage over pure JS for these functions (`wasm-boundary-bench.mjs`: the hand-assembled `hypot` is bit-identical to JS; call cost is about the same order as JS inline). It only changes the picture if the whole sim (Matter plus gameplay) moves into WASM, i.e. a rewrite; Matter is JS, so the sim would need porting or replacement. Not justified by this evidence.

## A5. Applying it to Matter without forking

* Matter (bundled in Phaser 3.90.0 as `Phaser.Physics.Matter.Matter`, a singleton on `window.Phaser`) references `Math.sin/cos/atan2/acos/pow` in nine functions (list above, including `Vertices.chamfer`'s `acos` and `pow(r, 0.32)`, which the sled's construction uses); internal calls go through module properties (`Vertices.rotate(...)`), so they are replaceable. The prototype now also provides `acos`/`asin`, and all-ops cells were rerun with them: results unchanged. Note that the sled's chamfer arguments are constant, so native `acos`/`pow` there would agree across engines on this corpus anyway; the plan must still cover them (or precompute the chamfered vertices) so a new chamfered body cannot reintroduce a tick-1 divergence.
* **Global `Math` monkeypatching**: works (9/9) but changes presentation code (Background alone makes 16.5 M sin calls) and any third-party code; rejected.
* **Scoped swap around `simTick`**: insufficient (terrain generation and body construction run outside simTick) and hides the dependency; rejected.
* **Recommended**: (1) sim files import `pmath` explicitly (no global state); (2) at startup replace just the nine Matter functions on the shared Matter object with versions that use `pmath` (a tiny, tested shim module that re-implements those few small functions; a unit test asserts each replaced function still matches Matter's contract and that `Phaser.VERSION` is exactly `3.90.0` (`package.json` says `^3.90.0`, only the lockfile pins it today), failing loudly on any Phaser change). The experiment tested the equivalent (`matter-only` / `src-only` wrappers swapping Math only inside those nine functions) and shows both halves are needed (0/9 and 8/9 alone, 9/9 together).
* Alternative if the shim feels too invasive: a Vite `transform` hook that rewrites `Math.<op>(` to `pmath.<op>(` in `matter-js/lib/**` at build time (no fork, but a build-time patch of node_modules output).

## A6. Recommendation (for the owner to confirm)

The measured real-world impact is **small but not zero**: engines differ in the last bit in most cells, almost always harmlessly (sub-1e-5 px), strict replay equality fails in 13 of 18 engine-fixture cells, and one cell (1 of 18) changes the outcome. The fix is cheap and fully works: with all used ops replaced, 9/9 fixtures are causally identical on Chromium, Firefox and WebKit (reproduced twice), at a per-tick cost below measurement noise.
1. If the project wants a cross-engine bitwise claim (the #121 acceptance wording), do **(a)** localized portable math for every sim transcendental plus the nine-function Matter shim, with a `SIM_REVISION` bump and re-recorded fixture tapes, and a lint test against native transcendental `Math` in sim files. Keep presentation on native Math.
2. If no cross-engine claim is needed yet, **(b)** alone is sufficient for verification and defers all code change, at the cost of no Firefox/Safari fairness and a pinned-binary dependency. Either way, do not claim bitwise parity beyond what the corpus shows; real Safari/iOS, ARM and Node were not testable here.
3. (c) is not recommended.

Not tested: real Safari/iOS, ARM, hardware GPUs, other Chromium majors, cadences other than 120 Hz (#120 found divergence cadence-independent), ops that did not occur in the nine tapes.
