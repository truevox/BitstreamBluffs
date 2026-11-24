# #291 — Qualified quantum-v3 real-game final PCM capture

**2026-11-24. QA-only instrumentation and private original source evidence. No approved game audio, physics, original masters or public deployment changed.**

## What was wrong with v2 recording

Previous read-only AudioWorklet final-master captures timestamped audio in 1024-frame packets. An independent reviewer correctly required per-128-frame render-quantum continuity. That stricter v2 tap found dropped/repeated render quanta and therefore could NOT certify older packet-level successful recordings.

A minimal independent test on the same Chromium headless host ran a continuous 220-Hz oscillator into the worklet, with no Bitstream Bluffs game. It observed ONE initial **896-frame** diagnostic render gap immediately after the worklet started, then **1,899 contiguous render quanta** (over 5 seconds) without another skip. Startup AudioWorklet activation, not necessarily faulty game audio, can cause the test branch to begin with discontinuities.

A zero-value keepalive and a separate nonzero diagnostic clock-driver input both failed to solve startup activation skips. Neither workaround is shipped. Gaps occurring while the recording is ARMED remain absolute failures.

## v3 protocol: start only after continuous source-clock proof

The live audit opts into quantum-v3 by passing a 450-ms stable warmup requirement to the QA-only worklet. The processor:

1. Watches EVERY Web Audio render quantum from startup. Any discontinuity before arming **resets the continuous warmup**; no pre-arm samples are ever recorded.
2. After at least 450 ms of consecutive, valid render quanta, emits the EXACT audio sample-clock arm frame. PCM capture begins at the **immediately following sample**. The worklet attests quantumValidationVersion=3 and sample-clock armFrame at stop.
3. Once armed, a missing/repeated/canceling render quantum, missing source input or nonfinite timestamp is a strict INVALID_INSTRUMENT_CAPTURE. It never fills zeros, interpolates dropped frames, discards post-arm samples or relabels an actual measured clipping event as an instrument failure.
4. The test waits until the **audio clock itself** is at least 300 ms beyond the arm frame, with eight+ PCM chunks already received, BEFORE advancing the REAL game physics to its BSOD collision. Main-thread wall-clock delay alone was insufficient because audio and page timestamps can be out of phase.
5. Verifiers require captureContinuityVersion=3, qualified armFrame equal to firstFrame, zero post-arm dropped chunks, absolutely contiguous final stereo PCM from before impact until after band recovery, original recorded-drums SHA-256 from canonical private OGG, all authentic fatal game events and zero clips/estimated overs.

An explicit arm-stage timeout is an INSTRUMENT_CAPTURE failure **only when** the original song engine is still running, its source loader has no error, browser page exceptions are absent and there are no unexpected HTTP errors. Every genuine source/game error is non-retryable. All measured above-unity PCM / estimated 4x intersample clips remain PERMANENT non-retryable failures regardless of the capture protocol version.

## Evidence boundary

The first v3 exploratory pass produced 33 valid fresh original-song real-game PCM measurements, but three older arm timeouts in that pass had been generically labeled INVALID_QA_OR_SOURCE before the exact arm diagnostic was added. Those original failed JSON artifacts remain unchanged and **are not silently reclassified or reused** as green evidence. A separate **fresh v3b 33-song matrix**, with precise failure reasons and bounded retries, is the independently auditable result.

For all counted songs, every recorded original drum source is verified authentic and scheduled; nonsilent full-master time windows do not independently prove the original drum is audible over effects. The four drum accent CLOCK positions remain synthetic-unverified. No score/musical beat grid is certified.

This is real game physics BSOD collision, but QA accelerates/repositions the authoritative wall before stepping the real physics. It is NOT natural player input, all-biome coverage, uninterrupted multi-minute song playback, device-validated ChromeOS/Android performance, approved subjective mastering or a calibrated BS.1770 true-peak result.

## Fresh v3b independently verified result — 33/33 PASS

The fresh v3b run (after repairing the old pre-arm timeout classification, with independent original-source readback) has NOW COMPLETED and passed:

| Final check | Source-verified result |
|---|---|
| Real game BSOD physics collisions, one original opening segment each | **33/33 PASS** |
| True original vocals unlocked in disposable browser | **33/33** |
| Original OGG drum files independently rehashed from canonical private disk | **33/33** |
| Native original-recording drum attacks scheduled, not independently audibility-isolated | **132** |
| Missing/repeated PCM AFTER qualified sample-clock arm | **0 accepted** |
| Nonfinite PCM, sample-domain clips, estimated 4x intersample overs | **0 / 0 / 0** |
| Worst estimated 4x output true peak | **0.954517 = -0.404323 dBTP** |
| Worst original song ID | **layy9YVq0Vs** |
| Invalid diagnostic captures kept as separate immutable evidence | **5** |

All five invalid recordings are explicitly instrument-classified: indexes 4 (one), 5 (two), 9 (one) and 21 (one), each followed by valid fresh source-backed output. Every attempt is examined by the independent verifier. **No measured clipping, source error or ambiguous failure was retried away.** The three ambiguous historic v3 arm timeout reports remain outside this new independently passing v3b batch, unchanged, and are not reclassified retroactively.

**Canonical immutable private v3b full-33 independent aggregate SHA-256:**

    0393e7b1c67ce8085eec3ab88c31d8492e6f2f0c6fa0e9436f89ebf996709c7d

Private file remains outside the public repository:

    /home/hermes/experiments/bitstream-melody33-private-20261123/issue291-quantum-v3b-full33-independent-source-and-truepeak-v1-20261124.json

Three separate DISPOSABLE in-memory copy negative controls confirmed fail closed with nonzero exit and no passing artifact:

- A tampered authentic original recorded-drum SHA-256 rejected by independent canonical disk readback.
- One valid-PCM report with deliberately inserted sample clipping rejected even if a subsequent attempt passed.
- A passing report with its qualified arm version downgraded to 2 rejected as unqualified evidence.

No original files or immutable source evidence were changed by these negative controls. On the new code **205/205 focused Jest tests across 19 suites PASS**, Vite production build PASS and unchanged SIM8 source/build identity PASS.

**IMPORTANT:** This clears the narrowly scoped *fresh source-verified quantum-v3 live original opening segment BSOD output* engineering QA gate. It does NOT clear calibrated mastering loudness and certified true peak, organically player-controlled real-world game/audio coverage, continuous entire songs and all 12 biome routes, low-end ChromeOS/Android performance or rights/owner listening approval. The roughly 0.4 dB estimated headroom is narrow; no automatic approved-mix change is authorized.

## Owner-only commands

Use a numeric loopback private-media overlay, never expose OGG masters unauthenticated to a network:

    BSB291_PRIVATE_AUDIO_ROOT=/private/original33 BSB291_HOST=127.0.0.1 BSB291_PORT=8221 node tools/music/serve-private-mixed-qa.mjs

One real original-song crash capture to a NEW immutable report path:

    GAME_URL=http://127.0.0.1:8221 QA_SONG_INDEX=1 QA_ORIGINAL_VOCALS=1 REPORT_OUT=/private/reports/unique-v3.json node tools/music/audit-genuine-bsod-final-master.mjs

The final fresh all-33 v3b audit is selected by QA_FULL33=1 QA_REVIEW_STRICT=1. The independent verifier refuses any missing original song, ambiguous failed capture, source SHA mismatch, missing qualified arm proof, discontinuous post-arm PCM or valid clipping. Explicit instrument-invalid runs may be retried only within the bounded attempt matrix.

Original OGG audio, raw PCM and source evidence JSON remain only on the owner's machine. Keep #291 OPEN, PR #310 DRAFT, and [skip netlify].
