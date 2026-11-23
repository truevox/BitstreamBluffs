# Underwater Mountain Hydrostatic — draft physics-to-original-stem experiment

Status: **experimental, draft, listening required**. Implementation owner Gal Friday. Issue [#250](https://github.com/truevox/BitstreamBluffs/issues/250), stacked after Scrapheap PR #221 / Snowpack PR #194, following design PR #200 and the owner's Underwater-depth refinements. Original recordings and MIDI-derived biome vocal melodies must never be removed or rewritten.

## Physical truth

- Each **confirmed Underwater biome entry** initializes a terrain-entry elevation reference on the first real finite terrain sample. Terrain/world Y grows positive downward.
- `deepestTerrainDescentPx` is a monotonic high-water mark: `max(previous, terrainY-entryTerrainY, 0)`; **not** the rider's Y, airtime, horizontal speed, or total path distance. Riding uphill cannot undo it. When terrain reaches a new low, stored pressure rises further. `storedPressure01 = 1-exp(-deepest/460px)` is a bounded, soft-knee starting calibration, not a physical hydrostatic-pressure measurement in Pa.
- Jump relief uses **the same real post-physics sled state**: rider Y relative to local terrain, actual signed vertical velocity (negative when ascending), grounded flag. Upward movement temporarily opens filter space; apex retains partial relief; falling restores sound before touchdown. `audiblePressure01 = storedPressure01 * (1-0.78*jumpRelief01)` means the remembered baseline NEVER changes during a jump. Invalid terrain samples hold prior state, and missing vertical motion cannot invent relief.
- **Only confirmed biome exit or a fresh run** resets reference/high-water depth; repeated same-biome events do not. AudioSynth's additive `setHydrostaticMotion` reads post-simulation terrain and sled data from RunScene with no gameplay or ranking mutation. The shared song clock and original instrument source playback are unaffected.

## DSP and listening experiment

- New native Web Audio processor `hydrostatic` runs **on each original instrumental stem**, with bass retaining more dry warmth. Parallel dry/wet paths are bounded. Lowpass cutoff and warm midrange are controlled by **audible pressure** through smooth audio-param automation; dry source retains enough highs for song recognition. Existing separate vocal MIDI lead remains in its own routing, as designed.
- A physically triggered drum-only **0.36-second unpitched pressure-wave/quiet bubbles** one-shot plays on a valid real landing, capped at three concurrent voices. No fabricated beat grid, no random live scheduling, deterministic buffer seed, cleanup on dispose.
- Demo `tools/music/hydrostatic-audition.html` plays **the same original five separated instrument preview stems**, and lets a listener adjust signed terrain descent relative to entry, move uphill without clearing the high-water mark, simulate rising/apex/falling/landing, compare dry, or explicitly exit/reset the biome. Its simulated inputs are labeled and drive the **same pure state policy** as the actual game. The demo is not a substitute for running the game.

## Browser/QA evidence (Nov 22, 2026)

- Pure deterministic high-water, bad-data, ascent, apex/fall, touchdown and reset tests; game director signal routing/pending impact tests; native processor impact/cleanup tests. **142 focused music/audio tests** in 16 suites pass and Vite production bundle builds.
- Real Chromium browser smoke of the **built** standalone audition passes: authenticated original stems load, run, pressure increases as terrain descends, uphill slide cannot reduce stored pressure, upward jump reduces only audible pressure, fall and touchdown reimpose pressure, reset clears depth, and dry compare toggles.
- Chromium OfflineAudioContext using the **five actual original sampled MP3 stems**, three seconds: dry/zero-pressure difference RMS **1.64e-9** (effectively exact dry parity); deep-pressure vs dry difference RMS **0.0131222**, jump relief vs full-depth difference RMS **0.0123841**, landing pressure-wave vs same-depth difference RMS **0.0061516**. Dry peak **0.17309**, maximum measured processed peak in this passage **0.15361**, landing **0.15361**; no invalid output or sampled clipping. These are sampled peaks and one preview excerpt only, not full-song/true-peak/headphone/mobile loudness or proof of subjective acceptance.
- This first pass does **not** implement actual fluid pressure physics, bubble harmonization from verified chroma, or biome-specific instrument re-performance, and does not edit the original stereo audio masters.

## Next listening gate

Ask Marvin whether (1) pressure feels like immersion rather than simply muffling, (2) stored pressure clearly *doesn't* clear on an uphill section, (3) jump relief is satisfying but pressure comes back quickly during descent, (4) landing wave is audible without masking the song. Keep as draft until ears and long-run QA pass.
