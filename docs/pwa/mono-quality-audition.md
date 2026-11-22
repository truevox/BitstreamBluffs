# #172 / #180 — Mono Lite/Full stem encode audition

**Status: experimental asset-processing helper only, not a released music tier.**

Marvin's requirement: retain every original song performance as an independently addressable stem, create **mono** derivatives so the game can pan each instrument and voice itself (#180), and support a very small Lite download before a better-quality download (#172). Bitrates should vary by instrument; not all stems need the same rate. Preserve original source files and metadata; do not invent synthesized replacements or premix stems.

## Current prototype

`tools/pwa/mono-stem-variants.mjs` provides pure URL/category/bitrate helpers and a source-safe offline encoder. `tools/pwa/encode-mono-sample.mjs` provides a developer-only CLI. `tests/src/pwa-mono-stem-variants.test.js` checks source identification, bitrate choices, URL boundaries, monaural encoder arguments and disjoint input/output roots.

- **One source stem → one mono Opus source derivative** in a separate `/music-variants/lite/packs/...` or `/music-variants/full/packs/...` namespace. The engine-facing logical source remains `/music/packs/...` so the same `StemMusicDirector` can later consume either selected quality, after the downloader/worker is integrated. Audio is generated at 48 kHz and checked for mono channels and matching source duration. Original source has its own SHA-256, each derivative has its own SHA-256, and a per-encode manifest has a version fingerprint.
- Original stereo Oggs are **read-only**; new assets are written outside their tree, checked against filesystem aliasing/symlink escaping. Source and target roots may not overlap. **The encoder refuses every preexisting derivative path** (not just symlinks), and FFmpeg is invoked with `-n`, never `-y`; this protects original stereo masters even if an output was accidentally hardlinked to an original inode or a destination appeared between precheck and write. Repeat encodes require a new separate output directory. The CLI emits no song catalog edits and is not imported by live game code. Do **not** copy generated Oggs into the repository without the correct content review and manifest policy.
- **Per-stem presets are first listening candidates, not final settings.** Lite: bass 12 kbps; lead 18; guitar/piano 20; vocals 24; drums 28; Other 26; adaptive 24. Full mono candidate: bass 40; lead 40; guitar/piano/vocals 48; drums 56; Other/adaptive 52. FFmpeg/libopus uses VBR internally. The caller can override individual source URLs within 6–128 kbps when experimenting with complexity analysis; this is *not* dynamic network bitrate adaptation yet.
- **Mono is a conscious soundstage policy**, not a claim of lossless conversion. Source stems are mostly stereo in the current packs. Downmix can remove stereo-specific differences and force additional lossy re-encoding; compare the original recordings and summed final mix by ear before approving any preset.

## Measured real-source sample (CT223, 2026-11-21)

Generated 24 original recorded stems from *One More Run*, spanning segments `0000`, `0006`, and `0012`. Each set contains vocals, drums, bass, guitar, piano, Other, home voice and Debumont melody. No source track was copied into source directories or changed.

| Tier candidate | Original bytes | Encoded bytes | Result |
|---|---:|---:|---|
| 24 source stereo Opus files | 2.030 MiB | — | baseline |
| Lite mono (per-instrument rates) | 2.030 MiB | 0.777 MiB | **38.3%** of current source size |
| Full mono candidate (per-instrument rates) | 2.030 MiB | 1.630 MiB | **80.3%** of current source size |

`ffprobe` verified **all 48 derivatives** are mono and 48 kHz. For every segment, reported encoded and source durations matched to the precision measured (max delta `0.00000` seconds; each original file includes an Opus duration offset). No bitrate was determined by an automated perceptual metric. Additional full-catalog measurement and a headphone listening panel are needed before we extrapolate downloads or claim acceptable quality. The **first high-rate preset inflated the eight sampled originals to 142%**, so it was discarded in favor of the lower provisional Full rates. That is a valuable reminder that source audio is already Opus-compressed; mono is not automatically half the bytes.

**Actual generated test files are held in ephemeral `/tmp/bsb-172-mono-24stem-audition-20261121`, not tracked as game assets.** Their manifest hashes are generated from the authentic original recording bytes and derivative bytes.

## Reproduction

```bash
node tools/pwa/encode-mono-sample.mjs lite /path/to/full-song/public /tmp/bsb-mono-sample \
  /music/packs/33_local-one-more-run-bitstream-bluffs/0000-bass.ogg \
  /music/packs/33_local-one-more-run-bitstream-bluffs/0000-drums.ogg
npm test -- --runInBand tests/src/pwa-mono-stem-variants.test.js
```

Use `full` for the higher-rate candidate. A real full-media source checkout or already approved build asset source is needed; sparse game worktrees typically do not contain Ogg bytes. This tool intentionally does not download external audio.

## What is still blocked / not implemented

1. **Perceptual approval:** ABX headphone + phone-speaker comparison for full original vs mono Full vs mono Lite, after summing all active stems, with a focus on stereo downmix phase cancellation, cymbals, vocals and biome-melody integrity. Quality presets are adjustable but have not been accepted by Marvin.
2. **Delivery integration:** source-bound versioned variant URLs must be added to optional per-song download manifests; stage Lite before Full, verify source and derivative hashes, then cache either quality under unchanged logical playback URLs. The test worker from PR #179 presently checks complete original-recording groups only and does not yet know how to prioritize Lite/Full. It must never serve half-transferred groups or switch quality mid-segment; offline failure remains honest 503 instead of fallback synth.
3. **Gameplay spatialization:** in #180, add per-stem Web Audio pan control for BSOD bass, counter-moving drums, rider+airtime vocals and beat/trick-linked guitar/piano/Other. That work is cosmetic and independent of audio encoding, and beat grids remain unverified until #50.
4. **Compatibility and safety:** full-song/biome transitions, exact-frame alignment, versioned replays and browser devices; production service worker and cache UI only after review. No live app code or service-worker registration is changed in this PR.

Keep parent #172 **open**. This is a source-safe exploration stacked on #179, which itself is a draft stacked on #175 and #173.
