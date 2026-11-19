# Issue #33 — soundtrack-reactive world dance (first cosmetic slice)

**Owner inspiration:** Marvin asked for a gently animated, *Popeye*-like environment that seems to dance with the music: a squishing sun, swaying trees or other scenery, and the whole world responding without compromising gameplay. Requested separate issue first, followed by PR. **Discussion from Music Friday** recommended distinct **rhythm**, **intensity**, and **biome personality** dimensions and keeping separate drum-count-in audition recordings out of this feature. No user-approved numeric BPM/beat grid is implied.

**Issue:** https://github.com/truevox/BitstreamBluffs/issues/33

## Implemented first slice

- `AudioSynth.getWorldDanceSample()` is a read-only sampler of the actual **audible rendered music mix** already playing through the original OGG stem director. Reuses its existing 1024-FFT analyser and samples at most ~25 Hz. **Does not** add a playback transport, AudioContext, analyser, or FFT buffer. Fail-closed on muted/disabled music, no active audio track, suspended context, manual pause, fatal count-in, shutdown, or track loading. The source's transport revision resets the visual envelope on a song change or seek.
- `WorldDanceEnvelope` reacts to positive musical **transients**, decays between accents, and separately smooths the mix **intensity**. High-energy sections produce noticeably more motion than a quiet bridge receiving an otherwise similar attack. This is **music-reactive**, not verified metrical beat detection: all four public `RELEASE_BEAT_GRIDS` entries currently have `status:'unverified'`. It does not create a guessed metronome, write beat metadata, or delay Gym releases.
- `Background` squashes its striped synthwave **sun** up to 12% wider and 9% shorter at maximum bounded intensity, with the center fixed. Distant decorative ridge silhouettes breathe less than 2 pixels. Biomes express the same signal with distinct accents: candy canes and lollipops flex/bob, giant grass bends at the tips while rooted, jellyfish breathe, factory gears kick slightly, ringed planets swell, and vent glows pulse. Anchored decor follows the *same* tiny visual ridge displacement as its anchor. Terrain colliders, world coordinates, terrain mesh, hazards, scoring, controls, and all gameplay clocks stay unchanged.
- `RunScene` owns its envelope. The feature is automatically disabled when the browser OS has `prefers-reduced-motion: reduce`, when `settings.reduceMotion === true`, or when `settings.worldDance === false`. It is strictly cosmetic and defaults to enabled for eligible users. **No new Settings UI control** is added to avoid conflicts with concurrent title/settings changes in **PR #32**. A user-facing independent intensity/off control can be added after coordinating with that PR.
- The default zero-motion renderer reproduces its previous neutral shapes; no jump, BSOD, camera, or state replay timing changes.

## Validation

- `tests/src/world-dance.test.js` covers music transients, smoothing, decay and quiet-vs-loud response, revision resets, missing/invalid audio, reduced-motion and feature-off flags, bounded sun and biome style geometry, original neutral rendering, and read-only AudioSynth sampling.
- `tests/src/biome-backdrops-w6.test.js`/`biome-background.test.js` ensure all motifs remain deterministic, bounded, visible, hazard-safe, and reasonable to render at their neutral setting.
- `tools/world-dance-real-ogg-browser-smoke.mjs`: actual headless Chromium / WebAudio / original OGG track playing in a genuine gameplay run; records non-constant bass/mid analyser samples, rendered ellipse calls (not just a mocked mathematical helper), bounded pulse strength and varying intensity, then checks mute, OS reduced-motion, and feature-off signal fallbacks. Uses an isolated browser context and does not save user profile data.
- Run the existing fatal crash/retry music and BSOD Gym tests for noninterference. Release build and current game suite are CI/review gates, not assumed from source compilation alone.

## Explicit limitations / follow-ups

1. **This first PR does not promise precise beat-locked animation**, because the song-specific original recording beat grids have not been independently verified. It uses **real musical attack energy**, which is more organic than a synthetic fixed-tempo click but can respond to nonmetrical accents.
2. Musical personality is an artistic design space, not a fixed exhaustive biome animation specification. Existing biomes receive bounded different motion; future **trees** should move once actual tree sprites/decor are introduced. No invented trees or new collision objects have been added just to satisfy the metaphor.
3. The rendered mix energy is a shared analyser signal. A later verified beat-grid system plus independent per-stem attacks could improve subdivision/phase and the half-time bridge dynamics. Do not mix in the three audition count-in recordings without a separate approval.
4. The sound-reactive effect has no direct level-up or gameplay advantage. The reduced-motion / independent visual-intensity UI toggle should be planned with PR #32 to prevent settings merge conflicts.

**Publication scope:** this branch is reviewed through a draft PR for issue #33. Nothing is automatically merged into `main` or deployed.
