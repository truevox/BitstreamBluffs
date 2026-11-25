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

## Opening and ending extension

`QA_R2_PHASE=opening` and `QA_R2_PHASE=ending` select 33 cases each, rotating the same five high-risk identities by -1/+1 respectively versus middle. Opening begins at source frame zero; ending seeks to max(0, last segment frames - 168000), at 48 kHz. All seven decoded buffer lengths must exactly match manifest frames. The measured window [7680,184800) includes the true source ending and some native effect tail. Six last segments are shorter than 3.5s; these cases include the entire last segment, not the preceding segment, and some later stress events occur after the music ends. The independent verifier checks these bounds, phase assignment, exact end-of-song frame and published hashes, PCM window length, interpolator coverage and dB arithmetic. No artificial padding of source recordings.

| Phase | Cases | Measured seconds | Worst estimated dBTP |
|---|---:|---:|---:|
| Opening | 33 | 121.77 | -2.492398 |
| Middle | 33 | 120.45 | -1.455542 |
| Ending | 33 | 121.77 | -0.534602 |
| Total | 99 | 363.99 | -0.534602 |

99/99 sampled cases completed with zero sample clips, estimated intersample overs, nonfinite samples or HTTP/browser errors. 693 source hash checks across the three matrices (not necessarily 693 unique assets); 34 published metadata identities independently verified per phase. 68/68 focused tests again passed. All three reports pass updated independent verifier.

Five ending cases exceeded the engineering headroom target of -1 dBTP, but none exceeded unity:
- local-one-more-run-bitstream-bluffs / Vertigo / segment 14: -0.534602
- ehy7VzQezYA / Candy / segment 20: -0.555558
- S9WQYIg8VzY / Garbage / segment 19: -0.569181
- GMvUptcX0Vc / Vertigo / segment 15: -0.640824
- 4ex2Owu8yGM / Vertigo / segment 15: -0.910079

Do not interpret the sampled no-clipping verdict as a -1 dBTP headroom pass. Preserve approved mix; compare these cases and real crossfade overlaps before deciding on any master guard candidate. No production changes; no full-song or actual device certification.

Additional private report SHA-256:
- opening fa57cc46f7443c2cffc04bb190368fc9c7fca86ffca0acfec6b12b374c8e321e
- ending 2c3331ba80fc7ea0bcb13f12abcc66f14d97504cb1e8bc9c587e21fd0bfd2754

## Paired headroom experiment and targeted live public crossfades

QA only: identical native offline compressor output branches into the unchanged production 2x shaper and a parallel 8193-point 2x experimental shaper (knee .78, ceiling .88, same transfer equation as draft #321). Both stereo outputs are measured in the same four-channel offline render; baseline peaks/RMS reproduce the independently verified original ending report within 1e-6, and all source hashes/event receipts match. The original mixes and production guard remain unchanged.

| Song ID | Biome | Production estimated dBTP | Candidate estimated dBTP | RMS delta dB |
|---|---|---:|---:|---:|
| local-one-more-run-bitstream-bluffs | Vertigo | -.535 | -1.216 | -.00911 |
| ehy7VzQezYA | Candy | -.556 | -1.260 | -.00019 |
| S9WQYIg8VzY | Garbage | -.569 | -1.242 | -.00250 |
| GMvUptcX0Vc | Vertigo | -.641 | -1.273 | -.00045 |
| 4ex2Owu8yGM | Vertigo | -.910 | -1.389 | -.00028 |

All five passed sampled -1 dBTP target without clipping. This does not establish perceptual transparency or full-track/device compliance. Private paired report SHA-256 53097bd89555582796700685b77d2aa41e36e1f761fcd9a3d35258a293fc8336.

Actual released R2 game transport, controlled high-risk biome, public time-based 2.8s fallback (no private beat grids), max volume/vocals: two of five live overlap attempts qualified, no near-silent overlap windows and no clipping. Both independently verified against catalog identity and v4 continuity receipts; live source bytes not independently hashed in this capture. Remaining attempts preserved, not counted as passes. Index 4 failed browser-state evaluation (possibly dev-server reload, not established); indices 25 and 31 failed quantum continuity instrumentation. No conclusion on cause or device reliability.

| Catalog index | Result | Estimated dBTP | FFmpeg dBTP |
|---|---|---:|---:|
| 1 | Qualified, 9.140s | -.500 | -.5 |
| 4 | Browser-state failure | — | — |
| 25 | Invalid capture continuity | — | — |
| 26 | Qualified, 9.021s | -1.764 | -1.8 |
| 31 | Invalid capture continuity | — | — |

Private report SHA-256 values respectively: 7dcba6bf5ef519c1fd6296c99d5c2b4451caf364ef51673664e8ae8123f41e7d; 293f3e528a824b6c7657d08f42c5ea71b2d2206407275f63308544ad6858cc9e; 23a8b4be5abaf5d6e3499edebc463565b68e3bdddecbafea701119c46f062e78; 1aaec5749145097bfe3818a7de6fde4e73bfec69d9bd30f093e61fc69b9d333e; 5aba0e7f686d883ec6ffe22951fdc090fc2e7051d4ec269ccf10dccf727e832a.

81/81 focused tests passed, including new public R2 verifier negative controls. Next: stable live capture of the three unqualified overlaps and same-input crossfade guard comparison, independent review and listening/device gate. No production changes or deployment.

## Static production build follow-up

The previously unqualified three live overlap cases were rerun sequentially on a production build of ffa37036 (production source unchanged from 044ebd4b), served by a loopback-only static HTTP server, with the existing test-only capture worklet copied into dist/tools/music. No Vite HMR. All three qualified; independent verifier validated the entire five-case set against the published catalog SHA and v4 continuity receipts. 45.322449 seconds of accepted contiguous stereo PCM, zero sample clips, estimated overs, nonfinite samples, or near-silent overlap windows. All five transitions are actual 2.8-second time-based fallback crossfades, with vocals enabled and the designated controlled biome. Original three rejected attempts remain in the previous section; static success does not establish their root cause.

| Index | Biome | Estimated dBTP | FFmpeg dBTP | Accepted report SHA-256 |
|---|---|---:|---:|---|
| 1 | Vertigo | -.500 | -.5 | 7dcba6bf5ef519c1fd6296c99d5c2b4451caf364ef51673664e8ae8123f41e7d |
| 4 | Candy | -2.155 | -2.2 | 8a554de3463b63080bcd1e435ff47c5ff0f7e6ca941ec5b270798766a45db180 |
| 25 | Garbage | -2.858 | -2.9 | 3aa72915ade4ca96f015d4124cd951bde14d1f92d52a9f89ca2d458f0e6c1675 |
| 26 | Vertigo | -1.764 | -1.8 | 1aaec5749145097bfe3818a7de6fde4e73bfec69d9bd30f093e61fc69b9d333e |
| 31 | Vertigo | -1.082 | -1.1 | 3450ec0c7e5793a11a0f272557edf86be66aedc6b985e4a91f331d971a7c5ec2 |

Reproduction: build locally, copy the developer-only live capture worklet into the built assets at its expected URL, and serve dist on loopback using a static server. Invoke existing audit with QA_R2=1, QA_INDEX, QA_BIOME, GAME_URL and a unique REPORT_OUT for each case. The static server is for developer QA only, not publication.

Experimental same-input crossfade guard replay was attempted twice for index 1, tapping live compressor output upstream of the production guard and planning native offline replay through both curves. Both attempts failed strict post-arm continuity with a repeated 128-frame quantum timestamp (expected 329344, got 329216; expected 334592, got 334464). No valid paired metrics exist, no cause established, and no retry of measured clipping occurred. The unqualified experimental code is retained as a private patch, not included in this PR. Established capture diagnostics now retain the actual discontinuity receipt. The five qualified same-input ending comparisons remain valid. Do not promote candidate until crossfade comparison, listening, device testing and review are satisfactory. All source and production DSP remain unchanged.
