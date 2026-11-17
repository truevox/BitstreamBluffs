# Bitstream Bluffs — Performance V1 source-score capture and actual-game validation

**Status:** Implemented and tested November 17, 2026. **All note transcriptions are still PRE-ALPHA and unreviewed.** No pitch accuracy claims. No musical media changed.

## Why this exists

Fable Friday demonstrated that the released orchestra uses relatively crude direct onset/FFT/YIN event estimation and did not retain a reusable versioned score. The research lab and released renderer could therefore disagree. Simply improving a standalone decoder would not improve the game. This work first freezes and fingerprints the EXACT hypotheses that made the shipped music, preserving them for future source-grounded corrections and evaluations. It does not silently substitute experimental notes.

## Canonical frozen score

tools/music/performance_v1.py defines bitstream-performance-v1, the same representation used by the offline release renderers and the in-game lab. Each song's immutable score is in public/music/packs/<song>/performance.json, and its real pack.json points to performance.path + performance.scoreHash. This is a **diagnostic sidecar**, not an audio replacement.

The six roles are melody, bass, drums, guitar, piano, other. Each candidate attack has a stable ID (anchored to the source event), exact 48kHz startFrame, endFrame/MIDI pitch or drum-family class, original render ordinal and UNCALIBRATED confidence: null. Repeated same-pitch attacks and simultaneous kick/snare events remain distinct. Reported detector "confidence" of 0.72 is recorded only as reportedHeuristicConfidence, not passed off as a probability.

The song score hash binds all notes plus source-stem SHA-256 fingerprints of all six separated FLAC stems, preexisting YIN melody audit SHA-256, and release detector source-code SHA-256. No original absolute file locations are exposed in the public score.

The optional human correction layer is separate and keyed by original score hash plus individual event IDs. Reject/accept, retime, and octave changes generate a NEW artifact. Changes to an original detector score or missing IDs produce explicit conflicts; nothing is silently edited or reapplied to different notes.

## One score for actual future renderers

Both tools/music/render_full_dynamic_orchestra_v1.py and tools/music/render_additional_instruments_v1.py now accept --performance-root. They check source song identity, featured instrument, integer sample frame count, all six original FLAC SHA-256 fingerprints and (for full rendering) the melodic score audit. Then they feed the captured events to the EXISTING instrument renderer. The old detector-in-render step needs the explicit flag --legacy-direct-extraction for historical reproduction and is no longer the default new-release path.

An actual-source test on CT211 confirmed Pope's complete six-role detector results round-trip exactly from the frozen performance score. A separate non-silent four-second waveform test checked the old/new event conversion paths for piano, guitar, other, bass and drums.

**Full source score capture:** /root/bitstream-maxi/performance-capture-20261117/four-song-release-v1 on CT211.

| Song | Melody | Guitar | Piano | Other | Bass | Drums | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pope | 716 | 1216 | 1256 | 2228 | 209 | 1743 | 7368 |
| One More Run | 464 | 2028 | 2896 | 3548 | 301 | 1860 | 11097 |
| Runs Out of Code | 576 | 2214 | 1716 | 1952 | 202 | 1787 | 8447 |
| Varmont | 595 | 834 | 1664 | 2004 | 143 | 1600 | 6840 |
| **All four** | | | | | | | **33,752** |

Every per-role event count independently agrees with the corresponding earlier full instrument and additional instrument release audits.

## New genuine in-game Music Lab capabilities

Settings → Manage Sound → Music Lab now loads the versioned score only **after the actual game music engine** loads the corresponding pack. The two files must agree on the song, duration, featured part, format and 64-digit score hash. The lab shows candidate note/hit attacks within ±100ms of the actual playing WebAudio sample-frame clock and selected instrument, including drum family or MIDI pitch.

**MARK (M)** (mouse/touch or M key) records a suspected perceptual mistake at the EXACT game-clock sample frame and the currently isolated instrument, including its source-score hash, nearby candidate event IDs, biome, ground/air mode, sled speed and replacement setting. **EXPORT MARKS** downloads a bitstream-music-issue-markers-v1 JSON; **CLEAR MARKS** deletes the session-only list. The labels explicitly say these are listener suspicions, not verified gold notes. No songs, user settings, achievement state, bank balance or raw notes are edited.

An invalid/corrupted sidecar is rejected without disrupting normal audio. If score A arrives after a user switches to score B, A is discarded. The user's canonical standalone lab remains **SOUND DESIGN ONLY**, not transcription or sync proof, as Marvin expressly directed.

## Quantitative gold evaluation: ready to run, without fake results

tools/music/evaluate_performance_v1.py accepts a separate bitstream-performance-gold-v1 with status human-verified, the correct source score hash, manually labelled excerpts, role, pitch/class, and exact note onset frame. We have **not** created any human-verified gold set and no actual-song F1 score exists.

It computes one-to-one maximum-cardinality note matching at **20ms and 50ms**, with minimum absolute error for ties. It distinguishes separate simultaneous drum classes and same-pitch attacks. Reports precision/recall/F1, false and missed onsets per minute, signed onset timing bias, standard-deviation jitter and drift slope. Ordinary export marks are REFUSED as gold truth. Test fixtures measure algorithm correctness only.

Still needed: human reviewed musical passages, confidence calibration, release/research model fusion, code+input+renderer artifact cache, source-aware attack/release correction, piano-roll and spectrogram overlay, human event correction UI and per-bar confidence-gated replacement. No claim that Fable's substantive onset/FFT/bass/drum problems are solved.

## Validation and release protection

- Python unit tests: tools/music/test_performance_v1.py and test_evaluate_performance_v1.py.
- Browser unit tests: tests/src/performance-score.test.js and tests/src/music-pack.test.js.
- Original-audio gate: tools/music/validate_performance_release.py verifies all **4,745 original Ogg files unchanged by SHA-256**, all four pack manifests otherwise identical to prior release, and all exact source event counts and score hashes.
- Real Chromium game lab: tools/music/smoke-performance-score-game.mjs loads all four real scores, isolates streams, seeks, marks passages, downloads four score-pinned JSON markers and checks saved game/settings unaffected.
- Adversarial Chromium: tools/music/smoke-performance-score-races.mjs delays score A until B is loaded, rejects incorrect score hashes and confirms normal source audio plays uninterrupted.
- All **120/120 current-game source test suites, 2,134/2,134 tests pass**. Historical broad legacy suite includes seven previously reproduced failures unrelated to sound.
- The private scored-game QA is at http://100.115.120.66:8199/. The stable player at :8188 and GitHub main are only updated after independent release checks.

**Owner attribution:** the standalone lab sound-design-only boundary, the game's real audio engine as validator and source-stem DO semantics came directly from Marvin. Technical representation, hash choices, capture implementation, patch commands and provisional diagnostics are Gal Friday engineering decisions, not statements or approvals by Marvin.
