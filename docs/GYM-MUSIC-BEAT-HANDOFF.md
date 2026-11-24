# Music Friday → Control Friday: verified on-beat Gym release

**Owner intent (Marvin, 2026-11-18):** After approximately 1 second of staged READY, release the rider on a *regular musical pulse* where possible. Not specifically beat 1 of a bar; never target a syncopated offbeat. Applies to initial launches and quick retries. No musical requirement may hold the physics clock hostage.

## Music Friday deliverables

1. Create a *validated quarter-note pulse grid* for each active recording/arrangement (source-performance seconds). Either a confidently measured BPM **plus phase** for steady tempo, or actual ordered pulse timestamps for tempo-variable tracks. BPM alone is insufficient.
2. Record the grid's origin/version, confidence, manual spot-check outcome and track identity. Mark uncertain, silent, pickup-driven, rubato, and syncopated sections invalid until reviewed. Do **not** fabricate quarter-note pulses from bars, drum transients, or arbitrary tempo estimates.
3. Expose a **public, read-only timing API** on the music service (not the private `_stemMusic` field) that tells gameplay whether a grid is trusted, which track/transport revision it belongs to, and when the **next regular pulse** occurs relative to the actual playing transport / `AudioContext.currentTime`. Account for pause/resume, buffering/suspension, seeking, track changes, re-entries and loops.
4. Supply deterministic unit tests and one running-browser test with real playback, seeking, pause/resume, silent/muted music, low-confidence tracks, and mid-READY track changes. Include sample-accurate phase checks at beginning, middle, and near end of songs.

## Control Friday integration contract

- Gym's gameplay timer remains authoritative. Hold the first 1000 ms (normal READY) independently of music or WebAudio.
- **After** minimum hold, use the next *verified* regular pulse only if its extra wait is <=300 ms. Otherwise GO at once. A new/invalid track, disabled music, suspended audio, stale transport snapshot, missing API, exception or rejected timing always means immediate normal GO.
- Never wait for measure start, lock to upbeat subdivisions, step Matter physics from audio, reset the musical transport, or play/start a new track just to synchronize Gym.
- Preserve one uninterrupted *in-Gym* flight's five scored Bluffs for the hidden configuration unlock, and all existing non-ranked retry/mission/save isolation.

## Integration follow-through (2026-11-18)

The public music API from Music Friday commit `5325f5b` has been integrated on
`integration/gym-verified-beats-20261118`. RunScene owns the original READY,
queries at the boundary only, may add one bounded 0–300ms hold for a verified
pulse, and releases unconditionally even if the playback revision changes.
Collision resets and scene shutdown discard pending advice. All production
beat grids remain unverified, so the current release still uses normal
one-second GO. Browser-only synthetic grids exercise the trusted positive
path and actual original OGG transport without asserting musical correctness.
See the appended integration section in `src/ARCHITECTURE.md` and
`docs/MUSIC-GYM-VERIFIED-BEAT-TIMING-20261118.md` for the music-owned contract.
