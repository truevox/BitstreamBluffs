# Vertigo Vents: geothermal original-stem processing and actual physics geyser eruption

Gal Friday experiment on November 23, 2026. User request: "Super duper! Keep going please!" Continue a ninth independent listening experiment. Owner has NOT heard this biome or approved any new settings. Issue #267. Implementation belongs in a draft stacked on original-stem Jellyfish #265, Steampunk #263, and consolidated five-biome integration #261. The main-based browser audition snapshot belongs in draft #201. Do not merge overlapping alternatives into main twice.

## Source-grounded game mechanics

The real Vertigo Vents biome uses geyserVent, with an existing grounded vent launcher in Sled.applyControls. PhysicsTuner.geyserStep grants an upward velocity and resets a real cooldown when it fires. An ordinary hop, changing grounded to airborne, or riding outside a vent does NOT reset the geyser cooldown. Its background already has time-driven volcano cones and smoke. This project reads those actual physics facts and changes NO causal state, input, scores, seed, collision, replay or source song clock.

In RunScene simTick, a new local read-only variable captures the sled's authentic geyser cooldown BEFORE stepWorld. The existing audio observation boundary AFTER stepWorld forwards that same-tick before/after pair, the actual vy (negative upward), and whether the existing tuner reported a geyser zone. AudioSynth refuses the data while paused or in menu. StemMusicDirector refuses false/invalid snapshots, a stopped/paused source, wrong biome, or negative countdown: an eruption only fires when the currently eligible actual cooldown INCREASES more than 80ms and ends above 200ms. A genuine cooldown reset from geyserStep thus triggers exactly once; after that the cooldown counts DOWN and does not retrigger. Ordinary jumping can drive the heat-shimmer timbre through actual rising vy but never fabricates a geyser blast.

## Musical treatment

- All five unchanged original stereo instrument stems retain a unity dry signal path.
- A smaller source-driven lowpass-to-saturation wet send gives a warm, low volcanic grind under the real song. First pass pushed the original 5-stem mix above unity sample peak; this was detected and corrected BEFORE publishing by reducing the wet rumble gain, leaving the dry source intact. New rumble gain tracks 0..200% with zero meaning no geothermal low wet layer.
- A separate original-source bandpass heat shimmer follows real upward speed from 0..1600 px/s, using slow bounded audio parameter changes and a modest non-note 7.3 Hz amplitude tremor. It is never set from the unverified beat grid.
- A genuine geyser release plays a short deterministic approximately 860ms sub-pressure WHUUMMP followed by colored filtered noise and a narrow rising steam whistle, generated once per graph and reused. The eruption is physical Foley, NOT an added melodic stem or synthesized chord.
- A valid noncrash touchdown can produce separate short approximately 340ms rocky KRAK-KRR with low thunk and scattered brittle clacks. It is independently adjustable and works even between recorded drum hits. A positive landing result may arrive before the authoritative grounded edge, so the director queues and consumes it after actual touchdown; menu/biome exit drops queued rocks.
- Both physical signals cap at three active event voices per graph, disconnect and stop on disposal, never schedule game timers and do not alter physics.

## Proposed listening defaults, not approved

- Geothermal low rumble: 125%.
- Heat shimmer: 125%.
- Eruption blast: 130%.
- Rocky landing clatter: 80%.
- Standalone audition rising speed initially zero, to be varied toward 1600 px/s.

The demo has Load/Play/Stop, Solo Drums, Compare Dry, an upward velocity slider, Ordinary Jump (NO eruption), Trigger Actual-Geyser Sound (a button demonstrating the effect only, NOT a fake game event), Return to Ground, and Landing Rocks. It loops one synchronized original-song sample for testing and does not change any media.

## Objective QA and provenance

- Full music/physical/visual focused Jest: 295/295 tests across 29 suites PASS. This includes actual geyserStep output fed into the new audio boundary; authentic cooldown increase triggers a blast, ordinary airborne, cooldown countdown, disabled vent, invalid velocity, menu/pause/crash and stopped states do not.
- Full determinism suite: 483/483 across 18 suites PASS. Source tripwire and build identity pass after the existing supported no-behavior-change attestation for the read-only RunScene observation. No causal gameplay computation was rewritten or exempted.
- Vite production build: 525 modules transformed, PASS.
- Actual Chromium game boot from compiled production Vite output: actual original One More Run OGGs decoded, all eight original-stem biome processors instantiated in real RunScene, song clock preserved, 22 retired crossfade effect chains drained to zero. The test's eruption/biome cases are programmatic injections at the actual existing music director API boundary, NOT an assertion of human physical terrain playtesting.
- Real standalone Chrome Chromium with original One More Run five stereo OGG stems: button controls/solo/dry A/B, speed, physical eruption and rocky landing work, including mobile viewport, without browser exceptions.
- Objective 48kHz Chromium OfflineAudioContext with the original first 3.5 seconds of One More Run: full dry RMS 0.081398, dry sample peak 0.7300. Corrected grounded geothermal difference 38.71% of original dry RMS, peak 0.8607; upward air difference 40.42%, peak 0.9223; grounded-versus-ascent difference 13.95% of grounded RMS. Physical eruption added 42.50% RMS delta compared with grounded; rocky landing added 9.45%. With ALL recorded stems silent, eruption-alone sample RMS 0.042635, peak 0.458743 and rocky impact-alone RMS 0.009484, peak 0.236502. No sampled clip in the tested excerpt. These are engineering signal differences and sampled peak values, NOT perceptual loudness, headphone acceptance or full-song true-peak certification.
- The original One More Run OGG recordings in local tests were available ONLY through disposable read-only symlinks in ignored dist output; no audio source files were committed or rewritten. The eventual hosted static audition separately reuses the existing unchanged five synchronized 20s Pope MP3 preview stems in main-based audition PR #201. Do not attribute One More Run numeric results to the different Pope sample.

## Human listening gates

Does the grounded music sound volcanic rather than overdistorted? Does heat ascent feel like actual hot air or generic tremolo? Is the eruption dramatic without overpowering original music? Does rocky touchdown deserve more bass or fewer clicks? A normal jump must NOT play the explosion. Approval awaits Marvin's ears and independent code review before any production merge.
