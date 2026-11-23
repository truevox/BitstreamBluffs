# Four original songs × twelve musical identities — game music-bus output audit

Gal Friday, November 23, 2026. Engineering measurements, not listener approval.

## Signal path tested

This test uses the actual StemFXMixer, original source-stem and biome processors, the per-biome convolution impulse rooms, then the game AudioSynth music lowpass filter, music-volume bus scaling (music setting times 0.55), master gain and the actual Web Audio DynamicsCompressorNode (threshold -10 dB, ratio 6:1). The original five instrumental stereo stems and the matching original biome melodic lead are loaded from immutable original OGG archive segment 0000.

At the maximum-volume setting, the original lyrical vocals are ALSO included and the melodic lead is reduced to 18%, matching the existing game vocal mix. Original source recordings were not copied, modified or transcoded. Legacy Debutmont is resolved to the original archival debumont file path by the established compatibility convention.

Four songs × twelve musical identities × two scenarios, plus four original clean-menu controls, yielded **100 separate stereo 48kHz OfflineAudioContext renders**, each analyzing 2.5 seconds after source and convolution initialization. Original stems were accessed using read-only symlinks inside ignored temporary build output.

- Default instrumental: master 0.8, user music volume 0.6, original lyrical vocals off and original biome melodic voice lead on.
- Maximum with vocals: master 1.0, music volume 1.0, lyrical vocals on and original biome melody lead gain 0.18.
- Clean menu: original Debutmont instrumental source and lead, no source effects or convolution send, default volume.

## Results

**100/100 renders finite; zero over-full-scale samples and zero samples at or above 0.98** in the test excerpts. Max sampled peak: **0.803**, One More Run in Crystal Cavern with vocals enabled.

| Original song | Highest sampled peak | Biome | Scenario | Clean menu peak |
|---|---:|---|---|---:|
| Pope Leo Wants the AI Root Password | 0.424 | garbage-dump-glacier | default-instrumental | 0.091 |
| Every Hacker (Runs Out of Code) — Part 2 | 0.489 | vertigo-vents | maximum-music-with-vocals | 0.088 |
| Varmont Is Saved | 0.619 | garbage-dump-glacier | maximum-music-with-vocals | 0.083 |
| One More Run (The Ballad of Bitstream Bluffs) | 0.803 | crystal-cavern | maximum-music-with-vocals | 0.226 |

Complete original-source per-case output metrics and test scenario settings: 20261123-four-pack-game-music-bus-output-qa.json (100 rows). The earlier 96-render precompressor test and its full matrix are in 20261123-four-pack-original-stem-headroom-audit.md and its JSON sibling. These measure different points in the audio graph, so do not treat their peak values as directly comparable.

## Repeatable test on authorized host

Build native draft with npm run build. This registers tools/music/final-game-music-bus-audit.html as an INTERNAL QA page, not a public game feature. Expose the original four song packs as read-only test symlinks inside ignored dist/music/packs, using original canonical manifests and archived debumont original audio. Serve the build over HTTP. Run the committed tools/music/run-final-game-music-bus-audit.mjs with MUSIC_BUS_URL set to the test page URL. Set MUSIC_BUS_REPORT to preserve its JSON output. A short MUSIC_BUS_FOCUS=1 mode covers Garbage, Vertigo, Crystal and Arcade for a quick smoke. The runner asserts the correct number of cases, finite results and authentic source availability. It reports near-unity and over-unity counts without blindly changing the mix.

## Scope limitations and next listening gate

This is a real *music-bus* graph test and a meaningful improvement on precompressor-only measurements. It is NOT an exact whole-game output capture. It excludes simultaneous gameplay SFX, BSOD wind/static, event-driven impact sounds, crash count-in, continuously automated gameplay gain and adaptive re-performance stems. Only 2.5 seconds of the opening 12-second original OGG segment were measured, not the full song. This is sample peak, not intersample true peak, full-game LUFS, speaker distortion or subjective masking. The physical source effect state is elevated where supported, but no synthetic gameplay event timing is added.

Strong Garbage and Vertigo relative-to-dry precompressor levels remain human ear-review items in issue #289; do not auto-normalize or silently alter approved-feeling biome identities. Retain all original recordings and MIDI leads. No game DSP defaults changed. Human listening and independent engineering review must gate merges of draft game PR #280 and static preview PR #201.
