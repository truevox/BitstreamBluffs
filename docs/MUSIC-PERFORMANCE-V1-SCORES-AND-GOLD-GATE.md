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

## Real in-game score inspector — candidate correction draft (2026-11-17 follow-up)

A level deeper in Settings → Manage Sound → Music Lab → NOTES (N), the shipping-game editor presents a four-second moving piano-roll timeline for the six original score families. Drum hits appear in separate kick/snare/hat/tom/cymbal lanes; pitched instruments plot MIDI note pitch and start/release times. The green cursor reads the ACTUAL StemMusicDirector WebAudio clock. The selected event displays its source stable ID, note pitch and clock timestamp. Mouse/touch selects individual candidate rectangles; arrows/gamepad Left/Right choose previous/next source event, Up/Down change source instrument; Enter/gamepad A and HEAR STEM isolate the selected instrument role using the SAME game-engine mixer and seek just before its candidate attack. The audio follows the current Dynamic Orchestra source/replacement setting: it plays a stem ROLE passage, NOT an isolated or synthesized individual note. FOLLOW/FREEZE manages timeline movement.

Human candidate edits never change running sounds: ±10 ms onset and corresponding release, ±12 semitones, Accept/Reject, and per-event Undo live only in a session-scoped ScoreCorrectionDraft. A combined onset plus octave change stays ONE atomic correct operation per immutable event ID, never two conflicting edits. The draft rejects time/pitch boundary violations and changes that would reorder adjacent source attacks. The original performance.json and all current audio remain untouched. EXPORT PATCH downloads bitstream-performance-patches-v1 with base score SHA-256, song ID, 48kHz frame-based operations and status draft-unreviewed-not-applied-to-audio; it is not a human-verified gold annotation. Drafts survive closing/reopening Notes within Music Lab, but are separate for different songs and discarded upon leaving the lab unless explicitly exported.

tools/music/performance_v1.py can materialize a compliant correct operation into a separate corrected-score artifact via apply_patch_layer; invalid or stale IDs/hash/reordered events fail closed with explicit conflicts. The browser E2E actually clicked a bass note, nudged +10 ms, raised octave +12, rejected and undid a different note, exported a patch, and validated that exact downloaded JSON using the Python materializer without altering the source. Still NO corrected performance audio rendered or human-approved.

## Experimental V2 overlay, no production audio changes

The game now accepts an optional experimentalPerformance sidecar path and score hash, strictly linked to the original performance-v1 score. V2 cannot become the canonical score or an audio stem. From Music Lab → NOTES (N) → V2, a read-only magenta overlay shows candidate event guesses behind the cyan original release events. Only the cyan base candidates are selectable/editable into draft patches. The V2 file has quality experimental-candidate-unreviewed and the same original six audio stem hashes and unchanged melody; failure to load, wrong parent hashes and stale responses do not stop playback. No real-song gold labels have been produced. Full detector limitations, full-song audit comparisons and release blockers appear in MUSIC-DETECTOR-V2-UNREVIEWED-RESEARCH-20261117.md.

## Quantitative gold evaluation: ready to run, without fake results

tools/music/evaluate_performance_v1.py accepts a separate bitstream-performance-gold-v1 with status human-verified, the correct source score hash, manually labelled excerpts, role, pitch/class, and exact note onset frame. We have **not** created any human-verified gold set and no actual-song F1 score exists.

It computes one-to-one maximum-cardinality note matching at **20ms and 50ms**, with minimum absolute error for ties. It distinguishes separate simultaneous drum classes and same-pitch attacks. Reports precision/recall/F1, false and missed onsets per minute, signed onset timing bias, standard-deviation jitter and drift slope. Ordinary export marks are REFUSED as gold truth. Test fixtures measure algorithm correctness only.

Still needed: human reviewed musical passages, confidence calibration, release/research model fusion, code+input+renderer artifact cache, source-aware attack/release correction, piano-roll and spectrogram overlay, human event correction UI and per-bar confidence-gated replacement. No claim that Fable's substantive onset/FFT/bass/drum problems are solved.

## Validation and release protection

- Python unit tests: tools/music/test_performance_v1.py and test_evaluate_performance_v1.py.
- Browser unit tests: tests/src/performance-score.test.js and tests/src/music-pack.test.js.
- Original-audio gate: tools/music/validate_performance_release.py verifies all **4,745 original Ogg files unchanged by SHA-256**, all four pack manifests otherwise identical to prior release, and all exact source event counts and score hashes. Catalog identity is also strict except for **new, valid 11-character `youtubeId` artwork references** (issue #54): these do not change source audio or manifest paths, and already-published IDs cannot silently change or disappear. Fixture regression: `python3 -B tools/music/test_validate_performance_catalog_compat.py`.
- Real Chromium game lab: tools/music/smoke-performance-score-game.mjs loads all four real scores, isolates streams, seeks, marks passages, downloads four score-pinned JSON markers and checks saved game/settings unaffected.
- Adversarial Chromium: tools/music/smoke-performance-score-races.mjs delays score A until B is loaded, rejects incorrect score hashes and confirms normal source audio plays uninterrupted.
- All **120/120 current-game source test suites, 2,134/2,134 tests pass**. Historical broad legacy suite includes seven previously reproduced failures unrelated to sound.
- The private scored-game QA is at http://100.115.120.66:8199/. The stable player at :8188 and GitHub main are only updated after independent release checks.

**Owner attribution:** the standalone lab sound-design-only boundary, the game's real audio engine as validator and source-stem DO semantics came directly from Marvin. Technical representation, hash choices, capture implementation, patch commands and provisional diagnostics are Gal Friday engineering decisions, not statements or approvals by Marvin.
