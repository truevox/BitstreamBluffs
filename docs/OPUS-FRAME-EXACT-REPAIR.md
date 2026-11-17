# Bitstream Bluffs — Sample-exact Opus segment repair

**Date:** 2026-11-17
**Scope:** Audio packaging only. No note transcription, new MIDI, melody assignment, instrument design, gameplay UI, or replacement-policy change.

## Defect and evidence

Fable Friday found that the old render_full_dynamic_orchestra_v1.py passed complete instrument waveforms through ffmpeg's continuous Opus segment muxer. It yielded **575,688 decoded frames**, rather than the required **576,000**, for a regular 12-second replacement chunk at 48 kHz. Gal Friday independently decoded the actual shipped media and confirmed the **312-frame / 6.5 ms underflow**. Original six source stem clips already decoded to exact lengths.

The real StemMusicDirector schedules at integer sample positions and clamps playback to buffer.duration. The short clip was a credible cause of missing samples at segment boundaries. The frame mismatch is proven; audibility in every scene is not claimed.

Astra Friday independently reviewed Fable's observations on CT223. She recommended an isolated sample-accurate audio repair, exhaustive frame tests and a real Chrome decoder check BEFORE game UI or transcription changes.

## Repair

tools/music/opus_exact_segments.py implements a shared **independent per-segment** libopus encoder. Every clip comes from exactly the source interval given by pack.json startFrame and frames. A decoded PCM exact-frame gate runs on every produced file. It fails closed on missing or truncated samples. render_full_dynamic_orchestra_v1.py now calls this module; render_additional_instruments_v1.py already imports that main renderer and therefore uses the same corrected encoder.

The original recording and note extraction algorithms are unchanged. Do not solve this by padding silence, bypassing source duration clamps, time stretching, or adding arbitrary crossfades.

## Full release acceptance results

- **4,745 / 4,745 Opus assets** fully PCM decoded using FFmpeg 7.1.4, checked against each segment's integer exact frame count; **zero mismatches**.
- **455 original source and home-melody clips byte-for-byte SHA-256 identical** to prior main release.
- **4,290 re-encoded** provisional full-song alternative instrument clips, including all eleven biome voice sets and five instrumental roles, preserving the existing note-event timing.
- All four songs checked, including every regular 12-second and irregular final segment.
- In real Chromium/WebAudio, **84 representative Opus clips** decoded to their exact expected frames, across four songs and selected original and replacement parts at beginning, middle and tail.
- Real Chromium game started the corrected music, entered Crystal Cavern/Airborne/Dynamic Orchestra ON, and played five live replacement families with no JS exceptions or failed HTTP resources.
- Source scores are still provisional. This is a verified packaging repair, not proof that the orchestra now plays the correct notes.

Primary gate: tools/music/validate_opus_exact_release.py
Real browser test: tools/music/smoke-opus-segment-boundaries.mjs
Regression for the independent Opus encoder: tools/music/test_opus_exact_segments.py
Private detailed report: /home/hermes/experiments/bitstream-fable-opusfix-20261117/pcm-4745-release-validation.json
Private QA game used port 8198 (Tailnet only).

## Marvin's explicit two-lab rule

The standalone lab is sound-design-only: audition holopad versus glockenspiel, effects, modulation, speed-dependent mixing and other timbral artistic options. It must NOT be treated as validation of transcription accuracy, source note timing, repeated attacks or Opus synchronization.

The IN-GAME music lab uses the exact game director, music manifest, decoder, WebAudio clock and routing; it is the authoritative environment for real-pipeline transcription, timing and integration checks. It is being developed separately, after this isolated audio repair.

Do not merge unrelated Settings, entitlement or jukebox changes into this fix.
