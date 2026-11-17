# Audio labs: sound design versus real pipeline validation

**Owner decision — 2026-11-17.** Marvin expressly limited the existing standalone lab to **sound-design experiments only**: instrument/timbre auditions (Crystal Cavern holopad vs glockenspiel), speed-dependent bass boost/duck, effects, ambient character and musical mixing. **The standalone lab must NOT validate transcription, note timing, attacks, releases, source-to-replacement synchronization or shipped segment decoding.**

## Authoritative division of responsibility

**Existing standalone lab, private port 8186:** creative SOUND DESIGN sandbox; choose and compare timbres, DSP, reverb, dynamic mix policies, expressive instrument aesthetics. The waveform may be intentionally simplified. No claims of transcription fidelity may be based on standalone results.

**In-game lab (Manage sound → Music lab):** authoritative actual-game audio pipeline validator using the same live StemMusicDirector, MusicPack manifest schema, StemFXMixer, AdaptiveBiomeRouter, actual Opus chunks, decoder and WebAudio sample clock as gameplay. For inspecting decoded sample counts, note-on timing, repeated attacks, sync, source-versus-replaced A/B, per-stem isolation and gameplay state. A research result is not approved until it passes this real engine and a real-song benchmark.

The offline research and full-song render must share one versioned performance/event representation and one rendering toolchain. Build source-grounded, immutable integer-sample note timelines with provenance, then run exactly the same renderer on selected bars or whole songs; do not silently promote detector heuristics.

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
