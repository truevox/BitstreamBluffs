# Candy Cane Canyon — original-stem Sugar Rush sparkle and physical Pop Rocks

Gal Friday draft, November 23, 2026. Linked issue #270. Owner asked to continue adding independently auditionable physics-driven music biome treatments. He has not yet heard this one or approved its proposed sound mix. This implementation is stacked on Vertigo #268 (on Jellyfish #265, Steampunk #263 and consolidated five-biome integration #261). Static browser sample goes in main-based audition draft #201. These drafts are unmerged; do not merge overlapping feature stacks and the earlier consolidated branch as duplicates.

## Existing gameplay truth and boundaries

- Candy Cane Canyon has the actual sugarRush zone: speedMul 1.3 and steerMul 0.8. Important previously stated Marvin decision: sugar-rush steering MUST preserve full ground steering and only dull air control. This audio patch does not change either physical multiplier, actual steering, collision, gravity, scores, replay, or powerups. The preexisting sugar-rush-steering test is still green.
- Its visuals show candy-striped sky, canes and lollipops; these move with scene time and WorldDance pulses, not certified song downbeats. The music does NOT infer tempo from them or add a new beat grid.
- The existing actual StemMusicDirector.setSpeed uses the sled's observed px/s, independently of song playback rate. The new source-fed sugarfizz effect consumes that same real speed (0..1800 px/s normalized). Fizz rate and intensity follow rider speed; actual musical sample playback rate and all original notes remain unchanged.

## DSP design

All five untouched original stereo instrumental stems retain a unity dry path. Parallel wet sends from the *actual recorded waveform* add a bright mid-high candy sheen and a crunchy high-frequency filtered fizz that increases with speed. A modest oscillatory gain applied ONLY to the source-wet fizz speeds up from about 1.7 to 12.7 Hz with real sled speed; it is not a fabricated metronome or a substitute MIDI instrument. Airborne music shifts the highpass corner toward brighter material but limits the wet fizz gain compared with grounded high-speed to protect raw audio headroom. At idle the source remains close to the original, with more coloration at genuine racing speed.

One real grounded→airborne transition in the Candy biome emits a short deterministic candy wrapper **CRRRT** on the original other-stem graph. A valid noncrash landing emits one distinct deterministic 510ms Pop Rocks **POP-KRRRRK** with several decreasing crackle bursts plus a low crunch, routed to original drums. Both are tiny physical one-shots, not notes or tempo patterns, and exist even when the original musical stems go quiet between beats. Real landing events arriving before grounded state are queued and consumed exactly once after that transition; invalid/crash/menu/wrong biome/transport paused refuse or clear. Maximum 3 concurrent short physical voices per effect graph; all are stopped/disconnected on disposal. No additional causal timers.

## Proposed values — Gal Friday suggestions, not Marvin decisions

| Listening slider | Start |
|---|---:|
| Candy sweet sheen | 125% |
| Sugar speed-fed fizz | 150% |
| Landing Pop Rocks | 130% |
| Takeoff wrapper snap | 90% |

Standalone audition offers load/play/stop, dry A/B, solo drums, real px/s 0..2000 slider, takeoff/land and isolated physical test buttons. Static snapshot will reuse the already-existing **Pope** synchronized ~20s MP3 original instrumental preview files unchanged; the actual game uses original OGG release sources, and the separate QA below used *One More Run* original OGG. Do not equate these different songs or encoded samples.

## Original recording QA and loudness limitations

- **304/304 focused** music, audio, Sugar Rush steering and biome tests in 30 suites pass. The original Sugar Rush ground-steering agency test remains green.
- **483/483 determinism** tests in 18 suites pass; no gameplay source affected, existing tripwire and build identity current. Vite production build **528 modules** passes.
- Real Chromium standalone with five original One More Run OGG instruments decoded and played all controls, source processing, physical events, solo and dry A/B, desktop/mobile viewports without errors.
- Actual Vite-built game Chrome boot loaded real One More Run OGG source buffers, instantiated all **nine** original-stem native physics effects across the mountain, preserved source playback clock and retired 23 temporary crossfade chains to zero. Events in this smoke test were injected at the true director API boundary; this is not a manual physical terrain playthrough.
- Real 48kHz Chromium OfflineAudioContext of the **first 3.5 seconds of One More Run**: five-stem original dry mix RMS 0.0813976, peak 0.7300. Ground idle processing delta 3.90% dry RMS, high-speed grounded .95 delta **23.47%**, high-speed airborne .95 delta **25.00%**, original high-speed versus idle change **20.91% idle RMS**. Landing Pop Rocks delta **15.88% grounded RMS**, wrapper snap delta **8.88%**. With ALL recorded original stems disconnected, isolated pop RMS 0.014596/peak 0.4432 and wrapper RMS 0.008159/peak 0.2054. High-speed grounded full-source sample peak 0.9571 and simultaneous high-speed airborne sample peak **0.9868**, under unity in this tested window.
- Two QA iterations caught overly high potential levels at simultaneous high-speed and airborne: initial sampled peak ~1.09, then ~1.006. Reducing ONLY the airborne wet fizz factor achieved .9868 sampled peak while preserving the original dry source and significantly audible high-speed grounded wet tone. Do not claim whole-track clipping safety, true peak, perceived loudness, sample-device fidelity or owner listening acceptance from short excerpt signal measurements.
- Original samples in tests are READ-ONLY symlinks in disposable ignored dist, not moved or committed. No original masters, stereo stems, vocal recording, separate MIDI leads or actual music notes were rewritten.

## Review and listening

Reviewer: verify the director consumes actual speed with no tempo adjustment, does not change Sugar Rush ground steering, respects correct landing-before-grounded ordering, rejects menu/paused/crash, preserves the source stems, caps/stops physical audio nodes and does not bleed candy music into other biomes. Also listen for whether the bright source wet sounds like fizzy candy rather than generic shrill EQ, whether the wrapper snap is sufficiently different from Garbage's wet suction, and whether the landing pops read as candy crackles rather than arbitrary drum fills. Marvin's ear approval and independent review remain outstanding.
