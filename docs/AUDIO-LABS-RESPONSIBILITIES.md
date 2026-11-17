# Audio labs: sound design versus real pipeline validation

**Owner decision — 2026-11-17.** Marvin expressly limited the existing standalone lab to **sound-design experiments only**: instrument/timbre auditions (Crystal Cavern holopad vs glockenspiel), speed-dependent bass boost/duck, effects, ambient character and musical mixing. **The standalone lab must NOT validate transcription, note timing, attacks, releases, source-to-replacement synchronization or shipped segment decoding.**

## Authoritative division of responsibility

**Existing standalone lab, private port 8186:** creative SOUND DESIGN sandbox; choose and compare timbres, DSP, reverb, dynamic mix policies, expressive instrument aesthetics. The waveform may be intentionally simplified. No claims of transcription fidelity may be based on standalone results.

**In-game lab (Manage sound → Music lab):** authoritative actual-game audio pipeline validator using the same live StemMusicDirector, MusicPack manifest schema, StemFXMixer, AdaptiveBiomeRouter, actual Opus chunks, decoder and WebAudio sample clock as gameplay. For inspecting decoded sample counts, note-on timing, repeated attacks, sync, source-versus-replaced A/B, per-stem isolation and gameplay state. A research result is not approved until it passes this real engine and a real-song benchmark.

The offline research and full-song render must share one versioned performance/event representation and one rendering toolchain. Build source-grounded, immutable integer-sample note timelines with provenance, then run exactly the same renderer on selected bars or whole songs; do not silently promote detector heuristics.

## New real-engine score diagnostics (2026-11-17)

The game now consumes a versioned and hash-pinned, six-role performance-v1 event score captured from the ACTUAL release for all four songs. Exactly 33,752 unverified source note/hit hypotheses were captured; source FLAC hashes and extractor fingerprint are preserved. The lab displays sample-clock-relative candidates and supports M / Mark Error, Export Marks (JSON), and Clear Marks. Exported annotations are UNVERIFIED listener suspicions; they do not edit source scores or game state. An offline human-correction patch layer and strict 20/50ms one-to-one gold evaluator exist, but there are NO verified gold musical annotations or accuracy results yet.

The full and additional instrument renderers can now consume this one frozen score via --performance-root; legacy direct extraction must be explicitly opted into. Tests confirmed all original Opus assets byte-for-byte unchanged, four real game scores loaded and marked in Chromium, async score race isolation and corrupted-score fail-closed behavior. See docs/MUSIC-PERFORMANCE-V1-SCORES-AND-GOLD-GATE.md.

Note inspection is now inside the game, not the standalone sound-design lab. The inspector draws unverified release event candidates and offers reject/accept, ±10ms and ±12-semitone draft edits keyed to source event IDs; a downloadable versioned patch file may be applied offline to a new score (never directly to live music or a save). The patch status is always draft-unreviewed, not verified ground truth. Actual game source playback continues unchanged.

## V2 model disagreement (November 17, 2026)

Actual-game Music Lab → NOTES (N) → V2 toggles a **visual-only, read-only experimental score overlay** (pink) against the released note guesses (cyan). It does **not** synthesize V2 notes or replace released songs, is not a gold reference, and cannot modify the player's save. The V2 source is six-stem-fingerprint-checked, source-score-hash-pinned, and explicitly experimental. The candidate's quiet drum/ghost-note holdout tests FAILED, so no automatic musical promotion is authorized. The sound-design-only standalone lab is excluded from this comparison. See MUSIC-DETECTOR-V2-UNREVIEWED-RESEARCH-20261117.md.

## Safety and release rules

- Keep Dynamic Orchestra OFF by default, with visible PRE-ALPHA badge.
- OFF forbids only new replacement instrument recordings, NOT source-stem DSP such as EQ, reverb, filtering, speed, air ducking.
- Biome-specific melody remains in both modes. All songs disabled in regular gameplay = absolute music silence; entering the opt-in isolated lab can audition a selected song without changing saved song switches.
- In-game lab must not alter score, shards, unlocks, achievements, run progression or persistent settings; no second independent sound engine.
- The confirmed 312-sample Opus shortfall of the original segment muxing is addressed by independent per-file encoding and exact decoded-frame checks, including partial tail segments.
- All audio fix releases need actual browser sound pipeline testing and separate release commits from game UI changes.
- The final gold set and human correction overlay should live in the same in-game lab, using source notes, stable IDs and manifest versions, rather than in the old standalone player.

## Review

Fable reviewed transcription biases, duplicate onsets, bass and melody reattack merges, drum-class loss and the 312-frame Opus deficit. Astra was consulted via Hermes on CT223 and advised repairing, validating and releasing the Opus assets separately before broadening gameplay UI. Review response saved at /home/hermes/experiments/bitstream-engine-integrated-20261117/ASTRA-FABLE-REVIEW-RESPONSE-20261117.txt .

The policy distinction here is explicitly Marvin's decision; acceptance of sound design does not mean acceptance of transcription accuracy.
