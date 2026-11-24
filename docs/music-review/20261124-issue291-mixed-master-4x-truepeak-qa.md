# Issue #291 — Chromium original-music + SFX/wind/static final-output QA

**Status: experimental, reproducible sampled stress evidence — NOT final mastering.**

This adds no production audio gain, limiter, DSP, game-physics, original OGG, synthesized lead or beat-grid modifications. The approved mix stays intact.

## Why this test was needed

Earlier #291/#298 output evidence covered the 65 source segments of the first four original songs as isolated original MUSIC output through the real biome processors, room, compressor and post-compressor peak guard. It did not verify the combined final output with **actual gameplay sound effects, BSOD wind, glitch static or impact/crash sounds**.

This new Chromium OfflineAudioContext harness invokes the **production AudioSynth._buildGraph()** and production AudioSynth.playSfx, _onLanding, _onBsodState and glitch APIs. Original source material is loaded from the owner's private 33-song OGG catalog, sent through the production StemFXMixer, current owner-reviewed original-stem DSP and room impulse, then merged with true production wind, static and SFX into the real audio master/compressor/OutputPeakGuard graph.

Every render includes five original recorded instrumental stereo stems, original lyrical vocals and the matching separate biome-melody lead (at the game default 18% when original vocals are enabled), with test master/music/SFX/wind volumes all at maximum.

**Only the event times are scripted.** They are not falsely claimed to be from a real player replay. The test fixes the presentational cosmetic RNG at QA seed 0x2912026 using the game's supported API. No gameplay RNG, replay state, user save, source media or live engine defaults change.

## Actual game sound stress timeline

Each render is 4.1 seconds at 48 kHz stereo; the checked window is 0.20–3.85 seconds.

| Context time | Production Web Audio action | Sound |
|---|---|---|
| 0.38 s | AudioSynth._onBsodState | Continuous maximum near-wall BSOD wind |
| 0.62 s | AudioSynth.playSfx(hop) | Gameplay jump |
| 1.10 s | AudioSynth.glitch(static, 950ms, .92) | Native bitcrusher + glitch static |
| 1.68 s | AudioSynth._onLanding(hard) | Hard landing with wind and static still present |
| 2.34 s | AudioSynth.playSfx(hazardScramble) | Dense glitch-hazard SFX |
| 2.82 s | AudioSynth.playSfx(crash) | Actual crash SFX in sustained wind |

Four additional stress scenarios add a second **real AudioSynth static burst at 2.62 s**, overlapping crash, static and BSOD wind.

The test invokes the correct AudioSynth methods during real OfflineAudioContext suspend/resume moments rather than approximating audio event envelopes with guessed mixed PCM. These are still **scripted event stimuli**, not actual physics events. The special four-drum original recording FatalCrashCountIn is a separate component and is not yet covered.

## True-peak estimation

The full original source + gameplay audio master stereo PCM is scanned for raw sample clips, RMS, and 4× intersample peaks using a **48-tap, DC-normalized, Hann-windowed-sinc** filter across three fractional positions between original samples. The unit suite proves it catches high-frequency intersample overs even when all native samples are below 1.0.

This is an **approximate** 4× band-limited reconstruction, NOT calibrated/certified ITU-R BS.1770 mastering. It is therefore explicitly reported as an *estimated* dBTP; no release-compliance guarantee is claimed.

## Source provenance and immutable evidence

The QA browser is served on **localhost only** with an externally configured read-only private OGG overlay. No audio copy lands in a public deployment or Git worktree.

Every browser render SHA-256 hashes all seven original input OGG files. The independent Node report validator then reopens those identical original OGG files from the user's canonical private archive, recomputes every SHA-256, verifies each requested track/segment/biome combination and rejects missing cases, wrong original bytes, broken HTTP requests or JS exceptions.

The original 48-case matrix is 4 installed original songs × 3 song sections (first/middle/last) × 4 high-risk biome identities (Garbage, Vertigo, Crystal, Arcade). Four additional original-source scenarios deliberately overlap native crash, static and wind. The reports are persisted as **exclusive-create JSON** and not overwritten.

An initial unseeded run independently passed 48 normal plus 4 overlapping renders, verifying 120 distinct original OGG identities and 336 normal source inputs. That evidence remains preserved separately; the **fixed-seed rerun below supersedes its exact peak numbers** and is the canonical reproducible measurement.

## Final fixed-seed results

The independently rehashed final fixed-seed result is **PASS — sampled mixed output, not mastered release**:

| Check | Final fixed-seed measurement |
|---|---:|
| Scripted native mixed game-output renders | **48/48 PASS** |
| Additional simultaneous crash + static + wind stress renders | **4/4 PASS** |
| Source songs / high-risk biomes / original sections per song | **4 / 4 / 3** |
| Unique original OGGs independently rehashed on local disk | **120** |
| Normal original-source fingerprint checks | **336 / 336** |
| Additional overlap source fingerprint checks | **28 / 28** |
| Over-unity audio samples / estimated 4x intersample overs / nonfinite PCM | **0 / 0 / 0** |
| Worst mixed native sample peak | **0.958714** |
| Worst mixed **estimated 4x true peak** | **0.959000, −0.364 dBTP** |
| Highest 4x overlap true-peak estimate | **0.949503, −0.450 dBTP** |
| Unexpected browser/network errors | **0 / 0** |

Worst normal stress sample: Every Hacker (Runs Out of Code) Part 2, **last original song segment 0016**, Garbage Dump Glacier. The original One More Run / Garbage case remains representative but is no longer the loudest after the deterministic QA seed was pinned. No original recordings or game mix gains were changed.

The canonical immutable private aggregate is saved at the following owner-local path (never committed to Git):

    /home/hermes/experiments/bitstream-melody33-private-20261123/issue291-sim8-mixed-independent-52case-SEEDED-summary-20261124.json

**SHA-256 of the canonical aggregate:** f2464f745ee6a1ee6c2120fb070264851707aabe5cb1aa5bd24eeeba754755af

A dedicated private-source rerun check is available as a QA-only tool:

    node tools/music/verify-mixed-truepeak-repeat.mjs

A negative validation check deliberately changed a drums SHA-256 in a **disposable copy** of a signed report. The independent canonical OGG rehash correctly failed and refused to create an aggregate. It did not mutate any real source or prior report.

The seed makes this numerical measurement reproducible within native browser floating-point variation. A deliberate independent two-render repetition with **identical seven OGG hashes and same scripted event timestamps** agreed within **1×10⁻⁶** for the sample peak, estimated intersample peak and RMS (observed maximum difference below 1×10⁻⁷); exact bit-for-bit floating-point identity is not claimed.

**Caution:** The final estimate leaves only about **0.36 dB** of reconstruction headroom under this stress profile. That is below a conservative −1 dBTP target. The sample limiter prevented any demonstrated 0 dBFS/0 dBTP overs in this test, but this is **not evidence of adequate professional mastering headroom**. No owner-approved biome gains should be silently changed in response to a single audit.

## Reproduction — private local-only

Use only a locally authorized original audio root containing catalog.json and packs. Start the QA browser development server:

    BSB291_PRIVATE_AUDIO_ROOT=/private/owner-catalog node tools/music/serve-private-mixed-qa.mjs

Default host: 127.0.0.1:8220. This is NOT the public game server.

Run all original-song sections in independent per-song processes, then the extra crash/static/wind overlap:

    for i in 0 1 2 3; do
      QA_EXTENDED=1 QA_SONG_INDEX="$i" \
        REPORT_OUT="/private/reports/issue291-mixed-sim8-extended-song-$i-seeded-20261124.json" \
        node tools/music/run-mixed-original-truepeak.mjs
    done
    QA_OVERLAP=1 REPORT_OUT=/private/reports/issue291-mixed-sim8-overlap-seeded-20261124.json \
      node tools/music/run-mixed-original-truepeak.mjs

Independently rehash all input OGG files and merge reports:

    BSB291_PRIVATE_AUDIO_ROOT=/private/owner-catalog \
    BSB291_BATCH_SUFFIX=seeded-20261124 \
    REPORT_ROOT=/private/reports \
    QA_OVERLAP_REPORT=/private/reports/issue291-mixed-sim8-overlap-seeded-20261124.json \
    REPORT_OUT=/private/reports/mixed-output-independent-merge.json \
    node tools/music/validate-merge-mixed-truepeak.mjs

All report paths must be unique. Report files and private original audio stay outside Git. Test-math unit tests can run without the original music, but a real source audit fails if source material is unavailable.

## Remains OPEN before release

- **All 33 songs** and remaining internal segments, continuous full-song playback, crossings, transitions, low-end devices and optional instrumental performance remain outside this focused 4-song first/mid/end stress report.
- The original-song four-drum fatal crash count-in requires its own full master scenario on a genuine original drum phrase, not an invented beat.
- Capture **authentic gameplay-driven** simultaneous BSOD proximity, impacts and glitches—not only these fixed offline event times.
- Confirm oversampled true peaks with an **independently calibrated mastering meter** and subjective owner playback. If below 1 dB of reconstruction headroom, flag this explicitly; do not silently attenuate owner-approved biome textures.
- Verify ChromeOS/Android CPU impact, voice count, buffering, latency and actual device playback, alongside real mastered continuous audio.

**Do not close #291, merge this draft, or publish original masters on the basis of this sampled QA.**
