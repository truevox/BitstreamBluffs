# BSOD corruption loudness — real-source Ogg headroom correction

**2026-11-18 — music-owned research/build correction. Not merged into `main`; no deployment or human listening approval.**

## Problem actually measured

The first implementation at music commit `b225ac7` used `tanh(4.7*x)/tanh(4.7)` in the accompaniment waveshaper, which unintentionally amplified small signals about **4.7×** before blending. In a real Chromium `OfflineAudioContext` rendering of the first shipped segment for guitar, piano and Other across all four songs, the **12 real-stem** near-danger (0.97) tests measured **+5.64 to +11.39 dB RMS**, median **+9.23 dB**. Peak increases reached **+11.35 dB**. This is not a harmless timbre change: it could swamp melody or overload a combined song bus.

Original source/processor evidence outside Git: `/home/hermes/experiments/bitstream-bsod-threat-headroom-20261118.json`, SHA-256 `047263cac9d9f3238949ecba61fcbe80b71bf5bc56731016e24318ef2973d3a3`. The earlier source code checksum is included in the report. These were 3.5-second individual real Ogg stem windows analyzed after an initial 0.5-second ramp; NOT whole-song full mixes.

## Calibrated correction

`src/systems/music/BsodThreatProcessor.js` now uses a **waveshaper output divisor of 3.0** instead of `tanh(4.7)`. This prevents the unintended large small-signal makeup gain while preserving pitch-neutral saturation and a strong processed/dry mix at high BSOD danger. There is also a small **20% bell-shaped makeup gain at mid-danger**, smoothed as a native WebAudio `AudioParam`, which falls to exactly unity at zero and maximal danger. Without this mid-stage adjustment, some real stems dipped by over 5 dB as phase/filter blending changed, even though they recovered at near-contact. All processors, including the one new static gain node, are allocated only once per original stem and cleaned up on destroy. No new timers, buffers, distance simulators, decoding during gameplay, note edits, or global audio gain changes were added.

These are **Gal Friday's engineering calibration parameters**, not Marvin's audible approval or new owner requirements.

## Broader evidence and fixed regression gate

Audit tool: `tools/music/audit-bsod-threat-headroom.mjs` uses the exact checked-in `BsodThreatProcessor.js` source as an imported Chromium module. It reads and verifies the SHA-256 of each game-served Ogg against the identical local release Ogg, then renders actual **guitar, piano and Other** through an offline WebAudio graph at danger levels 0, 0.50 and 0.97. It selects **three different song segments (0, 3, 12) × 3 stems × 4 songs = 36 real stem passages**, measured over 3.5 seconds with an initial 0.5-second settling exclusion.

The first 12 passages were used for initial calibration. The other **24 later-song passages** expand coverage but are not human listening approval or independent compositions. Every report contains song/segment/stem identifiers, source Ogg SHA256, processor source SHA256, RMS, peak, and all three danger-level measurements. The tool refuses overwriting the evidence output.

| Across all 36 real passages | Medium danger 0.50 | High danger 0.97 |
|---|---:|---:|
| **RMS change from clean, min** | **−3.80 dB** | **−3.62 dB** |
| **RMS change, max** | **+2.51 dB** | **+2.39 dB** |
| Maximum peak change | +2.59 dB | +3.14 dB |
| Highest *individual-stem* measured output peak | −7.88 dBFS | −11.36 dBFS |

The **pinned engineering regression gate PASSES** at both levels: RMS changes within ±4 dB, peak increase at most +4 dB and individual stem output peak below −6 dBFS. This gate prevents an unreviewed reintroduction of the large BSOD loudness spike. **It is not evidence that the combined six-stem mix cannot clip, or that every passage/song is equally loud or sounds musically good.** Real-life mix balance, headphones and player-facing audition remain separate release gates.

Immutable final report outside Git: `/home/hermes/experiments/bitstream-bsod-threat-headroom-final36-verified-20261118.json` (SHA-256 `a0c99b31f98bcac0f2780cad5d352252aed1b69764a8f9f5d5ed832f26cbed97`). Exact corrected module source SHA-256 `c1df193c04a47d9cc94fbe2ea7cba52c9a20b8b61e7a0ff7e2c6b5ccc7cb25a6`.

Reproduce only on a private built game preview; use a **new** output path because reports cannot overwrite existing evidence:

```bash
GAME_URL=http://100.115.120.66:8205/ REPORT_OUT=/home/hermes/experiments/bsod-headroom-new-run.json node tools/music/audit-bsod-threat-headroom.mjs
npm test -- --runInBand --silent tests/src/bsod-music-corruption.test.js tests/src/audio-bsod-wind-contract.test.js tests/src/continuous-soundtrack-menu-shuffle.test.js tests/src/music-fx.test.js
```

Sound contracts are unchanged: authoritative physical BSOD proximity corrupts **original guitar/piano/Other only**; relative airflow drives wind independently; bass/drums/melody/vocals/SFX are not run through this processor. Menus restore the clean Debumont arrangement while preserving the current song clock. The existing GBrain design [[projects/truevox-bitstreambluffs/audio-stem-graph/reactive-accompaniment]] remains the owner-approved intent; the exact calibrated DSP values and measurement thresholds are engineering proposals.
