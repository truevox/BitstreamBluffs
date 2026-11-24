**CURRENT 2026-11-24 QUANTUM-V3 FOLLOW-UP (SUPERSEDES THE OLD LIVE CAPTURE BLOCKER BELOW):** A NEW separate v3b 33-song live-physics final-output capture matrix passed independent original-source SHA-256 and strictly armed, per-render-quantum PCM validation, with 0 clips/estimated overs and worst estimated -0.404 dBTP. Five instrument-invalid attempts were preserved and inspected. Older v2 and prior unclassified v3 reports remain historical/untrusted, not counted. Details and private audit digest: docs/music-review/20261124-issue291-quantum-v3-armed-live-final-master.md. This is still NOT calibrated mastering, full-song playback, release approval or source publication.

# PR #310 — Independent review corrections, November 24, 2026

This is a code-only QA infrastructure update stacked on draft PR #306. It changes no private original OGG/FLAC files, approved mix, production physics, replay rules or actual user profile. Netlify must remain skipped.

The independent review of original QA commit edd2f5e6 found seven corrective actions. Both P1 measurement blockers were real; the previous all-33 live-output reports are **historical, not certified under the newly strict capture standard**.

## Changes made

1. **P1 — check EVERY audio render quantum.** The live output AudioWorklet now records its expected next currentFrame after every 128-frame quantum. A missing, repeated, overlapping or canceling-pair discontinuity immediately sends a chronology-error and aborts capture. A 1024-frame chunk-end alone cannot falsely conceal it. Six unit tests cover contiguous data, dropped quantum, repeated quantum, a compensating pair, missing input and final partial flush.

2. **P1 — do not retry away a genuine measured audio-limit failure.** A complete sample-domain clip, nonfinite PCM, or above-unity estimated 4x true-peak reading is classified as VALID_CAPTURE_AUDIO_LIMIT_FAILURE and produces a nonzero exit code. The independent verifier reads every attempt, including those after any passing capture. Any actual measured clipping **fails the entire audit, permanently**. Only an explicit INVALID_INSTRUMENT_CAPTURE with no valid measured PCM is retryable. Old FAIL_OR_INCOMPLETE or missing quantum-validation metadata are rejected as ambiguous. Fourteen classification tests cover this rule, including a valid clip followed by a later pass.

3. **P2 — suspended-render error handling.** Offline Web Audio event callbacks always resume their OfflineAudioContext in a finally block, and the runner settles events independently of the rendering promise before propagating errors. A Chromium negative test with a deliberately simulated missing original drum attack returned a source-specific error in about 1.9 seconds, not a hanging renderer. No original OGG was altered.

4. **P2 — process exit agrees with recorded audit status.** The mixed-output script returns a nonzero exit code for ANY non-PASS result, including measured over-unity sample/4x peaks despite otherwise complete metrics. Report files remain immutable. Exit-status unit tests pass.

5. **P2 — pack-defined original vocals and voice room processing.** The offline source mixer now uses the real pack-defined original-vocals effects and both original-vocals and selected melody room sends, consistent with the live StemMusicDirector source mix. Six fresh Chromium offline stress cases ran successfully with no clipping or estimated 4x overs. These are still SCRIPTED offline stress inputs, not physics replay. Previous measurements from simplified vocal FX are no longer the canonical mix.

6. **P2 — actual recorded drum vs audibility.** Source-authenticated original drums and four scheduled original-drum attacks are verified, and the entire final master is non-silent in their time windows. The latter does NOT prove that a specific drum is independently audible through music, crash, static and wind. Current reports explicitly label countInMasterWindows, originalDrumSourceScheduled=true and isolatedOriginalDrumAudibilityVerified=false. Prior claims that 132 distinct drums were audibly isolated are withdrawn; they were 132 recorded drum attack events scheduled from original verified sources.

7. **P2 SECURITY — no unauthenticated private OGG network service.** The QA Vite source overlay now binds only numeric loopback 127.0.0.1 or ::1 and rejects all other hosts. Ten tests include 0.0.0.0, ::, ambiguous localhost, tailnet and LAN addresses. A real launch attempt on 0.0.0.0 failed closed.

## Critical re-review boundary

**The previous 33 live-game BSOD peak reports were sampled BEFORE these per-quantum integrity checks.** They remain genuine historical captures but cannot be upgraded retroactively to quantum-verified mastering evidence. Three fresh re-review captures were rejected as INVALID_INSTRUMENT_CAPTURE due skipped quanta. This is measurement reliability uncertainty, not demonstrated game-audio clipping. We will not weaken the new detector to recreate a clean aggregate.

The old approximately -0.38 dBTP estimate is therefore a previous numerical observation, NOT current independently valid release mastering clearance. Separately, the latest source-faithful offline 6-case stress sweep succeeded; that does not replace a validated live PCM sweep.

The corrected 33-song live re-audit remains **OPEN** until reliable per-quantum chronology is obtained. Independent calibrated true-peak/loudness, uninterrupted full songs and transition audio, low-end device performance, musical note/beat validation, distribution rights and owner listening approval also remain outstanding.

The independent reviewer also found 14 existing vinyl-pause-transport failures on base PR #306. Those reproduce before this PR and are **inherited baseline failures**, not introduced by these QA corrections. Do not silently weaken their tests or claim the entire broad suite is green.

**Keep PR #310 draft and #291 open. No publication, Netlify build or auto-merge authorized by these corrections.**

## Additional independent source/provenance review — fail-closed integration

Further review revealed three evidence gaps beyond the original seven findings. First, the 48+4 mixed-output verifier now validates every sample/estimated-4x-true-peak count and finite peak before reductions, including optional overlap cases, so a missing counter cannot turn an aggregate into `NaN` and be misreported as PASS. Second, the eight-case live-output verifier accepts `QA_EIGHT_REPORT_FILES`: exactly eight unique immutable `.json` basenames, comma-separated in canonical order (seven selected vocal-on cases followed by the song-zero vocal-off control). The existing historical reports remain untouched; each supplied report must still pass the current strict quantum-v2 capture policy. Full-33 mode continues to select numbered contemporary attempts for every index.

Third, the disposable live Chromium page now installs a **pre-game read-only original-OGG fetch-provenance tap**, cloning the exact successful source HTTP response bytes before production `decodeAudioData` consumes them. A selected count-in is accepted only when all four production source nodes reference the exact game's cached drum `AudioBuffer`, and the source SHA-256 comes from the previously captured production fetch response, not a second download after the crash. The independent verifier re-hashes canonical private disk bytes, verifies the `game-original-response-clone-v2` protocol, and fails on missing/inconsistent source evidence. No original bytes or raw PCM are committed or published. All earlier reports lacking the new provenance proof are retained as historical evidence, not retroactively promoted to current certified evidence.

The three fresh quantum-chronology failures documented above are still unresolved instrument reliability; none proves clipping. No full-33 current-method recapture has been certified by these code-only changes.

## Exact-head review of game-decoder source provenance candidate

A further independent review identified three remaining fail-open policy cases. The live capture policy now allows `INVALID_INSTRUMENT_CAPTURE` retries only when the diagnostic is recognized and there are zero browser page errors and zero unexpected HTTP errors; an otherwise valid instrument gap concurrent with a real game/OGG source error **must not** be discarded. The mixed-original runner and its independent verifier both reject sample or estimated 4× peaks at **exactly unity**, even when over-unity clip counters remain zero. The original 48+4 offline mixed-output verifier and BOTH original-drum fatal comparison verifiers now require `originalVocalFxAndRoomSendsFromPack:true`, rejecting pre-correction legacy renders with simplified vocals. Historical private aggregate hashes and original media remain immutable. These changes are QA assertions only; no owner sound character, physics, original recordings or user settings were changed.
