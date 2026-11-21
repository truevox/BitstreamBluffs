# One More Run: sparse instrumental MIDI audition

**Status: experimental listening comparison, NOT an approved game-music change.**
No original masters, original stereo recordings, source stems, source performance score or existing adaptive packs are modified.

## Audition

Open the standalone page at public/music-review/sparse-one-more-run/index.html through an HTTP server.
The song excerpt is **00:36–01:24**, 48 seconds. The original vocal audio is unchanged across six conditions:

1. **Recorded reference:** existing Debumont MIDI-derived instrument stems, mixed with source vocals.
2. **Dense synthetic control:** every extracted instrumental event, using the trial synthesizer.
3. **Beats only:** note onsets close to provisional source beat positions.
4. **Beats + half-beats:** note onsets close to beat or halfway positions.
5. **Rhythm-selective:** scores onset proximity, duration, chord group, kick/snare priority; limits attacks per beat.
6. **Hybrid:** original instrument recordings under sparse synthesized accents.

The recorded reference uses actual game-derived stem audio, but is a custom assembled fixed-Debumont example, not every possible in-game mix configuration. All three sparse variants and the dense control use the *same experimental synthesis timbres* so their note counts can be meaningfully compared. Do not interpret a difference between Recorded and Dense as proof that a specific sparsity algorithm is good.

All versions share one source vocal bed. Notes are selected from the canonical provisional performance score without changing pitch or note-onset positions; no MIDI is synthesized live in the browser.

The browser decodes six Opus audio files, schedules them together on one Web Audio clock, and crossfades gains in 40 ms when the choice changes. The audible mixes are RMS-scaled and peak-limited before encoding, not formally LUFS-mastered.

## Provenance and warnings

- Score file: public/music/packs/33_local-one-more-run-bitstream-bluffs/performance.json
- Source score hash is saved in the audition manifest.
- Source score quality is **provisional-unreviewed**, with uncalibrated note and drum extraction.
- Beat grid: public/music-review/sparse-one-more-run/beat-grid-provisional.json
- Grid extracted from the separate research file one-more-run-variable-tempo-first-pass-UNVERIFIED-20261121.json, with source SHA-256 recorded inside.
- **The source-beat grid is UNVERIFIED, NOT approved as the game's musical clock.**
- The selection algorithm may remove important offbeat material or preserve incorrect detected pitches. Human evaluation is required.
- The hybrid layer can muddy the original stems if notes double or stem leakage interacts badly; no claim of superior sound is made.
- Existing stereo recordings and separated stems remain completely untouched.

## Rebuild on CT223

Requires FFmpeg and Python with NumPy. Use a **new empty output directory**, never the original game pack.

    python tools/music/render_sparse_audition.py \
      --pack /home/hermes/.local/share/bitstream-static-music-v1/packs/33_local-one-more-run-bitstream-bluffs \
      --grid public/music-review/sparse-one-more-run/beat-grid-provisional.json \
      --out /tmp/bsb-sparse-test-v3 --start 36 --seconds 48

    python tools/music/test_sparse_audition.py

Serve the page using a standard HTTP server from its directory. The output clips are self-contained and do not need access to the source pack during playback.

## MIDI plus audio stem architecture

MIDI is event/control data, not a waveform. Rendering it offline to aligned audio is the simplest, safest way to mix it with other stems. Use the source sample clock and verified changing tempo map, align attacks, reserve mix headroom, avoid accidental doubling, and keep user control over gain/ducking. Browser live MIDI is possible, but is a different, higher-CPU and higher-synchronization-risk implementation.
