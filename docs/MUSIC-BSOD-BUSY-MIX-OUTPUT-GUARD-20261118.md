# Busy gameplay music/SFX/wind headroom — original soft-guard milestone

**Superseded warning (added November 18, Gal Friday):** The single 4×
oversampled soft WaveShaper at commit `454de31` was NOT a reliable
sample-peak ceiling on narrow transients. A new source-bound 60-state
Chromium OfflineAudioContext diagnostic measured **+0.291 dBFS** on
sharp pulse inputs at 44.1, 48 and 96 kHz, even though earlier four-song
music+SFX samples stayed under full scale. The built and browser-tested
corrective two-stage candidate adds a **nonoversampled final sample
ceiling** AFTER the existing 4× soft processor. See
`docs/MUSIC-MASTER-PEAK-CEILING-20261118.md` for exact evidence,
remaining limitations and independent review status.

The following earlier report preserves the **historical** measured
`454de31` state; do not use its 4× curve alone as a final sample-level
ceiling or as a human mixing approval.

**November 18, 2026. Engineering research, not human sonic approval.**
**Branch:** `feature/music-bsod-corruption-20261118`, isolated; do not merge to `main` or Control Friday's `59cbb2d` without their integration/regression gate.

## Failure discovered with shipped WebAudio, not synthetic notes

The existing 36 original-stem Ogg measurements and 60 music-only run/menu samples passed, but those tests intentionally had SFX and environmental wind OFF. A more demanding browser test, `tools/music/audit-bsod-busy-mix.mjs`, uses **real song playback** through the actual `StemMusicDirector`, with the following test-only stress conditions:

- Four published songs, three passages each (opening, middle, near ending), normal and busy comparisons; 12 × 2 = **24 music playback states**.
- `masterVolume=1`, `musicVolume=1`, `sfxVolume=1`, `windVolume=1`, real SFX and authoritative BSOD proximity/relative-wind event payload.
- Existing original vocals bus directly enabled inside the throwaway Chromium QA page, bypassing **only the test's entitlement state** so the signal is tested. No user's save, unlock/shard entitlement, player profile or persistent settings were modified or granted.
- Busy state: near-wall `proximity01=.97`, airflow +1000 px/s, speed 1100 px/s, airborne, combo 5, and dense real `playSfx()` bursts (hop, trick, near-miss, perfect land, boost, hard land). The many overlapping events are an intentionally harsh sound-system benchmark, **not a claim about typical gameplay**.
- The analyser reads the WebAudio **post-master-compressor** output. Analyser taps terminate into zero-gain sinks, disconnect on completion, and never create a competing music player.

**Negative baseline finding:** despite the compressor, this combined output exceeded 0 dBFS in three of 12 measured busy passages, up to **+0.498 dBFS**. These are float-domain samples upstream of device output and demonstrate insufficient headroom; sound cards may clip such samples. The original report was intentionally retained at `/home/hermes/experiments/bitstream-bsod-busy-mix-full-v2-20261118.json` (SHA-256 `fee41a7dfc14e7e84504b4c5bb46b97d9e5e682154bfa25b9aa6f68fe0168515`). This is a **quality bug**, not a failure of BSOD event physics.

## Correction: one final shared peak guard

`src/systems/music/MasterPeakGuard.js` defines a deterministic bounded transfer curve. `AudioSynth._buildGraph()` inserts exactly **one** native 4×-oversampled `WaveShaperNode` after the existing master DynamicsCompressor and before the AudioContext destination. All song stems, unlocked vocals, wind, SFX, crash effects and glitches already share that one output route. No track clock, source Ogg, notes, user volume settings, music-vs-wind logic, or gameplay controls change.

The curve is **exactly linear** for absolute waveform amplitudes at or below 0.82 (~−1.72 dBFS). From there a continuous, monotonic soft knee approaches 0.89 (~−1.01 dBFS) without overshooting. This is a **soft peak guard** rather than a sample-perfect, lookahead, true-peak limiter. High-level transients are gently contained; low-level audio has no new gain reduction. This is a **provisional engineering mastering ceiling**, not an owner-approved mix/master or substitute for true-peak listening validation.

The pure regression covers identity, bipolar symmetry, monotonicity, boundedness, zero/NaN behavior, and single oversampled node creation. The browser stress regression measures real music, vocals, wind and SFX together and must report a failure if **any sampled output channel** exceeds unity. It also verifies that returning to the menu switches to Debumont and clears the BSOD wind/music threat without restarting the song.

## Important limitations

**Final repeated full-bus stereo result:** The final 0.82/0.07 soft-knee
setting was retested against the same four songs, 12 source positions,
24 normal/busy states. The pre-guard master signal still reached
**+0.365 dBFS**, but **no post-guard clipping** was sampled on the
regular analyser or on either separately analysed stereo channel.
Highest output peaks were **−1.046 dBFS** (main output analyser),
**−1.048 dBFS** (left), and **−1.045 dBFS** (right). The real wind
and SFX buses were non-silent and all four songs loaded; a crash reset
music threat/wind, returned to Debumont and kept exactly the same song
clock. No production audio assets, player entitlement or save state changed.

The final stereo evidence is stored at
`/home/hermes/experiments/bitstream-bsod-busy-mix-stereo-guard-20261118.json`,
SHA-256 `b9eed39498284b13e4353f4dbdc3ce5b715234fbbf782fb3bf56f8a53432d097`.
The test script refuses to overwrite evidence. **Human listening approval
has not been given or implied.**

The browser audit is sampled across selected segments; it is **not** a continuous entire-song scan or guaranteed `−1 dBTP` true-peak measurement. Separate channel analysis is necessary because a default WebAudio analyser may downmix stereo and conceal one hot channel. Any future changes to the common output node, SFX gain, new vocal unlocks or per-biome FX require rerunning the busy-mix check.

This engineering change necessarily touches the shared `AudioSynth.js` output wiring. Keep the published music branch separate and let Control Friday integrate it into a new worktree; do not alter their tested `59cbb2d` baseline or silently deploy.

**Remaining user gate:** Marvin listening to the actual in-game music and gameplay mix when convenient. The standalone `:8208` A/B page is for preliminary sound-design audition, **never authoritative note/transcription or game mix validation**.

## Verified technical gates before feature publication

- **130/130 source suites and 2,201/2,201 individual Jest tests** passed on the final 0.82 / 0.07 peak-guard curve.
- The production Vite build passed. **8/8 real Chromium music workflows** passed, including the BSOD music processor, uninterrupted soundtrack, natural song rollover, three-screen jukebox, in-game Music Lab, score inspector, source review queue, and Sound Manager purchases.
- **12 real four-song stereo busy-mix scenes and 12 normal scenes passed**, including wind, original vocals enabled in the disposable QA browser, dense real SFX, all four volume sliders at full and scene/death reset. No stereo channel exceeded digital unity.
- The older mixed-program and 60-window sampling scripts now tap `a.nodes.peakGuard || a.nodes.comp` so any future run measures actual final output on guarded builds. Historical old reports remain immutable and describe their older pre-guard graph.
- The graph implementation and test-only tooling do **not** change song files, player settings schema, unlock entitlements, progression, run physics, menus or Control Friday's feature branch.

**Exact source integrity:**

- `AudioSynth.js` SHA-256: `7d9a95b6b60bf30f82a013f6803d17408d0d9ce7644ef6160e6281dccec25ed6`
- `MasterPeakGuard.js` SHA-256: `deea562477dc4f298521b1ff4c798fd1e90adf0360a8aa050bb83d7d73b16be6`
- The immutable post-guard stereo evidence report above was collected using this exact code and the build at isolated private QA port `8212`.

To rerun on a new private build, choose a **new** output path; the audit refuses to overwrite old evidence:

```bash
GAME_URL=http://100.115.120.66:8212/ REPORT_OUT=/home/hermes/experiments/bsod-busy-mix-next.json node tools/music/audit-bsod-busy-mix.mjs
npm test -- --runInBand --silent tests/src/music-master-peak-guard.test.js tests/src/bsod-music-corruption.test.js tests/src/audio-bsod-wind-contract.test.js
```
