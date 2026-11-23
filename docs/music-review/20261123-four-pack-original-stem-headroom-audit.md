# Four original songs × twelve musical identities — source-level headroom

Gal Friday, November 23, 2026. An **instrument-and-melody PRE-COMPRESSOR engineering audit**, not a listening signoff, not a full-game final audio meter and not full-song true-peak certification.

## Precisely what was tested

- Real, unchanged original archived OGG segment 0000 from **four installed packs**; no generated or re-encoded fixture audio. Four packs × 12 identities × 2 states (dry and native DSP) = **96 real Chromium OfflineAudioContext stereo renders**, 48kHz × 2.5s each.
- Every raw-vs-processed comparison uses the SAME original biome-specific melodic voice lead plus the same five original instrument stems: drums, bass, guitar, piano and other. Differences are thus from FX, not swapping biome melodies. Recorded lyrical vocals are disabled for this matrix; vocal-on mix is not certified.
- Explicit test assumptions: instrument gains drums 0.90, bass 0.75, guitar/piano/other 0.65, separate melodic lead 0.75, test master 0.55. Native orchestraPreset and melodyPreset with a strong physical source state where a supported parameter exists.
- **Not included:** real-game master/user volume, compressor/limiter, convolution rooms, SFX, adaptive stem replacements, full tracks, manual landing sequences, mobile output, inter-sample true peak, or listener preference. This test CANNOT establish a production-safe peak ceiling.
- Legacy immutability: compiled manifest uses canonical voice:debutmont; original OGG lives under adaptive/debumont. The test resolves the original archive path without renaming source files.

## Results

**48/48 processed comparisons:** all samples finite and **0 over-unity samples** at the specific tested gains. The complete 48-row per-song/per-biome original dry and processed metric matrix is in [the JSON matrix](20261123-four-pack-original-stem-precompressor-qa.json).

| Original song | Garbage Dump Glacier RMS / dry | Vertigo Vents RMS / dry | Maximum sampled peak across all 12 biomes |
|---|---:|---:|---:|
| Pope Leo Wants the AI Root Password | 3.77× | 6.60× | 0.760 (garbage-dump-glacier) |
| Every Hacker (Runs Out of Code) - Part 2 of 2 | 3.01× | 6.54× | 0.667 (garbage-dump-glacier) |
| Varmont Is Saved | 4.23× | 6.68× | 0.787 (garbage-dump-glacier) |
| One More Run (The Ballad of Bitstream Bluffs) | 3.15× | 4.89× | 0.773 (garbage-dump-glacier) |

**Audition watchpoints, not automatic defects:** Garbage is ~3.0–4.2× dry RMS; Vertigo is ~4.9–6.7× across these 2.5s excerpts. These two effects may intentionally be much more present than others. Prioritize human listening across different songs before any auto-leveling or texture changes.

## Repeatable on the authorized test host

Run the committed Node driver tools/music/run-cross-pack-original-stem-audit.mjs against the Vite-built internal page tools/music/cross-pack-original-stem-audit.html with local original OGG pack assets accessible through /music/packs/<pack>/... . The authorized test host provides original audio ONLY as read-only symlinks inside ignored disposable dist. CROSS_PACK_URL selects the built internal auditor page; CROSS_PACK_REPORT selects where to write full source-level JSON metrics. The test rejects a broken source fetch, nonfinite original recording, or over-unity processed source sample at the test gain.

For later tracks, the test can eventually discover the music catalog dynamically. Current four pack IDs are explicit for reproducibility. Do not promote zero sampled over-unity results to full-song safe without a real final game master compressor and long-track inter-sample peak audit.

Owner listening follow-up: [issue #289](https://github.com/truevox/BitstreamBluffs/issues/289). The issue is deliberately a review gate, NOT a recommendation to auto-normalize hot biomes.

## Approval gate

Marvin has not yet auditioned every biome. No DSP gain defaults were changed based solely on numbers, and no master recordings changed. Human listening may confirm intentional hot Garbage/Vertigo sound or motivate independent balance adjustments. Leave the game and static listening PRs in draft pending owner ear and independent engineering review.
