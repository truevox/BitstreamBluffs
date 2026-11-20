# Issue #59: fixed simulation tick and seeded run randomness

Status: **stages 1 and 2 merged to `main` on 2026-11-20 at Marvin's request.** Marvin chose
the 120 Hz tick (option A below). His hands-on play session is still pending, and the gates
listed at the end remain open.

| Stage | Branch | What it changes |
|---|---|---|
| 1 | `engine/seeded-sim-rng-59` | Scramble torque comes from a seeded `physics/scramble` stream. The scrambled-silhouette shake uses `visual/sled`. New run seeds come from `crypto.getRandomValues`. |
| 2 | `engine/fixed-tick-59` (on top of 1) | All causal gameplay runs in fixed ticks (`SimClock`, `RunScene.simTick`). |
| 3 | `feature/ghost-tapes-56` | Done. No `Math.random()` is left in `src/`, and a test enforces it. World effects (`Fx`, camera shake) use the run's `visual/fx` and `visual/camera` streams, so a replay looks the same. Menus, HUD flicker, the jukebox, audio texture and music shuffle use `CosmeticRandom`: named forks of a session root taken once from the CSPRNG. Not yet audited: `tools/` and future simulation code outside `src/`. |

## What stage 2 does

- `RunScene.update` keeps per-display-frame work: the pause check, the crash and Gym READY
  holds, and `renderFrame`. Everything that was below the pause check now lives in
  `simTick(dt, pad)`, unchanged except that `dt` is always the tick:
  - timers, cooldowns, slow-mo, blink and hit-stop;
  - Matter steps, contacts and the BSOD chase and catch;
  - tricks, score and flow, pickups and hazards;
  - terrain streaming and the glitch schedule.
- `SimClock` (pure, unit-tested):
  - It accumulates real frame time and runs whole ticks only.
  - A frame runs at most 6 ticks (50 ms, the old frame clamp). Any backlog beyond that is
    dropped, so a stalled tab never fast-forwards the run.
  - Held controls come from the latest poll. A one-shot `pressed` edge reaches exactly one
    tick. If a frame runs no tick, the edge waits for the next tick rather than being lost.
  - `simClock.tick` is an integer tick counter, which is the time axis a replay tape needs.
- Slow-mo still scales the physics delta inside each tick, so it remains deterministic.

## Evidence (CT223, Chromium + SwiftShader, minified build, real Matter)

`tools/replay-determinism-browser-probe.mjs` gives each run its own browser page. It holds
`RunScene.update`, puts Phaser's loop to sleep, and steps `game.step(t, dt)` on an exact
frame schedule with a scripted input tape (push, hops, flips, tuck). Scramble is forced on
for the whole run.

| Check | Variable delta (`main`) | Stage 1 | Stage 1 + 2 |
|---|---|---|---|
| Same seed, tape and 60 Hz schedule, twice | **diverges on frame 1** (41 px, score 199 vs 201) | identical | identical |
| 60 Hz vs 30 Hz, 9 s | 1,315 px apart | 1,315 px apart | **0 px** (same pose, velocity, angle and score at every sample) |
| 60 Hz vs 120 Hz, 9 s | 130 px apart | 130 px apart | **0 px** |

### Handling compared with today's game (scramble off, 3 seeds, 12 s, no-flip tape)

- **Against today's 120 Hz:** stage 2 matches within about 1 px, with the same scores and crash
  times. This is by design, because every tick is two 4.17 ms Matter steps, exactly what a
  120 Hz display runs today.
- **Against today's 60 Hz:** distance differs by 14–26 px over 4,000–6,000 px (about 0.5%).
  Crashes fall in the same places, about 25–70 ms apart. Two of three scores match; the third
  is 317 vs 344.
- **With a flip in the tape:** a borderline 3 s flip lands at 60 Hz today but bails at 30 and
  120 Hz, in both the old and the new code. The trajectories then diverge by thousands of px.
  Today's outcome for that run depends on the display rate.

**Finding:** today a run's result depends on the player's monitor. At the same seed and
inputs, 30 Hz and 60 Hz players ended 3,709 px apart (scores 186 vs 386). That is an official
Daily fairness problem on `main`, separate from ghosts.

## Decision for Marvin: tick rate

| Option | Physics per tick | 30/60/120 Hz smoothness | Handling vs today | Cost |
|---|---|---|---|---|
| **A. 120 Hz (8.33 ms), the branch default** | 2 × 4.17 ms | exact (4/2/1 ticks per frame) | identical to today's 120 Hz; about 0.5% off today's 60 Hz | 2 ticks per 60 Hz frame |
| B. 180 Hz (5.56 ms) | 1 × 5.56 ms | 30/60 exact, 120 Hz judders | identical to today's 60 Hz | 3 ticks per 60 Hz frame, and 120 Hz needs render interpolation |
| C. 125 Hz (8 ms, the issue's candidate) | 1 × 8 ms | judders at 30/60/120 without interpolation | new step size, untested | needs render interpolation |

**Recommendation:** A. It reuses a step size players already have, it needs no interpolation at
common refresh rates, and its parity is proven above. On 144/165 Hz displays some frames run
no tick and the motion steps slightly. Bounded render interpolation is a follow-up if that
shows in play.

## Replay hardening (2026-11-20)

`tools/ghost-tape-browser-smoke.mjs` stage 6 records one run that includes a manual reset, a real
pause and resume through the Pause screen, and a 2-second stalled frame (a background tab coming
back). It then replays the tape alone at 30, 60 and 120 Hz. All 12 checkpoints match exactly, and
every replay crashes on the same tick.

Three frame-rate leaks were found and fixed on the way:

1. **Terrain chunks became physical on frame-dependent ticks.** Cosmetic code (the minimap's
   look-ahead, the billboard's posts) calls `terrain.heightAt` once per display frame. That can make
   the generator build chunks early, and their colliders, hazards and pickups then joined the world
   on whatever tick came next, which slightly reordered Matter's contact solving. Now
   `RunScene.streamTerrain` adds a chunk only on the first tick the sled is within the generator's
   own fill-ahead bound of it.
2. **Rolling boulders and gates moved their sensor bodies per display frame.** `Hazard.update`
   ran during rendering. Motion now advances once per tick in `simTick`.
3. **The helicopter-spin angle, which the trick tracker scores, advanced in `Sled.render`.** It is
   now `Sled.stepHeli`, called once per tick.

Replays are also now driven by the tape header alone (seed, biome mask, upgrade ranks, boosts,
`magnetsDrop`), not the live profile, and they never save a run record, award progress or record
a new tape.

Parity is also proven on a biome course with a rolling boulder active: `SEED=RPLAY59@260
START_X=50400`, with helicopter input in the tape, is exact at 30/60/120 Hz.

## Still open

- A hands-on feel check by Marvin.
- Gym in-scene retries inside one tape (Gym runs record no tapes yet), and long runs over
  60 seconds.
- Cross-browser and cross-version parity. Same-build parity is not cross-version parity.
- Official run-ledger hashes are untouched. Tapes have their own versioned format (#56).
