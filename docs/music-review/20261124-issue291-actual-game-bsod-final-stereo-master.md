# #291 — actual real-physics BSOD collision, final master PCM after peak guard

Status as of 2026-11-24: source-backed engineering QA, **not mastered/cleared for launch**. No game source audio, master gain, FX, collision physics, replay data or original-beat authority is modified. This is an additive, code-only test suite stacked on #306 through draft #310.

## Why this is different from the earlier 52 + 24 + 33 rendered cases

Earlier QA used genuine original stems and native AudioSynth SFX/wind/static and even the actual original-drum FatalCrashCountIn class, **but set sound-event times deliberately in an OfflineAudioContext**. A separate older real-game test actually resolved a BSOD wall collision but measured only the **music bus**. Neither established final post-compressor true-peak measurements during an actual game-triggered fatal event.

This new browser audit launches the actual SIM8 game under Chromium, starts a real original 33-song pack and enters real RunScene. It uses the exact established QA collision approach: freeze the normal animation loop, place the real BSOD wall 12 pixels beyond the existing sled's collision edge, raise the wall speed to 10,000 px/sec **in the isolated QA scene only**, and step the real Matter/game physics twice with the existing game headlessStep. That authoritative path computes wall/rider contact, emits actual BSOD state, fatal CRASH and RUN_END events, and causes the real AudioSynth subscriber to emit real crash SFX and schedule the exact native four-original-drum FatalCrashCountIn. The original song clock/token remain unchanged.

**No direct AudioSynth.playSfx, glitch, _onBsodState or _onFatalCrashMusic calls create these events.** The only forced state is BSOD wall geometry/speed in the disposable QA run. Therefore this is a real, game-physics-triggered crash, but NOT a natural player-input replay or long random gameplay sample.

## What is captured and what is never changed

- The test-only AudioWorklet connects to the actual **post-compressor OutputPeakGuard** of the running AudioContext, before the real speaker destination. It copies float32 stereo samples into short timestamped chunks, on a **parallel branch whose own output is always zero** (also followed by a zero-gain destination branch). It never inserts gain, limiting, denoising, new instruments or timing changes into the main game audio graph.
- The game uses the browser device native output rate (observed 44.1 kHz), while original OGG packs are 48 kHz. These real browser-resampled final output samples are checked with the existing 48-tap Hann-windowed-sinc, DC-normalized 4× intersample estimate; **this is still not a calibrated ITU-R BS.1770 true-peak meter**.
- At the start of each test a source-selected original song is loaded from the **private 33-song catalog**. Owner-approved original 5 instrumental stems, original vocals and independently source-derived melody voices are run through real game biome DSP, reverb and output guard, at test max master/music/SFX/wind settings.
- The original-vocal stress profile enables genuine original-song lyrics via the game's **real profile-unlock gate**, but only by patching the disposable browser registry profile in memory. It does NOT save or alter the owner's profile. A paired vocals-off control uses the normal locked default.
- Recorded original drum source provenance is bound to the real FatalCrashCountIn source segment, pulled from its current original pack manifest, SHA-256 hashed within Chromium and independently rehashed from the unchanged private OGG archive by a separate Node tool.
- Real final original drum hit windows are individually measured for nonzero stereo PCM energy. The run must show real BSOD proximity 1.0, fatal unnegated CRASH and RUN_END. Recorded original source ID, song transport token and music clock must match throughout.
- Original count-in *recording* is real OGG, but its four 0.5-second count-in positions are **synthetic-unverified**, not a verified song BPM/downbeat/grid. No original beat grid or gameplay authority is changed.

## The diagnostic tap itself has a measurable caveat

Real-time AudioWorklet activation sometimes produces a short **startup gap** in the test branch. Only an initial one/two-chunk startup discrepancy is discarded, and ONLY when it is at least 150ms before the actual collision. Every measured output must then be **continuous from at least 140ms before the actual collision through at least 150ms after original full-band recovery**. Any later missing, overlapping or out-of-order 128-frame PCM blocks cause the audit to FAIL CLOSED. The tap never silently interpolates, fills zeros or deduplicates the crash.

One vocals-off control attempt reported an overlapping -384 frames **during** the post-crash capture. It was rejected as an instrumentation-integrity failure (not proven output clipping), saved as an immutable failing report, and never entered a passing aggregate. The subsequent new control captured a contiguous crash and passed. This means the tap is useful but not perfectly reliable across all real-time Chromium runs. The all-33-song sweep retains a digest and failure reason for every rejected attempt, with at most three fresh attempts per source.

## First independently verified sample — seven different songs and a vocal control

Seven different original songs (including newly prepared source songs) were each run with original vocals **truly enabled**, all test output controls at maximum; an eighth real game capture retained original vocals disabled for contrast.

- **8/8 valid captures, 7 distinct original songs, 32 real original-drum-onset output windows.**
- The new live original OGG drum SHA-256 for all eight collisions matched exact canonical source files on disk. Seven distinct recorded drum files.
- All eight recordings include authentic fatal BSOD physics events, an unnegated real CRASH, a real RUN_END, continuous post-startup final PCM through all four hits and band recovery.
- **0 clipped PCM samples, 0 estimated 4× intersample overs, 0 nonfinite samples**, worst estimated final 4× peak **0.954185, −0.407 dBTP** (One More Run).
- Original source records and numeric metrics are in a private immutable evidence file. SHA-256: **641e1ca85eddcbd9ac211f90d9267c59d48c69f637293099c2ec429b8ddfedd0**.
- A disposable copy with a falsified original-drum OGG SHA-256 was correctly **REJECTED** by the independent canonical source verifier, and produced no passing report.
- The earlier discarded startup discontinuities (if any) and the single later failure remain separately recorded; they are not described as audio-master clipping.

Private aggregate file: /home/hermes/experiments/bitstream-melody33-private-20261123/issue291-live-real-physics-final-master-8cases-independent-v1-20261124.json. This file, original OGGs and captured PCM are **not committed to GitHub**.

## Follow-on all-33 live original source sweep

The complete first-original-segment live-game sweep **PASSED** with the exact real BSOD physics-collision and final-output methods described above.

| Check | Independently verified result |
|---|---:|
| Real-game physics BSOD fatal collisions, one opening source segment per song | **33/33 PASS** |
| Original vocals genuinely unlocked, no stored profile mutation | **33/33** |
| Actual original OGG drum hits scheduled and output-observed | **132** |
| Distinct original drum OGG files rehashed directly from canonical disk originals | **33/33** |
| Post-startup final-stereo PCM gaps accepted in validated crash windows | **0** |
| Nonfinite final samples / above-unity native PCM samples / estimated 4x overs | **0 / 0 / 0** |
| Worst final native 4x estimated intersample true peak | **0.957580 = -0.377 dBTP** |
| Original-song identity with highest estimated peak | **xiMVdlXC30c — 143 Nodes Said No: Infantino’s World Cup Private Equity Plan Glitches** |
| Diagnostic failures retained and excluded before successful retry | **3** |

All 33 valid captures have an authoritative BSOD collision, genuine fatal CRASH and RUN_END event, unchanged original track clock and token, all four recorded original-drum windows, and a continuous post-guard stereo PCM interval from before impact through final band recovery. The test discarded only narrowly bounded initial tap warmup *before* impact. No reported sample gap at impact or during the count-in was tolerated.

**Three original tracks needed a second capture** after the read-only worklet reported a missing/overlapping 128-frame quantum in the diagnostic branch. This is **measurement-system flakiness**, not proof that the game itself clipped or dropped audible output; the failing original reports and their SHA-256 hashes remain in the aggregate's rejectedAttempts section. The earlier vocals-off control also had one discarded overlapping-block capture. Keep the worklet reliability limitation visible in release QA.

The **independent private original-source verifier** read each selected authentic OGG drum again from disk, compared SHA-256 with the actual Chromium-fetched count-in source, rejected any incomplete PCM and ensured no 33-song index was missing or duplicated. It passed all 33. An eight-case source falsification negative control had already shown that a tampered drum hash correctly fails closed.

Canonical immutable private aggregate SHA-256: **57f787e48b582019bb7ca8b9772ad91e65ee8204d90d03f87811817b11d3d067**.

Local source-backed numeric audit file:

    /home/hermes/experiments/bitstream-melody33-private-20261123/issue291-live-full33-real-physics-final-master-independent-v1-20261124.json

**Scope:** one real original opening segment per track, naturally in Debutmont, under accelerated physics BSOD collision with original vocals unlocked in disposable test browser. This is NOT continuous 33-song/full-12-biome coverage or independently calibrated final mastering.

## How to reproduce (owner-only private archive)

From the QA branch, on the owner's trusted computer, start the private Vite QA server bound **only to loopback**, with read-only private media overlay. No OGG masters go to publicDir or the remote GitHub PR:

    BSB291_PRIVATE_AUDIO_ROOT=/private/owner-33-song-catalog BSB291_HOST=127.0.0.1 BSB291_PORT=8221 node tools/music/serve-private-mixed-qa.mjs

Run the real live crash PCM capture with a unique, immutable output path:

    GAME_URL=http://127.0.0.1:8221/ QA_SONG_INDEX=0 QA_ORIGINAL_VOCALS=1 REPORT_OUT=/private/reports/unique-original-song-live-collision.json node tools/music/audit-genuine-bsod-final-master.mjs

The report includes no PCM, no OGG, only event/numeric/source-identity evidence. Independent canonical OGG source verifier:

    BSB291_PRIVATE_AUDIO_ROOT=/private/owner-33-song-catalog REPORT_ROOT=/private/reports REPORT_OUT=/private/reports/unique-independent-summary.json node tools/music/verify-genuine-bsod-final-master.mjs

Set QA_FULL33=1 on the **independent verifier** to require all 33 original-song real-collision cases. Its expected filenames include the seven original-valid preliminary cases plus private reports for each other index named issue291-real-bsod-live-full33-index-NN-attempt-M-20261124.json. The runner retries failed captures up to three times using a **new path for every attempt**, never overwriting or silently dropping failed reports.

    BSB291_PRIVATE_AUDIO_ROOT=/private/owner-33-song-catalog REPORT_ROOT=/private/reports QA_FULL33=1 REPORT_OUT=/private/reports/unique-all33-live-summary.json node tools/music/verify-genuine-bsod-final-master.mjs

The read-only worklet module is tools/music/live-final-master-capture-processor.js. Raw original final PCM remains entirely in browser memory until the page closes; no audio download/export is created.

## Still open before closing #291 or shipping any music

This live test starts in actual Debutmont, not every one of the 12 music biomes; the accelerated wall can shorten the true wind warning to a small period, so it is **not** proof of sustained BSOD wind+glitch static+crash overlap. Separate *scripted* tests cover that stressful simultaneous mix. Full uninterrupted 33-song playback and seam/crossfade verification, many real player-input and biome/hazard trajectories, objectively calibrated mastering true peak/loudness, low-end ChromeOS and Android CPU/latency, user listening and source rights remain unresolved.

**Keep #291 OPEN and draft PR #310 unmerged. The measured ~0.4 dBTP headroom is narrow, and no silent owner mix changes are justified.**
