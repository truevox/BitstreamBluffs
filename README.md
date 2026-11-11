# Bitstream Bluffs

A downhill-only, neon-styled trick-and-race game built with Phaser 3.90 and Matter physics. You ride a sled down an endless, seeded track, carve and hop over terrain, pull tricks for combo points, and dodge glitch hazards until you crash. Runs are deterministic per seed, so a seed can be shared. Visuals are procedural shapes and audio is synthesised with WebAudio, so there are no image or audio assets. The design is specified in `docs/DESIGN-DOC.md`.

## Running

Requires Node.js and npm.

```sh
npm install
npm run dev        # Vite dev server (port 5173)
npm run build      # production build to dist/
npm test -- tests/src   # unit tests for the new src/ code
```

`npm test` with no arguments also runs the legacy tests in `tests/`, several of which were failing before the rebuild.

## Controls

Keyboard (from design doc section 4.1):

| Key | Action |
| --- | --- |
| W | Push forward (only when nearly stopped on flat or upslope) |
| A / D | Tilt back / forward (air and ground lean) |
| S | Brake |
| A + D | Tuck (less drag, reduced gravity) |
| Space | Hop / bump jump |
| Shift | Emergency reset (respawn on last safe ground, costs combo) |
| Left / Right | Helicopter CCW / CW (style) |
| Up | Air brake |
| Down | Parachute stall (half gravity for 0.8 s, steering locked) |
| Esc | Pause ("Pascal's Ledger" menu) |

Gamepad (standard mapping): left stick tilts, right trigger pushes, left trigger tucks, A hops, B brakes, X air brakes, Y parachutes, LB/RB helicopter, Back resets, Start pauses. A touch overlay mirrors the same virtual buttons during runs.

## Project layout

- `src/` is the game. `src/main.js` is the entry point, loaded by the root `index.html`.
- `src/ARCHITECTURE.md` is the contract for how modules connect: file ownership, scene flow, events, data shapes and the physics unit mapping.
- `src/systems/` holds pure logic (RNG, terrain generation, scoring, tricks, saves, daily rule) with no Phaser imports, plus input, audio and physics helpers.
- `src/scenes/`, `src/entities/`, `src/ui/` hold Phaser scenes, game objects and UI.
- `src/data/` holds content as JSON: terrain chunks, hazards, power-ups, terrain mods and palettes.
- `src/shaders/` holds the glitch fragment shader and its pipeline.
- `tests/src/` holds unit tests for the new code.
- `docs/DESIGN-DOC.md` is the design specification.

## Legacy code

The previous implementation lives in `js/`, with its tests in `tests/`. It is kept for reference, is no longer loaded by `index.html`, and is not imported by anything in `src/`. Treat it as read-only history.
