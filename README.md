# Bitstream Bluffs

A downhill-only, neon-styled trick-and-race game built with Phaser 3.90 and Matter physics. You ride a sled down an endless, seeded track, carve and hop over terrain, pull tricks for combo points, and dodge glitch hazards until you crash. Runs are deterministic per seed, so a seed can be shared. Visuals are largely procedural shapes; the soundtrack uses original multi-stem OGG recordings alongside synthesised WebAudio effects. The full music library lives under `public/music/`. The design is specified in `docs/DESIGN-DOC.md`.

## Running

Requires Node.js and npm.

```sh
npm install
npm run dev        # Vite dev server (port 5173)
npm run build      # production build to dist/
npm run test:runtime # current src/ tests, explicit separate result
npm test             # complete suite, including historical js/ tests
npm run test:legacy  # only historical tests; known pre-existing failures
npm run sim -- --seeds 100 --policy handsOff --out result.json  # simulation
```

`npm test` still executes **every** Jest test: the seven historically failing suites remain visible, never silently skipped or marked passing. `test:runtime` and `test:legacy` are **additional diagnostic lanes**, not replacements for the complete suite. The latest public-acceptance evidence and legacy triage live in `docs/QA-PUBLIC-ACCEPTANCE-20261119.md`.

## Public release acceptance (read-only)

The public game is at **https://simulate.sledhead.ing/**. After building a candidate that should already be deployed to Netlify, verify the published HTML/JavaScript bytes and run the five public browser gates:

```sh
npm run build
npm run gate:live
# Or, from a code-only sparse worktree, reuse a full build:
node tools/qa/live-acceptance.mjs --dist /path/to/full-worktree/dist
```

`gate:live` checks **SHA-256 byte parity** of the served HTML and compiled JS, then drives Daily Draft/Classic, the original-OGG Music Lab, genuine BSOD fatal/retry music, and five uninterrupted Gym Bluffs in disposable headless Chromium contexts. It fails immediately on any mismatch or test failure and **does not retry automatically, deploy, or alter actual player profiles**. Do not use it as proof that every remotely hosted media file has identical bytes; that check covers HTML/JS, while the media smokes exercise real playback.

## Simulation harness

`tools/sim/` runs the real game in headless Chromium, faster than real time, to measure how runs behave across many seeds. It uses a fixed 1000/60 ms step and seeded randomness, so the same seed and policy give the same result. It needs the `playwright` package (already declared in `package.json`) and a Chromium browser installation available to Playwright.

- `npm run sim -- --seeds 100 --policy handsOff --out result.json` runs 100 seeds (`sim-01` to `sim-100`) and writes JSON.
- Policies: `handsOff`, `hop`, `flip`, `stallProbe` and `terrain` (terrain generation only, no physics).
- Useful options: `--seeds N` or a comma list, `--maxM` and `--maxSec` limits, `--seedPrefix`, `--workers`, `--releaseLateMs`, `--flipTargetDeg` and `--flipCleanDeg` (flip policy), `--hopLeadMs` (hop policy), `--verify` (runs each seed twice and checks the traces match). Run `node tools/sim/run.mjs` with the header comment open for the full list.
- `node tools/sim/shots.mjs <hints|zoom|hud> <outDir>` saves screenshots of the HUD, tutorial hints and camera zoom.

## Controls

The shipped default keyboard layout is **Tricks Right**, configured in Settings. There are also **Tricks Left** and **Classic** layouts. Important: **S is Divebomb by default, not ground Brake**; the Classic layout assigns S to Brake. The default has no dedicated keyboard ground-brake key. The game's menu-navigation keys remain independent of the chosen gameplay layout.

| Key | Tricks Right (default) | Classic |
| --- | --- | --- |
| W | Parachute | Push forward on suitable ground |
| A | Airbrake | Tilt back |
| S | Divebomb | Ground Brake |
| D | Tuck | Tilt forward |
| Up | Frontflip / forward tilt | Airbrake |
| Down | Backflip / backward tilt | Parachute |
| Right | Helicopter | Helicopter right |
| Left | Corkscrew | Helicopter left |
| Space | Hop | Hop |
| Shift | Emergency reset | Emergency reset |
| Esc | Pause | Pause |

In **Tricks Left**, W/S control forward/back tilt, D helicopter, A corkscrew, Up parachute, Left airbrake, Down divebomb, and Right tuck. Gamepad standard mapping includes A hop, **B ground Brake**, X airbrake, Y parachute, right trigger push, left trigger tuck, and Start pause. A touch overlay provides on-screen controls during runs. See `src/systems/ControlLayouts.js` and `src/systems/InputRouter.js` for the authoritative bindings.

## Project layout

- `src/` is the game. `src/main.js` is the entry point, loaded by the root `index.html`.
- `src/ARCHITECTURE.md` is the contract for how modules connect: file ownership, scene flow, events, data shapes and the physics unit mapping.
- `src/systems/` holds pure logic (RNG, terrain generation, scoring, tricks, saves, daily rule) with no Phaser imports, plus input, audio and physics helpers.
- `src/scenes/`, `src/entities/`, `src/ui/` hold Phaser scenes, game objects and UI.
- `src/data/` holds content as JSON: terrain chunks, hazards, power-ups, terrain mods and palettes.
- `src/shaders/` holds the glitch fragment shader and its pipeline.
- `tests/src/` holds unit tests for the new code.
- `tools/sim/` holds the headless simulation harness.
- `tools/qa/` holds the read-only deployed-build verifier and consolidated public Chromium acceptance gate.
- `docs/DESIGN-DOC.md` is the design specification.

## Legacy code

The previous implementation lives in `js/`, with its tests in `tests/`. It is kept for reference, is no longer loaded by `index.html`, and is not imported by anything in `src/`. Treat it as read-only history.
