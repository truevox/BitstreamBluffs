# Transparent final output peak safety — before/after Chromium evidence

Gal Friday, November 23, 2026. Draft-only original-song and real Web Audio QA, NOT Marvin listening approval or a production merge.

## Why a final safety stage was needed

The original game compressor has threshold -10 dB and ratio 6:1, but it is **not** a hard digital output limiter. The early 2.5-second full-music-bus test across all four original songs and twelve biome identities looked safe (100 rendered cases, none over unity). A longer full 12-second test exposed two transient overshoots with vocals and music/master volumes at maximum. These two defects were invisible in the opening 2.5 seconds.

Unlike the earlier source-only report, this actual-game-music-bus test includes the real StemFXMixer, all five original instrumental source stems, the matching original separate melodic lead and lyrical vocal stem when enabled, native source FX, per-biome convolution room, canonical music-filter and music-volume buses, master gain, and the actual post-master DynamicsCompressorNode.

## Implementation (draft; no automatic loudness normalization)

- A single OutputPeakGuard WaveShaperNode now sits AFTER the existing compressor and BEFORE the AudioContext destination. All game output flows through it, including SFX and wind/static even though those additional sources are not exercised by the current offline music-only test.
- Its transfer curve is **exactly linear for absolute sample magnitudes <= 0.86**. Above 0.86, a continuously differentiable rational soft knee approaches a bounded ceiling of 0.965 without flat hard clipping or changing the normal source material. It does not auto-normalize Garbage, Vertigo or other strong biome identities.
- It uses a single 8193-point symmetric Float32Array curve and 2x Web Audio oversampling; there is no additional decode, re-encoding, timeline event, gameplay timer, arbitrary beat, source file or replay state.
- The project determinism-math checker forbids new transcendental Math calls in source. The first mathematical expression used Math.exp and FAILED that policy; the final version uses a positive, smooth third-order rational approximation with the same slope at its knee. The exact deterministic-math boundary and four audio guard unit tests now pass.

## Full first-segment results — same original recordings and exact test settings

**16 cases** = four original song packs × four risk-focused identities (Garbage, Vertigo, Crystal, Arcade) × maximum user music/master volume with original lyrical vocals. Each render covers the ENTIRE 12-second original OGG opening segment at 48kHz stereo.

| Song | Biome | Before sample peak | After guard | Samples above full scale | Change in overall RMS |
|---|---|---:|---:|---:|---:|
| One More Run | garbage-dump-glacier | 1.439 | 0.939 | 92 → 0 | -0.061% |
| One More Run | crystal-cavern | 1.080 | 0.937 | 42 → 0 | -0.019% |

Across all sixteen guarded 12-second renders, highest sample peak 0.939, with **0 nonfinite samples and 0 samples exceeding full scale**. Only the two One More Run mixes above exceeded full scale without a guard. The other fourteen mixes were already below the ceiling.

## Shorter across-all-biomes regression

The **100 original OGG 2.5-second renders** (4 songs × 12 musical identities × default instrumental or maximum-volume-with-vocals, plus four clean-menu controls) were repeated with the FINAL rational guard. Zero cases had sample peak at or above .98, and all outputs were finite. The maximum absolute before/after RMS change was **0.317%** in those excerpts. No audio source, song clock, original melody, music volume setting, native biome EQ, filter or DSP gain defaults were changed.

Both old and corrected measurements are preserved without overwriting the old evidence:
- 100 early original-bus cases BEFORE the guard: 20261123-four-pack-game-music-bus-output-qa.json
- 100 early original-bus cases WITH the final guard: 20261123-four-pack-game-music-bus-guarded-output-qa.json
- 16 whole-first-segment risk-focused cases BEFORE the guard: 20261123-four-pack-hot-biomes-full-first-segment-qa.json
- 16 whole-first-segment risk-focused cases WITH the final guard: 20261123-four-pack-hot-biomes-guarded-first-segment-qa.json

## Repeatable tests and limits

The dedicated QA HTML and Node test under tools/music/final-game-music-bus-audit.* use the SAME final mastering stage as AudioSynth and the real source StemFXMixer. Use MUSIC_BUS_FULL_SEGMENT=1 for the sixteen 12-second maximum-vocal cases and MUSIC_BUS_REPORT to capture full JSON. The separate clean-menu native browser smoke asserts the output guard is actually wired into a real Title→RunScene game, while still proving 750ms clean original menus, six rapid reversals, a stable original song clock, and bounded graph cleanup.

**Not yet certified:** final whole-game output with concurrent SFX/BSOD wind/static and physical event transients; the remaining original OGG song segments beyond the first twelve seconds; phone playback; full-song integrated loudness; true intersample peaks or acoustic perception. WaveShaper oversampling is not a lookahead true-peak limiter. The source audio compressor plus soft ceiling is a sensible defensive backstop, not a guarantee about downstream speakers. Independently review this proposed safety sound before production; user ear approval is still required.
