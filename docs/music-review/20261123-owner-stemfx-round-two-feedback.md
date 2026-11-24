# Source-stem audition: second owner listening round (Nov 23, 2026)

## Original owner statements (Marvin, during 13-biome listening)

- **Garbage Dump Glacier:** "sounds good" at the currently auditioned settings; no requested mastering change.
- **Crystal Cavern:** "sounds good" at the currently auditioned settings; no requested change.
- **Steampunk Slopes:** "works for steampunk for now"; preserve audition defaults unless later feedback changes that.
- **Sky Jellyfish Mountain:** tentacles need "even MORE space somehow". Earlier preference also requested more bloom. Owner had already liked the takeoff/landing noises at selected event settings.
- **Space Mountain:** sounds good in general, but needs "even MORE echos, longer ones".
- **Pyramid Peak:** "almost no changes" even when sliders are at maximum.
- **Candy Cane Canyon:** "almost the same as dry, needs more, lots more".
- **Vertigo Vents:** "pretty weak sauce"; owner requests distortion filter with a **light wah** evocative of heat waves.
- **Physical events generally:** owner reports **all jumps and landings sound fine at the settings in the screenshots pasted in the listening thread**. Preserve their levels and timing. No additional authorization to modify event amplitudes or promote new DSP as final production defaults.

The above reflects owner feedback, **not** independently verified music mastering approvals. Exact screenshot slider values were *not* reconstructed or guessed from the owner's natural-language remarks. Future review needs to preserve the settings saved in the owner's local listening-page browser.

## Experimental fixes awaiting owner listening

**All changes are confined to private audition labs and never alter published original OGGs, production music mixer, game physics, song clocks, or user-approved trigger levels. New controls start at 0%.** Existing user slider levels persist in the listening tour via local browser state.

- **Jellyfish `reach`:** new delayed, panned, filtered tentacle trails with bounded regeneration and clean decay. The existing buoyancy, drift, spring and takeoff levels are not changed.
- **Space `echo-tail`:** source-excited long satellite delay taps (roughly half-second to 1.7s per lap, with sub-unity/damped feedback) and wider panorama. Re-entry and airlock one-shots are not fed into this echo network.
- **Pyramid `resonance`:** the original `125%` level stays untouched; above `125%` the original instruments feed a separate pair of warm sandstone-resonance chambers, panned apart and band-limited. Existing thermal gust/ceramic impact settings unchanged. Pre-change original-grounded music vs dry at the test source sample had an RMS difference of only **1.6886%**, increasing to **14.9384%** in a thermal at `loft=.68`.
- **Candy `candy-character`:** source-fed, saturated sweet mids and a lively stereo treble glaze, driven from the original instruments only (not invented MIDI notes). The existing `sweet`, `fizz`, speed, pop-rocks and wrapper settings remain unchanged.
- **Vertigo `heat-wah`:** optional original-source midrange overdrive into two phase-offset, slowly varying band-pass wah filters and stereo position. The original `rumble`, `shimmer`, velocity, geyser-blast and rock-impact settings are unchanged.

**Implementation:** `AuditionCharacterEdge.js` accepts only original post-stem-level music and outputs through the existing user-toggleable `fxBus`, **not** through any event generator. `AuditionSpatialReach.js` originally tapped the output of the FX chain; a safety follow-up moved that input to the **original post-stem-level music exclusively**, thereby preventing long tails from changing approved one-shot impacts. The existing `AuditionExtra.js` graph is unchanged.

## Independent source / browser checks

- Real-source `probe-audition-character-edge.mjs` (Chromium OfflineAudioContext):
  - Candy max original-OGG sample peak `0.2894`, change relative to original processed baseline RMS approximately `101%` at 200%; one-shot residual relative error `0.0000068`.
  - Vertigo max sample peak `0.2833`, relative change approximately `102%` at 200%; one-shot residual error `0.0000293`.
  - Both outputs finite, below full scale and demonstrably audible in the numeric waveform comparison. These metrics are **not perceptual approval**.
- Real-source `probe-audition-spatial-reach.mjs`: at max, Jellyfish sample peak `0.2384`, stereo difference/baseline RMS `55.68%`, event residual relative error `0.0000194`; Space sample peak `0.2281`, difference `51.81%`, event residual error `0.0000125`; Pyramid sample peak `0.2207`, difference `29.46%`, event residual error `0.0000052`. **No one-shot propagation through new DSP.**
- Five complete live Chromium audition tests **5/5 PASS**: jellybloom, orbitfield, sunstone, sugarfizz, ventforge. Each loaded original OGGs, played, toggled effects, exercised actual physical-event preview buttons, then stopped cleanly.
- Vite production build succeeded, with preview files deployed to the existing private listening URL.

## Gate

**Audition only.** Present the newly available controls to Marvin and retain 0% defaults until the listener confirms which extra character settings to keep. Do not merge or alter production game DSP, and do not claim the approved real-world SFX levels changed. Keep original recordings in the private archive.
