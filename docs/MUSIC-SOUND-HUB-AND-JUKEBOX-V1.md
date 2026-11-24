# Bitstream Bluffs — Sound management, in-game music lab, and jukebox (pre-alpha)

**Owner:** Marvin Bentley. **Review:** Fable Friday; Hermes Astra Friday on CT223. **Date:** 2026-11-17.

## What is ready

1. Main Settings now has four separately persisted sliders: Master, Music, SFX, and sled wind (the continuous “shhhhh” heard while sledding). Wind is environmental sound and cannot be silenced by disabling every song; master and wind slider still control its level.
2. `MANAGE SOUND` is one nested screen with four per-song enabled switches; Dynamic Orchestra ON/OFF marked magenta PRE-ALPHA and default OFF; original vocals gated by a **temporary 200-shard entitlement** (level gate is the future design); independent vocal level and synthesized melody-with-vocals volume sliders unlocked when vocals are enabled.
3. The purchase is idempotent, uses ProfileStore's actual persistent bank, and atomically debits 200 shards and grants an entitlement. Reload restores the entitlement. Storage failure cannot debit the in-memory bank. When the final level gate arrives, preserve previously purchased entitlements.
4. `MUSIC LAB` is inside the real game and uses another instance of the shipping `StemMusicDirector` with the **same actual 48kHz decoded Opus packs, song manifest schema, audio context, clock, FX mixer and adaptive instrument router**. Entering the sandbox mutes only the live player's output bus and never writes achievements, game score, shards, unlocks or saved Settings. Exit cleans up lab buffers/timers/voices and restores the other bus.
5. In-game lab V1: song switching, all eleven real biomes plus home, source-versus-reperformed A/B with source DSP maintained OFF, guitar/piano/other/bass/drum/melody isolation, airborne simulation, stopped/slow/fast/extreme speed, seek ±10 seconds, restart, stop/play, and **actual WebAudio decoder frame count compared to pack's integer `frames`**.
6. Title, Pause and Game Over have an unobtrusive shared jukebox strip with Play/Pause, Previous, Next and a LIST drawer that shows the actual last-played track and upcoming songs. All views use the one `AudioSynth` + `StemMusicDirector`; there is no second menu playback engine. Pausing stops one-shot nodes and saves the clock offset; resuming loads/schedules the same song from that position. Skips preserve intentional pause state and reject disabled tracks. Browser AudioContext suspension is tracked separately from deliberate user pause. A user gesture unlocks audio. Current and upcoming are derived from the selected real playlist, not a fabricated schedule.
7. Disabling all four songs means no music, including no synthesized fallback, but sound effects remain. Dynamic Orchestra OFF disables **only replacement recordings**, not processing of original stems (FX, reverb, filtering, speed-dependent bass and airborne drums, etc.).

## Two-lab rule: explicit Marvin owner decision

- **Standalone 8186**: sound design only—timbre selection (holopad vs glockenspiel), musical aesthetics, band EQ, filters, dynamic bass effects, instrument articulation *sound*. It is **NOT** evidence of transcription timing correctness or game release integration.
- **Built-in Music Lab**: canonical end-to-end playback validation for replacement rhythm, decoded frame counts, synchronization, isolated stems, actual game routing and future annotation. The score-analysis research must feed the same offline renderer that creates production game packs; a separate experimental player is no longer a trustworthy release gate.

## Fable/Astra's repaired P0 release defect

The separately committed, full-length audio encoding fix `e8cda18a1608e8b39e026966729b8e007a0a01ec` is already on main. It independently re-encodes 4,290 replacement chunks and checks exact decoded frames for all 4,745 Opus clips (455 original chunks unchanged SHA-256). A separate real Chromium test decoded 84 beginning/middle/end files without error and exercised actual gameplay audio with 5 active replacement roles.

## What is **not** solved yet

The in-game lab is not yet a piano-roll editor, beat/onset annotator, spectrogram, full blind A/B system or automated real-song gold-set evaluation. **Transcription fidelity has not been established.** Fable's core criticisms remain valid: production's crude FFT peak picking, spurious/bias onset detections, merged bass and melody reattacks, and one-class-only percussion differ from more promising laboratory detectors. Current replacements remain PRE-ALPHA and are OFF by default.

Next technical priorities: versioned canonical `performance.json` with integer-frame times and event provenance, merge the research/production scoring and rendering code paths, six carefully annotated real-song gold excerpts plus a held-out set, measured detector biases and one-to-one note matching at 20ms/50ms; then confidence-based original/alternative source selection per musical phrase. Do **not** silently promote synthetic benchmark results as correctness of real-song music.

## Validation

Run from the source checkout:

- `npm test -- --runInBand` (broad legacy suite, historic unrelated tests may fail; record failures rather than declaring universally green)
- `npm run build`
- `node tools/music/smoke-in-game-sound-lab.mjs` with `GAME_URL` set to a private QA server using the actual current packs
- `node tools/music/smoke-sound-manager-purchase.mjs` (uses a fresh Chromium browser profile only)
- `node tools/music/smoke-game-jukebox.mjs` (tests title, pause, end transport, actual WebAudio playback, all-off state)

See also `docs/AUDIO-LABS-RESPONSIBILITIES.md` and `docs/OPUS-FRAME-EXACT-REPAIR.md`.

## Final candidate validation — November 17, 2026

- **119/119 current-game source suites PASS, 2,128/2,128 tests**, including game HUD, navigation, profile credits, progression, gameplay physics and audio. The broader legacy repository suite has seven unrelated historic failures, independently reproduced on the unchanged prior main commit. Two new profile-shape regressions caught during early testing were repaired before release.
- Production Vite build PASS.
- Actual Chromium/WebAudio tests PASS: nested Settings and Sound Manager, 200-shard original vocals purchase and two independent sliders persisted through reload, game-engine Music Lab at 22s seek, real Title/Pause/Game-Over shared transport with queue/history, all-four-songs OFF still leaving SFX and independent wind hiss active, true pointer clicks in Game Over never triggering accidental retry.
- **Async adversarial test PASS:** delay A's pack manifest, skip to B, then release A. B stays current and active; A cannot overwrite the chosen generation.
- **Opus-boundary pause PASS:** seek to 11.96s, pause immediately after crossing the 12-second seam, and resume within the same passage without losing the song's offset.
- **Fresh browser autoplay PASS:** a physical pointer gesture started the real WebAudio stem engine in a cold Chromium context.
- Astra received a second read-only UI review request; the agent's session was interrupted before it obtained repository code, so it **did not give code-level sign-off**. Its proposed risk tests above were run independently and passed. An earlier Astra architecture review recommended separately releasing the Opus correction first, and that was done.
- The game lab is an **end-to-end player/synchronization/decoder validator in V1**, not yet an automatic ground-truth transcription evaluator. A score overlay, onset annotator and one-source-of-truth performance JSON remain future work.
