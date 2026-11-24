# #291 — source-verified beginning / middle / ending segment output audit

**Draft audio QA only, based on unmerged PR #280 (exact parent `12e525c3`). No production DSP, game physics, musical gains, original OGG files, menu transition, or audio-event design changed. No release / listener approval implied.**

## New coverage

Before this work, the authentic game MUSIC-bus test exercised the first original OGG segment, often only its opening 2.5 seconds; sixteen 12-second max-vocals cases proved the initial full first segment of four risk-focused biomes. This expands coverage using the **beginning, middle, and last actual original segment of each of the FOUR installed songs**. Twelve source segments × four high-risk identities (Garbage Dump Glacier, Vertigo Vents, Crystal Cavern, Arcade) × one maximum-volumes-and-original-vocals scenario = **48 new offline WebAudio renders**, 2.5 seconds of actual original audio each (plus the graph's startup offset). Every case includes the real `StemFXMixer` per-stem processing and native room, original matching melodic lead and original lyrics, game music/master bus, -10dB/6:1 compressor and final post-compressor `OutputPeakGuard`.

| Metric | Result |
|---|---:|
| Original song packs | 4 |
| Source segments (beginning / middle / last) | 12 |
| Source OGG file SHA-256 identities | 216 |
| Rendered original-music cases | 48 |
| Nonfinite samples | **0** |
| Samples over digital full scale | **0** |
| Samples ≥ 0.98 | **0** |
| Highest observed sample peak | **0.941929** |
| Worst case | One More Run, final segment 0014, Garbage Dump Glacier |

The source pack segment counts are 18, 17, 15 and 15, respectively; the total original-source catalog is therefore more extensive than these 12 selected segments. The last segment in each song is usually shorter than the other 12-second OGG segments; the test ensures its true source length is sufficient rather than blindly assuming a full 12 seconds. No original media was copied or rewritten for Git.

The complete report is `docs/music-review/20261123-original-segment-spread-game-output-qa.json`, SHA-256 `ee588e5f2ffaeab7195e402ab8d9fd869b169b01517bcff10513a88f21c687ea`. Its 216 original OGG fingerprints were independently validated against the private immutable archive with `verify-original-segment-spread-report.mjs`; this also verifies all twelve segment indices, metadata and output limits.

## Repeat the measurement

Serve a Vite build on a **localhost/secure origin** with the original OGG pack files available under `/music/packs`, without committing private source audio to the repository. For example, using a configured internal preview:

```sh
MUSIC_BUS_SEGMENT_SPREAD=1 \
MUSIC_BUS_URL=http://127.0.0.1:19029/tools/music/final-game-music-bus-audit.html \
MUSIC_BUS_REPORT=/tmp/bsb291-new-immutable-evidence.json \
node tools/music/run-final-game-music-bus-audit.mjs
node tools/music/verify-original-segment-spread-report.mjs \
  /tmp/bsb291-new-immutable-evidence.json /path/to/private/original/packs
```

The CLI refuses to overwrite prior reports and fails if any output is nonfinite, exceeds digital unity or reaches the ≥0.98 near-unity threshold. The validator also refuses mismatches against source OGG SHA-256 values. Legacy `load(pack)` and original `audit(packs)` remain callable; the new `auditSegmentSpread` is an explicit opt-in.

## Still outstanding for #291 — do NOT close

This is **not a full-song continuous render**: it samples the first 2.5s of three selected segments, not every second or every intervening OGG segment; the exact rendered graph is MUSIC bus without real player SFX, wind/static, collisions, fatal count-in, pause and device resampling. These are raw sample peaks, not a certified oversampled true-peak measurement, integrated loudness or a phone/Chromebook CPU test. Owner's listening A/B of actual game output (not just the standalone single-song FX labs), independent code review and eventual full final-output device QA remain separate requirements. Preserve previous failed controls, source archive and ear decisions.

## Follow-on: ALL 65 original OGG segments — completed

Expanded the opt-in audit from the twelve selected source segments to **every available original segment of all four source packs**. The full 260-case measurement is the additional checked-in artifact `20261123-all-segments-original-game-output-qa.json`, SHA-256 **`9910114bbdd3a7eb2bbe91a89cdab538451e08eafda0e62db0c3471851525a1b`**. Each original segment is evaluated at 0.75–3.25 seconds after its own musical entry, with original source vocals, separate biome lead, the real game MUSIC-bus/routing/room/master/compressor and final protective guard, at the maximum user volume settings.

| Original song pack | Segments | Rendered cases | Highest observed sample peak | Worst biome |
|---|---:|---:|---:|---|
| Pope Leo `01_FEsxYVStla4` | 18 | 72 | 0.936171 | Crystal Cavern |
| Every Hacker `03_WRBGQUqD54U` | 17 | 68 | 0.937371 | Crystal Cavern |
| Varmont Is Saved `31_FYImnz5-hXs` | 15 | 60 | 0.930220 | Crystal Cavern |
| One More Run `33_local-one-more-run-bitstream-bluffs` | 15 | 60 | 0.947184 | Garbage Dump Glacier |
| **TOTAL** | **65** | **260** | **0.947184** | |

**ALL 260 outputs passed:** 0 samples above full scale, 0 near-unity ≥0.98, and 0 nonfinite. Independent verification matched **1,170 original source-file SHA-256s** against the immutable original archive and confirmed every source segment position and output metric.

### Why the full run was split per pack

A single long Chromium render hit Puppeteer's **180-second DevTools protocol timeout** midway through all 65 segments, without saving a complete JSON report. It was an automation transport timeout, **not a measured audio overload**. The repeatable replacement accepts `MUSIC_BUS_PACK` together with `MUSIC_BUS_ALL_SEGMENTS=1`; each song runs in a fresh browser/process, writes an exclusive immutable per-pack report, and is validated independently. The `merge-original-segment-spread-reports.mjs` utility combines four validated reports without overwriting older evidence. This avoids sacrificing work on longer multi-song audits and preserves exact constituent SHA-256 provenance. The standalone runner now has an explicit 300-second protocol timeout, but per-pack bounded execution is still the recommended path.

For each allowed song pack ID, run (substitute a unique output path and localhost-served game build):

```sh
MUSIC_BUS_ALL_SEGMENTS=1 MUSIC_BUS_PACK=01_FEsxYVStla4 \
  MUSIC_BUS_URL=http://127.0.0.1:19029/tools/music/final-game-music-bus-audit.html \
  MUSIC_BUS_REPORT=/tmp/bsb291-pope-immutable.json \
  node tools/music/run-final-game-music-bus-audit.mjs
node tools/music/verify-original-segment-spread-report.mjs \
  /tmp/bsb291-pope-immutable.json /path/to/private/original/packs
```

Run the other three packs with their own output names and combine with the merge helper. For verification, the checked-in aggregated JSON has SHA-256 `9910114bbdd3a7eb2bbe91a89cdab538451e08eafda0e62db0c3471851525a1b` and embeds only pack IDs, source fingerprints and numerical measurements—not original music bytes.

**Important remaining limits:** The all-segment sweep samples 2.5 seconds of *each* original source segment, not every sample across the complete multi-minute songs or boundaries between segments. It uses the actual music bus but **does not add concurrent real game SFX, BSOD wind, impact/collision, glitch/static or fatal count-in**; those are next #291 test axes. The final transfer function's own 2× oversampling does **not** certify intersample true-peak; there is no low-end hardware/phone/Chromebook performance or owner listening sign-off yet. These remain release blockers. Neither this result nor the prior tests authorizes an automatic audio release or a change to the user's musical preferences.
