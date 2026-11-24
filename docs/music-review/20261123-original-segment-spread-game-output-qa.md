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
