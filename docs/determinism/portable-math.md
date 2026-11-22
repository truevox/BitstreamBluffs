# Portable deterministic math (issue #121), Phase A evidence

**Status: Phase A evidence and recommendation only. Nothing here changes the game (`src/` is untouched).** Digests are diagnostic and
non-authoritative; they are to be replaced by the Replay Contract (#152) fingerprints. Derived from the #120 harness (PR #161), corrected per
the independent review of #161: divergence is measured on **causal** state only (all digest groups except `terrain`, which hashes derived
`heightAt`/`slopeAt` probe reads), TapePlayer desync and final outcome are recorded separately, and every cell is a fresh browser context.

Setup: built game at `b51bee72`, nine #120 fixture tapes (recorded once in Chromium, replayed unchanged), 120 Hz stepping, page clock pinned,
Chromium headless-shell 157 (SwiftShader), Firefox 159 (headed under Xvfb), Playwright WebKit 27.2 (not Safari). One cell = (config, engine, fixture);
the full matrix cell cache is `tools/determinism/portable-math/.cache` (not committed); summaries: `docs/determinism/results/portable-math-*.json`.
Tooling: `tools/determinism/portable-math/` (`experiment.mjs run|report|perf`, `attribution.mjs`, `accuracy-bench.mjs`, `tick-mix-bench.mjs`,
`wasm-boundary-bench.mjs`, prototype `portable-math.cjs`).

## 1. Inventory of non-IEEE-exact Math on the authoritative path

`+ - * / sqrt` are IEEE-exact. Static: `src/` has ~290 call sites of `sin cos tan atan2 exp log log1p log2 pow hypot tanh`; most are presentation
(Background, Hazard drawing, Fx, UI, audio). Dynamic, measured by replaying all nine fixtures (30,860 ticks) with counting wrappers, calls made
**inside `RunScene.simTick`** per tick: sin 39.8, cos 39.2, hypot 13.0, atan2 6.2, exp 3.2, pow 1.2, tan 0.25, tanh 0.09, log 0.05 (about 103 calls/tick;
`log1p` once at BsodPursuit construction; `atan`, `asin`, `acos`, `cbrt` never). Outside simTick the page makes 16.5 M `sin` calls over the corpus (Background and other presentation).

Call-site attribution (unminified dev build, `collision-heavy`, `attribution.mjs`; results in `portable-math-attribution-collision-heavy.json`):
* **Phaser's bundled matter-js does use transcendentals on the sim path**: `Axes.rotate`, `Vertices.rotate`, `Vector.rotateAbout`, `Vector.angle`
  (and, at body construction, `Vector.rotate`, `Vertices.chamfer` (pow, acos), `Bodies.polygon`, `Body.rotate`, `Composite.rotate`). They account for
  about 83% of in-simTick sin/cos calls and 18% of atan2 calls. Matter has no `exp`, `hypot`, `tanh`, `log`.
* `src/` sim callers: `Sled.js` (hypot, exp, cos/sin of slope, `log` in air-brake decay), `PhysicsTuner.js` (atan2, exp, cos/sin), `TerrainContact.js` (hypot, cos),
  `ShardMagnet.js` (hypot), `BsodAerodynamics.js` (pow, tanh), `BsodPursuit.js` (log1p), `TrickTracker.js`, `RunScene.js`, `TerrainGenerator.js` (tan, atan2, hypot, cos; runs at chunk build, **outside simTick**),
  `Sled._buildBody` (Matter construction, outside simTick), `ScoreManager` (pow).
* Not on the sim path though they call Math: camera (`RunScene.updateCamera` exp), `Sled.render`, hazard drawing (`hash01` uses `sin(x)*43758`, visual only), audio, UI.
  Read-only probes outside simTick (`Sled.speed` getter, `TerrainGenerator.slopeDegAt` atan2) feed the `terrain` digest group and the ground telegraph, not causal state.

## 2. How much do engines really diverge today (native Math)?

Chromium is the reference; two independent fresh-context sessions per engine (`native`, `native-rep2`) gave identical results, so the divergence is reproducible, not flaky.

| Native, causal state vs Chromium | Firefox 159 | WebKit 27.2 |
|---|---|---|
| fixtures with any causal divergence | 5 / 9 (first ticks 255, 373, 764, 1087, 1698) | 8 / 9 (first ticks 19 to 971; `airborne-tricks` clean) |
| TapePlayer checkpoint desync | 4 / 9 | 6 / 9 |
| final outcome (ticks, crash cause, distance, score) equal | 8 / 9 | 9 / 9 |
| max sled position delta over the run | 0 to 7e-9 px in 8 / 9 | 0 to 8e-6 px in 9 / 9 |

* Divergence is last-bit noise that mostly never amplifies: in 17 of the 18 cells the largest sled position error over the whole run is below 1e-5 px and the outcome is identical.
* **One real fork**: `chunk-biome-boundaries` on Firefox diverges causally at tick 373 (`world`), reaches a 393 px position error and a different outcome (survives, 815 m / 1115; Chromium and WebKit crash on a hazard at 835 m / 1175). That is a knife-edge hazard contact, not systematic drift.
* In #161 the "first divergence" in many cells was the `terrain` group alone (probe reads); here those are excluded: `terrain` first-diverges at ticks 484 to 597 in cells with no causal difference.
* So today the impact is: strict bit-level replay equality fails across engines (a *verification* problem), while gameplay outcomes differ in about 1 of 18 engine-fixture cells (a *rare* but real fairness problem for shared ghosts/leaderboards).

## 3. Leave-one-out and minimal set (global substitution, all three engines, 9 fixtures)

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

Caveats: this is a corpus statement. `sin`, `cos`, `tan`, `tanh` differences are intermittent (a given argument may differ, most do not); `sin`/`tan`/`tanh`/`pow`/`log` simply did not hit a differing argument that mattered in these nine tapes, so the *safe* policy is to replace every transcendental on the authoritative path, not just the minimal set. Tapes were recorded on native Chromium, so the substituted sim leaves the recorded checkpoints (TapePlayer desync at tick 480 to 1920 in 6 / 9 fixtures; one outcome changes, `chunk-biome` survives like native Firefox): legacy tapes stop verifying, which is the accepted pre-release cost (physics-breaking, needs `SIM_REVISION`/`physicsVersion` bump and re-recorded fixtures).

Where the substitution must reach (Matter vs `src/`):

| Config | identical 3 engines |
|---|---|
| Matter-internal functions only (src native) | 0 / 9 |
| `src/` only (Matter keeps native trig) | 8 / 9 (bsod / Firefox fails) |
| both | 9 / 9 |
| Math swapped in only while `RunScene.simTick` runs (`all-scoped`) | 9 / 9 on this corpus, but terrain generation and body construction run outside simTick with native Math, so this is not a sufficient design |

## 4. Options

**(a) Localized portable implementation (prototype `portable-math.cjs`).** Pure `+ - * / sqrt floor` plus typed-array bit casts, fdlibm/msun kernels (sin, cos, tan, atan, atan2, exp, expm1, log, log1p, pow, tanh, hypot).
Accuracy vs Node's native (`accuracy-bench.mjs`, 200k samples): atan, atan2, exp bit-identical to V8 (V8 is itself fdlibm there); sin/cos 84% identical, all within 1 ulp; log 99.9% / 1 ulp; hypot, log1p, tanh within 2 to 5 ulp; tan within 3 ulp; `pow` with non-integer exponent up to 8 ulp (only `**0.45` in presentation and integer powers in sim, so irrelevant to the sim). Not correctly rounded, which is fine: the requirement is a fixed algorithm, not exact rounding.
Cost: in-simTick op mix of 103 calls/tick measured in Node at **+4 to +18 us/tick** (`tick-mix-bench.mjs`, noisy machine). In real runs (`perf`, 4 fresh sessions per cell, 3 fixtures, 3 engines) the whole-sim cost with substitution is within measurement noise of native: simTick 0.4 to 2.0 ms/tick with swings of +/-0.4 ms between repeats, sign flips between fixtures. Upper bound from the micro-bench: about 0.02 ms of the ~0.4 to 1 ms simTick and 0.2% of the 8.33 ms tick budget. Perf is not a decision factor.
Needs: a sim-only Math module that all sim callers import, plus a plan for Matter (section 5), a lint/test that forbids native transcendental `Math.*` in sim files, and a ruleset/physics version bump.

**(b) Pinned canonical verifier runtime (headless Chromium), clients unchanged.** Evidence from #120: three Chromium builds (headless-shell 157, headless-shell default GL, full 153) are bit-identical on all 9 fixtures. It fixes the verification question cheaply (no sim change, no tape invalidation) but: it only attests "this tape verifies on pinned build X" (a different Chromium major can change V8's libm, which has changed before), the binary and its checksum become part of the verifier contract, and it does nothing for Firefox/Safari clients (ghost tapes and any shared-outcome comparison across engines still fork, e.g. the Firefox `chunk-biome` outcome). Cross-engine claim stays unsupported.

**(c) Deterministic WASM.** WASM f64 arithmetic is IEEE-deterministic exactly like JS, so a WASM libm gives no determinism advantage over pure JS for these functions (`wasm-boundary-bench.mjs`: the hand-assembled `hypot` is bit-identical to JS; call cost is about the same order as JS inline). It only changes the picture if the whole sim (Matter plus gameplay) moves into WASM, i.e. a rewrite; Matter is JS, so the sim would need porting or replacement. Not justified by this evidence.

## 5. Applying it to Matter without forking

* Matter (bundled in Phaser 3.90 as `Phaser.Physics.Matter.Matter`, a singleton on `window.Phaser`) references `Math.sin/cos/atan2/acos/pow` in nine functions (list above); internal calls go through module properties (`Vertices.rotate(...)`), so they are replaceable.
* **Global `Math` monkeypatching**: works (9/9) but changes presentation code (Background alone makes 16.5 M sin calls) and any third-party code; rejected.
* **Scoped swap around `simTick`**: insufficient (terrain generation and body construction run outside simTick) and hides the dependency; rejected.
* **Recommended**: (1) sim files import `pmath` explicitly (no global state); (2) at startup replace just the nine Matter functions on the shared Matter object with versions that use `pmath` (a tiny, tested shim module that re-implements those few small functions; a unit test asserts each replaced function still matches Matter's contract and that the Phaser version is the pinned one, failing loudly on a Phaser upgrade). The experiment tested the equivalent (`matter-only` / `src-only` wrappers swapping Math only inside those nine functions) and shows both halves are needed (0/9 and 8/9 alone, 9/9 together).
* Alternative if the shim feels too invasive: a Vite `transform` hook that rewrites `Math.<op>(` to `pmath.<op>(` in `matter-js/lib/**` at build time (no fork, but a build-time patch of node_modules output).

## 6. Recommendation (for the owner to confirm)

The measured real-world impact is **small but not zero**: engines differ in the last bit in most cells, almost always harmlessly (sub-1e-5 px), strict replay equality fails in 13 of 18 engine-fixture cells, and one cell (1 of 18) changes the outcome. The fix is cheap and fully works: with all used ops replaced, 9/9 fixtures are causally identical on Chromium, Firefox and WebKit (reproduced twice), at a per-tick cost below measurement noise.
1. If the project wants a cross-engine bitwise claim (the #121 acceptance wording), do **(a)** localized portable math for every sim transcendental plus the nine-function Matter shim, with a `SIM_REVISION` bump and re-recorded fixture tapes, and a lint test against native transcendental `Math` in sim files. Keep presentation on native Math.
2. If no cross-engine claim is needed yet, **(b)** alone is sufficient for verification and defers all code change, at the cost of no Firefox/Safari fairness and a pinned-binary dependency. Either way, do not claim bitwise parity beyond what the corpus shows; real Safari/iOS, ARM and Node were not testable here.
3. (c) is not recommended.

Not tested: real Safari/iOS, ARM, hardware GPUs, other Chromium majors, cadences other than 120 Hz (#120 found divergence cadence-independent), ops that did not occur in the nine tapes.
