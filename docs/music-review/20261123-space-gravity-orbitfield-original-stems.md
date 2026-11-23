# Space Mountain — low-gravity original-stem orbital field and physical re-entry

Draft by Gal Friday, November 23, 2026. **User approved continuing production of listening experiments, NOT this new sound or its levels.** Issue #274. Implementation stacked upon Candy #271, Vertigo #268, Jellyfish #265, Steampunk #263, consolidated five-biome #261. Listening snapshot is main-based draft #201, distinct from game code. Do not merge overlapping branches twice.

## Source-confirmed biome mechanics

Space Mountain has the actual lowGravity terrain mod with gravityMul 0.7 and big-air terrain. Actual EffectivePhysics.gravityPxS2 is observed after the authoritative stepWorld tick. Actual sled y and the source terrain.heightAt(sled.x) give the actual rider elevation. This source code changes NO causal physics, controls, gravity, collision, hazard timing, replay, score or notes; RunScene sends an optional, one-way post-physics snapshot for music.

The Space music director refuses invalid, nonfinite, negative/zero gravity, absent boolean grounded, wrong-biome, paused/menu or stopped snapshots. Grounded position ALWAYS yields zero altitude opening, independent of apparent y; airborne altitude is max(0,terrainY-riderY) scaled to 700 px. An additional fraction of low-gravity influence from 900 px/s² reference to actual EffectivePhysics gravity increases the field only when airborne. Cosmetic changes are throttled to ~2.5% field deltas, not scheduled on a fabricated musical clock. Real grounded→airborne creates exactly one soft PFFT–shhh airlock release. Real noncrash landing creates a shorter-than-one-second physical WHUUMM–FMM re-entry shock even if the recorded drums are silent; landing arriving before the grounded flag is queued then consumed on actual touchdown. Crash/invalid/menu/paused/wrong biome refuse physical sounds.

The original five stereo instrumental source recordings stay on unity dry paths. A separate original-source filtered highpass/lowpass wet send feeds two left/right panned delays (~143ms and ~262ms at baseline, stretching to ~188/347ms) with each path's bounded ~0.10 feedback, plus very slow 0.18–0.50 Hz width drift. Stereo effects open with real weightlessness/altitude and close when grounded. The original song's tempo, notes, synchronized stem positioning, separate MIDI lead and original vocal track remain intact. Neither the held low drone of space nor an invented new synth pad replaces the source. Only short bounded physical Foley is synthesized, once per effect graph; max three active impact voices; voices stop/disconnect on disposal.

## Proposed user-listening controls, not owner decisions

- Long stereo void width: **115%**.
- Satellite drift rate: **100%**.
- Re-entry impact: **125%**.
- Airlock unweighting: **80%**.
- Demonstration altitude: 0–900 px; gravity: 300–900 px/s², initially 630 representing actual lowGravity 0.7x gravity.

Standalone audition has original five stems, play/stop, Solo Drums, dry A/B and physical Takeoff, Land, Test Reentry, Test Airlock. In the game, height, gravity and grounded are read from authoritative physics, not these user simulation sliders.

## Objective QA / source distinction

- Focused 47 music DSP/physics tests across 2 suites passed initially; existing Dynamic Orchestra test was correctly updated to recognize that Space now has its OWN valid re-entry impact rather than treating Space as an uneffected biome. Targeted 61 tests across 3 suites passed after updating that former expectation. The established Snowpack exclusion of invalid crash and menus remains intact.
- Vite production build: **531 modules** passed. One-way optional RunScene physics snapshot was attested by the supported no-behavior-change source tripwire; build identity and ruleset pass. No physics source data or signed sim revision was altered.
- Real Chromium production Vite game boots with actual original One More Run OGG release recordings; it cycles TEN native original-stem physics-driven effect processors, preserves exact song clock and retires 24 temporary FX chains to zero after crossfade. The programmatic test invokes actual director API shapes, NOT proof of manual physical terrain playtesting.
- Chromium standalone original five stereo One More Run OGG instruments loaded and audible, all controls tested without page errors. Real 48kHz Chromium OfflineAudioContext render of original first 3.5 seconds of One More Run: five-stem dry RMS .081398, sample peak .7300; grounded source processing signal delta **4.57% of dry RMS**; typical low-gravity high-flight source processing delta **23.79%**, maximum simulated flight **27.26%**, grounded-versus-flight delta **24.25% of grounded RMS**. Physical re-entry added **28.21% of grounded RMS**; airlock eject added **4.12%**. With all recorded stems disconnected, independent physical re-entry RMS .02575, peak .3503 and airlock RMS .00376, peak .0909. Sampled processed full-mix peaks .729 grounded and .716 at high flight in the checked original excerpt. These relative waveform delta/short-window sample peaks do NOT verify listener preference, perceived loudness, long-tail true peak, full song, or mobile-speaker efficacy.
- For tests the original OGG recordings are accessible via ignored, disposable, READ-ONLY symlinks only and are neither staged nor copied. The main-based hosted static browser audition instead reuses the ALREADY EXISTING synchronized ~20s **Pope** original-instrument MP3 sample files by URL relative path. The OGG numbers above must not be attributed to the different Pope excerpt.

## Ear gate

Listen for whether the source-fed stereo echoes feel vast and orbital rather than generic old-school delay. Is re-entry a physical return to gravity or too much of a generic movie explosion? Can the original rhythm/notes be followed during long weightless jumps, with no new harmony or beat grid? Review source tripwire, handling of unexpected positive-down y coordinates, finite validation, bounded voices, stage teardown, and mobile peak levels. Independent code review and Marvin listening still required before any merge.
