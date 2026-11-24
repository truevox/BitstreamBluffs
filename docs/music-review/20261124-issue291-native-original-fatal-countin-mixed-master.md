# Issue #291 — Real original-drum fatal count-in + native mixed Web Audio output

**2026-11-24. Code-only pre-release QA; no production audio, game physics, beat-grid or source OGG changes.**

This work closes a coverage gap left by the earlier 52-case mixed SFX/wind/static original-music test in draft PR #310: the actual four-hit recorded-original-drum death count-in was excluded from those tests. The owner-approved original six-stem recordings, recording mix, biome FX, gameplay levels, and master output guard are unchanged.

## What is measured, exactly

The QA invokes the **actual production FatalCrashCountIn.start class**, using the **actual selected original recorded OGG drum stem** as the source of four short attacks, plus the production original six-stem recovery gate and production turntable scratch. Real AudioSynth master, compressor, final peak guard, native impact/crash SFX, BSOD wind, source-only biome DSP and glitch static are mixed simultaneously in a 48 kHz stereo Chromium OfflineAudioContext.

Original recorded drum attacks are selected by the original song onset detector. If the current original segment is too quiet, the real FatalCrashCountIn.prepare method preloads original unchanged drum OGG segments 1–3 from the song, and the exact OGG source SHA-256 is preserved. The harness fails closed instead of fabricating a drum sample.

The browser is paused at an exact native audio-context time for event scheduling. This leaves OfflineAudioContext.state reporting suspended; production FatalCrashCountIn.start deliberately requires a running context. A **test-only running-state scheduling facade** forwards actual native Web Audio node creation to that real offline context. The production class, safety rules and live-game state checks are not changed. This is a disclosed scheduling shim, NOT an actual in-game collision.

**Critically, the four sounds are recorded original audio, but their positions remain synthetic-unverified 0.5-second test grid intervals.** There is no promotion to source-authentic BPM, downbeat or released game beat map.

## Stress event timeline

Each approximately 5.55-second render uses the original song's five recorded accompaniment stems, recorded lyrical vocals and biome-melody lead. Production native event APIs are invoked at scripted sound-context times:

- 0.28s: real BSOD near-wall wind.
- 0.47s: hop SFX.
- 0.72s: real crash SFX + native four-hit fatal original-drum recovery.
- 1.20s: real static glitch.
- 2.40s: native hazard-scramble SFX.
- 3.38s: hard landing SFX.

The original recorded drum accents then sound at 1.925, 2.425, 2.925 and 3.425s. Native recovery gates restore original band audio around 3.925s.

A **matched native original-music control without the count-in** is rendered with the same source OGGs, same events and pinned cosmetic-noise QA seed 0x2912026. For each drum window the final stereo PCM RMS and difference RMS are calculated. Any difference includes real recovery gating plus drum accents and is NOT described as isolated drum loudness.

Raw sample and **estimated 4x intersample peaks** use the existing 48-tap Hann-windowed-sinc PCM meter. This is NOT an independently calibrated ITU BS.1770 mastering certificate.

## Four original recorded songs: 24 real-source crash stress cases

Four established original recordings x three original sections per song (opening, middle, last) x two high-risk biomes (Garbage Dump Glacier and Vertigo Vents):

- **24/24 actual production original-drum-count-in renders plus 24 matching controls passed.**
- **96/96 recorded source-drum hit windows** had measurable final stereo output differences versus controls, minimum difference RMS **0.01815**.
- The independent canonical-source validator matched **168 original stem/voice source uses to 96 distinct original OGG files**, and verified the exact selected original recorded drum source used by the count-in.
- **Zero native PCM clips, zero estimated 4x reconstructed overs and zero nonfinite PCM samples.**
- Worst estimated peak **0.954647, -0.403 dBTP**, Every Hacker Part 2, original segment 8, Vertigo Vents.

Private immutable aggregate SHA-256: **9e16119f460667e9d56d61b626417fe152ca60469d8584e9e9cf4577e6ea2a19**.

Private local evidence filename: issue291-original-fatal-mixed-24case-independent-audit-v1-20261124.json under /home/hermes/experiments/bitstream-melody33-private-20261123/.

## All 33 original source songs — opening-segment first pass

The follow-on 33-song first-segment sweep uses the same exact native class and original-source verification, with Garbage Dump Glacier as the stress biome.

- **33/33 separate original-song crash-count-in/BSOD-wind/static/landing/hazard mixes passed**, each compared to a separate original-music/no-count-in control.
- **132 original recorded OGG drum attacks**, all of which produced measurable differences in the final stereo PCM from their paired control. Smallest original-source/control difference RMS was **0.01181**.
- Independently verified **231 browser-decoded OGG stem/voice input hashes** and **236 distinct original OGG files from the owner's private archive**, including the exact extra native original drum-warmup files.
- **Five original songs needed the production count-in's source-original drum warmup**: the first original segment was not sufficiently attack-bearing; recorded drum segments 1–3 were loaded and verified without fabricating drums.
- **Zero sample-domain clips, zero estimated 4x intersample overs, zero nonfinite PCM.** Highest measured output sample/estimated true peak: **0.953748, -0.411 dBTP**, in Garbage Dump Glacier on the first segment of song R5mnA0yw8YA.
- Canonical immutable independent aggregate SHA-256: **f1c79ac9744da8555883fda2454c94e96913eb5774e6837f687403f97adc97d6**.
- Local-only aggregate file: /home/hermes/experiments/bitstream-melody33-private-20261123/issue291-full33-fatal-mixed-original-ogg-aggregate-v1-20261124.json

The sweep covers **one actual original recorded opening segment per song and ONE biome**, NOT all 33 full songs, their segment transitions or the other 11 biomes. Both the source and timing limitations remain unchanged.

## Reproduction using the original owner-authorized media archive

Run the private read-only localhost source overlay and the new source-bound script. This never copies OGG assets into Git or into a public build.

    BSB291_PRIVATE_AUDIO_ROOT=/private/owner-catalog node tools/music/serve-private-mixed-qa.mjs

For a given original song in the private 33-song roster:

    QA_ALL_33=1 QA_SONG_INDEX=0 REPORT_OUT=/private/reports/new-unique-report.json node tools/music/run-original-fatal-mixed-truepeak.mjs

For the original 4-song 3-section 2-biome matrix omit QA_ALL_33, set QA_SONG_INDEX from 0 through 3, and use a unique report path per song. The independent source verifier checks the first-four-song report files.

For all 33 source opening segments, run song indices 0 through 32 with QA_ALL_33=1, each with its own unique output file. Then run the independent full-33 source-file verifier with the original private media root, private report directory and an untouched new aggregate filename.

    BSB291_PRIVATE_AUDIO_ROOT=/private/owner-catalog REPORT_ROOT=/private/reports REPORT_OUT=/private/reports/new-unique-aggregate.json node tools/music/verify-full33-fatal-mixed-truepeak.mjs

No private media or source audit JSON is uploaded to GitHub. All reports are written with exclusive file creation; prior evidence is never overwritten.

## Open release gates

This is **scripted native audio stress**, not an authentic gameplay-derived BSOD collision. Existing real-collision tests cover the MUSIC BUS alone, not final mixed-output true peaks. Full 33-song uninterrupted playback/segment boundaries, all biome effects, calibrated reference loudness/true peaks, low-end ChromeOS and Android, original recorded rights and human listening approval remain outstanding. All 33 source beat maps remain unverified and fail-closed; no authentic original beat grid is established here.

**Do not close #291, merge a draft or silently normalize owner-approved biome textures on this sampled evidence.**
