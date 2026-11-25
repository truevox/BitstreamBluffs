# #291 — released R2 mixed-output middle-section sweep

2026-11-24. Production source baseline: 044ebd4b (v2.21.2 + merged Heavy Mode). Only developer QA files differ. Actual R2 release pinned to 20261124-69a6fb46, 33 tracks. No source modification, no public media upload, no change to production DSP/peak guard or owner-approved mixes.

## Method

Run the existing native AudioSynth/StemFXMixer OfflineAudioContext stress graph at production maximum master/music/SFX/wind settings and vocals enabled; original recorded instrument/vocal OGG plus the published derived biome melody, with pack-authored vocal processing and room sends. Seven scheduled SFX events per case include BSOD wind, hop, static, hard landing, hazard scramble, second overlapping static, and crash SFX. Rotating high-risk biome selection is intentional stratification, not a complete track-by-biome cross product. Use actual middle segment index floor((count-1)/2); 4.1 seconds rendered, 3.65 seconds measured per case, 48 kHz stereo and 48-tap 4x finite-window intersample estimate.

```sh
npm run dev -- --host 127.0.0.1 --port 18244 --strictPort
# Separate terminal, unique output path:
QA_R2=1 QA_URL=http://127.0.0.1:18244 REPORT_OUT=/path/to/new-report.json node tools/music/run-mixed-original-truepeak.mjs
node tools/music/verify-r2-mixed-matrix.mjs /path/to/new-report.json /path/to/publication-330-inventory.json
```

## Results

33/33 completed; 120.45 measured seconds, 231 source inputs. Zero sample clips, zero estimated 4x overs, zero nonfinite samples, zero browser/HTTP errors. Worst sample peak 0.8403633833; worst estimated true peak -1.455542 dBTP (Every Hacker (Runs Out of Code) - Part 2 of 2, Vertigo Vents, segment 8).

| Biome | Cases | Worst estimated dBTP |
|---|---:|---:|
| Candy Cane Canyon | 7 | -1.595 |
| Garbage Dump Glacier | 7 | -1.900 |
| Vertigo Vents | 7 | -1.456 |
| Crystal Cavern | 6 | -2.058 |
| Arcade | 6 | -2.943 |

Independent verifier fetched the published catalog and all 33 pack manifests, confirmed their 34 byte lengths and SHA-256 values against the original 14,637-object release inventory, then matched all 231 recorded OGG hashes and checked the complete deterministic case matrix and zero-over numerical metrics. Negative control: one altered drum hash rejected. 68/68 existing focused tests passed.

Private read-only evidence:
- report SHA-256 15a15fd02723f50425cac6818c3604a3663ec8b112dd3ed4eae8b5d5e71263de
- publication inventory SHA-256 0b31cce800d99b5c47e406099682bb13f81b027124133bd2a9f6d0bb335168cb

## Boundaries

No claim of uninterrupted full-song coverage, all 12 identities per song, live terrain-driven mixed events, real fatal four-beat count-in (separate earlier sampled evidence), full overlap/crossfade matrix, standardized calibrated true-peak compliance, device CPU performance or human mastering acceptance. The earlier near-zero headroom crossfade and candidate headroom results remain relevant. Next: expand first/last segment coverage and investigate worst overlap passages on current production before considering any mastering change. No auto-normalization; owner listening and independent review remain prerequisites for any production mix change. Keep #291 open; QA-only draft.
