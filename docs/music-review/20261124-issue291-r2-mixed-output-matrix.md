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

## Source-bound offline crossfade headroom comparison

Third live preguard attempt changed only the diagnostic environment: playback latency hint (actual base latency 23.22ms at 44.1kHz) and 32768-frame worklet message batches vs 1024. Strict continuity still rejected a repeated 128-frame quantum (expected 354688, actual 354560). Frequent PCM messages are not a sufficient explanation; no root cause or paired live verdict established. Report SHA-256 2b4f959f6eb94b121e471f80e46aadec105e1e2c8248629d104bade590a6db7c. No relaxation of capture rules.

Complementary offline comparison uses exact R2 outgoing last 3.8s and incoming first 3.8s, including all intersecting segments (no synthetic padding), production planSongCrossfade/automateTransition (2.8s fallback, 32 envelope steps), shared native StemFXMixer and AudioSynth compressor, identical input to parallel native guard curves. Frozen outgoing vocal effects and room sends and fixed source gains; NOT a faithful dynamic transport reproduction or actual gameplay/SFX/physics capture. One second on either side of overlap measured, 4.8s per case. Independent catalog and manifest hashes and 84 decoded source hash checks against publication inventory, all coverage intervals verified.

| Index | Biome | Baseline estimated dBTP | Candidate estimated dBTP |
|---|---|---:|---:|
| 1 | Vertigo | -.317 | -1.019 |
| 4 | Candy | -.672 | -1.220 |
| 25 | Garbage | -.569 | -1.242 |
| 26 | Vertigo | -1.070 | -1.443 |
| 31 | Vertigo | -.546 | -1.223 |

5/5 offline overlap cases below -1dBTP with candidate, 24s measured, max absolute RMS change .020144dB, zero measured clips/overs in either arm. Worst candidate only .0186dB below preferred target; do not imply a robust calibrated safety margin. Private report SHA-256 1a5a35f77a0a861287818bac7b481e2047d31edc7f40918ebda302e41a8ab8b0. All five hot-ending comparisons reproduced after helper refactor; 81/81 focused tests pass. No source/production changes. Next: actual candidate live postguard comparison or different audio environment, independent review, human listening and device acceptance; do not claim exact same-input live crossfade comparison.

## 33-transition candidate sweep and revised headroom target (2026-11-24)

The initial candidate from experimental PR #321 (.78 soft knee, .88 ceiling) was **not** sufficient for the full published playlist. Extended from five targeted transitions to all 33 consecutive catalog handoffs (including the last-to-first wrap), source-bound to the immutable R2 inventory, with the five earlier hot biome assignments preserved and remaining transitions stratified across Candy/Garbage/Vertigo/Crystal/Arcade. Each paired offline render includes the final 3.8s of outgoing audio and first 3.8s of incoming audio; exactly 2.8s time-based fade and 4.8s measured per transition. The original seven audio roles and every segment intersection were hashed against publication inventory objects. The native production compressor feeds the original guard and one candidate guard in parallel in the same render. This is a **controlled offline reconstruction**, not a live transport/device capture or proof across all 12 biome identities.

| Parameter or metric | Current release | Candidate v1 | Candidate v2 |
|---|---:|---:|---:|
| Soft knee | 0.86 | 0.78 | 0.74 |
| Soft ceiling | 0.965 | 0.88 | 0.82 |
| Transitions at or below -1 dBTP | 23/33 | 32/33 | **33/33** |
| Worst estimated peak | -0.222 dBTP | -0.799 dBTP | **-1.268 dBTP** |

Both candidate versions had zero sampled clips/estimated intersample overs in these 33 windows. Candidate v2's maximum absolute RMS difference from the current release was **0.041844 dB**. The stronger candidate was selected for further testing because it retains approximately 0.268dB margin beneath the preferred -1 dBTP line in this offline matrix, whereas v1 missed that line. A small RMS difference **does not** establish that short transients sound identical.

The v2 report was independently verified against the original catalog and 33 SHA-256-checked pack manifests, 504 decoded OGG hash checks, all source frame intervals, 33 distinct ordered transitions, paired window/peak math, and negative tamper controls. The report verification can be rerun with:

```sh
QA_REQUIRE_MINUS_1=1 node tools/music/verify-r2-crossfade-paired-report.mjs \
  /path/to/all33-offline-paired-74-82.json /path/to/publication-330-inventory.json
```

Candidate v1 full-33 report SHA-256: `c3b5de7dc276f4c7089c0f1f825450ddd56bd85f78ee9fed9ba7aca734e3e857`.
Candidate v2 full-33 report SHA-256: `68c1ef6d694f66309aa8c081c55477943006e85f804068f183b3bc22750676c1`.

### Independent 99-window mixed SFX validation — candidate v2

The v2 knee/ceiling were then applied in **parallel with unchanged production output** for all 33 opening, middle, and ending sampled windows (99 cases; 363.99 seconds measured). Actual published original OGGs and melody derivatives, native AudioSynth compressor/wind/SFX/BSOD/glitch/hard landing/crash methods, and exact production mixer were used. Every one of the 693 source-hash checks matched publication inventory. A second verifier compared each production baseline to the previously accepted independent production report (same track, source hashes, event schedule, output sample/peak/RMS within 2e-5). The strongest candidate got:

- **99/99** candidate 4x estimated true peaks at or below **-1 dBTP**, worst **-1.743671 dBTP** (One More Run / Vertigo / ending);
- zero sampled clips, estimated 4x intersample overs, nonfinite samples, page errors, or HTTP errors;
- maximum absolute candidate-versus-production RMS change **0.019861 dB**;
- all three independent R2 verifiers passed, plus combined 99-window baseline/candidate verifier and tampered-report negative controls.

The additional reports were accepted with:

```sh
for phase in opening middle ending; do
  QA_REQUIRE_MINUS_1=1 node tools/music/verify-r2-mixed-matrix.mjs \
    "/path/to/${phase}-paired-74-82.json" /path/to/publication-330-inventory.json
done
QA_REQUIRE_MINUS_1=1 node tools/music/verify-r2-paired-99.mjs /path/to/report-directory
```

Report SHA-256 values: opening `e574c3f349eb868d22dc897f216deb230df6d1266afbf590e143052367c77229`, middle `335781c49bc6999a8610c5cfd29cd43d73a4d6252106082162785201a74af3cc`, ending `27640a624f2f9d85dec13c4a1606cbc1c11a7a545fbef4adb74bf2c3452caea4`.

**Combined controlled sampled evidence:** 132/132 independent windows below the preferred -1 dBTP estimate with candidate v2; 1197 source-hash checks (repeated OGG objects can be counted more than once), no measured clipping. This is not certification for every sample of every complete song, every biome, or physical device/browser implementation.

### Listening approval and release distinction

Created **six blind, matched 4.8-second 24-bit FLAC A/B pairs**, baseline vs candidate v2, including catalog index 0 (the v1 miss) and all five earlier targeted high-risk handoffs. Audio is source-bound to the accepted 33-transition report and regenerated without loudness normalization. Owner-only temporary Tailnet preview: `http://100.115.120.66:18249/` (server subject to expiry). Version 1 preview on port 18248 represents the *older, insufficient .78/.88 candidate* and must not be confused with v2.

The existing isolated candidate build and draft PR #321 still represent **v1 (.78/.88)**, not v2. In that isolated build, four of five targeted live post-guard crossfade captures qualified with no clipping; index 1 failed strict continuity twice. **No v2 live output has been certified.** Repeated -128-frame timestamp failures in preguard tap experiments are preserved as invalid instrumentation, not filtered out or assumed to represent actual speaker glitches.

**Remaining release gates:** owner blind listening feedback, independent code/QA review, direct v2 live-device/browser output capture (or an explicitly accepted substitute with accurate limitations), and a decision on acceptable sound and target margin. No production guard or approved biome mix has changed; no Netlify deployment requested. Issue #291 and QA-only PR #339 remain open/draft.

## Isolated v2 native candidate: actual live final master (2026-11-24)

A clean production build was generated from draft candidate branch `friday/issue291-guard-v2-20261124` commit `171fb5cab2131c380e76ee40a5c87329271542b1`, based directly on main. The only runtime changes are the native final post-compressor soft guard knee/ceiling (.74/.82; unchanged 8193-point curve implementation, 2x oversample). The built `main-JieFBNnP.js` bundle SHA-256 is `3c0884e8e86acfdef433bf17cbe1ad644a9eb9070de5a4dc0a22de628ec7927b`. This build and QA worklet were served via a loopback-only static HTTP server, **not deployed**.

Using existing unmodified v4 worklet continuous final-output tap and actual game StemMusicDirector crossfades (released R2 catalogue; max master/music/SFX/wind settings and vocals unlocked, controlled high-risk biome, g.loop.stop), **six of six** targeted v2 live transitions obtained qualified continuous PCM: 54.372426 seconds, no measured sample clips, intersample overs, nonfinite samples, or near-silent overlap windows. All fades were real 2.8-second time-based fallback. Independently computed FFmpeg true peaks agree with the separate 4× estimator. Three earlier attempts were rejected for v4 per-quantum timestamp chronology faults, retained and not counted as passes; retries were permitted **only** for invalid instrument captures, never a measured audio failure.

| Index | Biome | Live estimated dBTP | Independent FFmpeg dBTP | Accepted report SHA-256 |
|---|---|---:|---:|---|
| 0 | Candy | -1.806 | -1.8 | bc8d5dac0b421292c467b9e3bfd7a69aeb5299319151b5ebd2881a55f8f95ee0 |
| 1 | Vertigo | -1.555 | -1.5 | 37bc54df904c49cb74eb51fd0487051c949c4f82f5c817ba16c118435674d8ba |
| 4 | Candy | -2.415 | -2.4 | b039dfb942319d38709c87c098093fbcaaaba8f2c0ba7c68814aae98dfce2b2a |
| 25 | Garbage | -2.641 | -2.6 | 17107c075f54a5a2ba5cc1ac86f8d33b498e683f9bd88b5a7f740843c2a1723e |
| 26 | Vertigo | -1.993 | -2.0 | bff1a89874f98464c613222514a702b1d8f31beef5b92135991a6b16576eca69 |
| 31 | Vertigo | -1.871 | -1.9 | c4cfce1d2647bf9e97aab786f1b3405cb56f1ead6eb72c8b82acba2da418b30f |

Rejected report SHA-256 values for 25-a, 26-a, 26-b respectively: `e58cf55a8e34f10b36a220caa375561d35ee350ad7bb4bc0406708e41f2a2863`, `fe58f037ac92b1f0012144ea0fc5e7a94df25e32386f9b0ff29063155d1447ba`, `27bf9b9906adeb9a830a6397ce380d311f9a16cb91496dea29062e043644a704`.

The new independent verifier checks the original immutable R2 catalog SHA, exact ordered song/pack identity, native fade length/clock, incoming and outgoing source role lifetimes, complete v4 worklet receipts, samples/FFmpeg thresholds, zero quiet intervals, all accepted report hashes and the three invalid attempts. Run:

```sh
node tools/music/verify-r2-guard-v2-live.mjs /path/to/report-directory /path/to/publication-330-inventory.json
```

**Limitations remain:** the captured report does not cryptographically attest which JS bundle was running; the build identity and SHA were recorded separately. Controlled game DSP is not uninterrupted real terrain/gameplay; browser is local headless Chromium, not physical Chromebook. The stronger guard is still awaiting owner blind A/B listening and independent production code review. No claim of complete full-song or all-biome mastering certification. Current production curve remains unchanged; new clean proposal is draft PR #340. No Netlify deployment requested.
