# Real WebAudio oversampling overshoot — two-stage output ceiling

**2026-11-18 — independent automated engineering finding by Gal Friday; numerical DSP values provisional, NOT Marvin-approved sound quality.**

**Status:** Two-stage fix in isolated `feature/music-final-ceiling-20261118`, based on published music feature `454de31`; not merged or deployed, independent Astra Friday verdict still pending. Control Friday's integration `59cbb2d` and `main` untouched.

## What the original green tests missed

`454de31` had solved real mixed-song sampled clipping from vocals, wind and overlapping gameplay SFX by inserting a **single 4× oversampled native WebAudio WaveShaper** with a bounded transfer curve approaching 0.89 linear amplitude (about −1.01 dBFS). It passed the original 24-state, four-song live stress test.

A newly designed cross-sample-rate browser `OfflineAudioContext` audit showed that **the WaveShaper's internal oversampling downsampling filter can ring beyond the nominal sample ceiling on extremely sharp transients**. That is not a failure of the mathematical curve: it is a difference between the bounded transfer function and the **delivered WaveShaperNode output**.

A test signal with deliberately overdriven narrow pulses (far harsher than a normal guitar note) at 44,100, 48,000 and 96,000 Hz produced the same output pattern:

| WebAudio WaveShaper path | Highest sampled output |
|---|---:|
| Single 4× oversampled soft guard (old `454de31`) | **+0.291 dBFS** |
| Single 2× oversampled soft guard | **+0.450 dBFS** |
| Single *nonoversampled* soft guard | −1.065 dBFS |
| New **4× soft shaping + final nonoversampled ceiling** | **−1.012 dBFS** |

The 4× stage reached actual sample amplitude **1.034**, despite its nominal transfer-curve limit of 0.89. Therefore `454de31` must not be described as an absolute sample-level output ceiling. Stereo opposite-polarity tests also demonstrated why a mono analyser alone cannot validate both channels.

Original comparative 60-case diagnostic report: `/home/hermes/experiments/bitstream-master-guard-samplerates-two-stage-20261118.json`, SHA-256 `4144452401dbe0e26f358a3d10a0299463f84ce9ece8299bbb8b10a5930e5452`.
Source-bound revised benchmark: `tools/music/audit-master-peak-guard-samplerates.mjs`, exact experimental report `/home/hermes/experiments/bitstream-master-guard-samplerates-source-candidate-20261118.json`, SHA-256 `68389861fb906b8244dcd0567460c45b37cab9430159fafa5434e0b9f0ed8e61`. It imports the actual checked-in guard functions and reports all old 4×/2× failures without suppressing them. **All 15 new 4×+final-ceiling stereo case pairs across three rates passed the sampled ceiling gate; 60 conditions were compared overall.**

## Fix

`MasterPeakGuard.js` retains the original continuous, monotonic 4× oversampled **soft** transfer curve for gradual high-level saturation, and adds `createFinalSampleCeiling(ctx)` for one extra **nonoversampled** WaveShaper with identity transfer through |x|=0.89 and a hard sample bound of ±0.89 beyond that threshold. The native processing chain is:

`full shared music/SFX/wind/static mix → existing master compressor → 4× soft peak shaper → nonoversampled final sample ceiling → AudioContext.destination`

This is one common **two-node final output safety stage**, not a separate per-track DSP, and it never changes any soundtrack file, note score, saved setting, playlist clock, entitlement or physics state. A hard sample ceiling is needed because if it itself oversampled, its downsampling filter could ring above the intended bound again. The second stage has **no oversampling filter after its curve**.

The final stage is intentionally linear for all output samples already ≤0.89, and only clips the 4× stage's occasional outlier samples. The native WebAudio graph and separate stereo output are tested, rather than trusting a pure JavaScript saturator alone.

**Important limit:** This is a **sample-peak bound at the WebAudio node**, not an absolute true-peak intersample / DAC guarantee. Other sample rates, unusual browser engines and hardware resamplers remain outside the exact tested cases. The local waveform can still be distorted if routinely overdriven; this is a safety net, NOT an excuse for a bad premix.

## Testing and release status

- Source unit tests: `tests/src/music-master-peak-guard.test.js` checks bounded transfer, threshold identity, symmetric soft curve and final nonoversampled sample bound.
- Original 36 real-Ogg stem source audit still has separate musical calibration limits. The more recent `tools/music/audit-bsod-busy-mix.mjs`, `tools/music/audit-bsod-song-coverage.mjs` and `tools/music/audit-bsod-mixed-program-headroom.mjs` were changed to analyse **after the actual final sample ceiling** on two-stage builds.
- **24 actual game busy/normal states across 12 passages and four original songs** passed on the two-stage Chromium build :8214 with original vocals enabled *only in disposable QA*, all volume sliders max, wind at signed 1000 px/s, rapid real SFX bursts and near-wall BSOD musical corruption.
- Across these sampled mixed passages, all stereo channels had measured max output around **−1.055 dBFS**; no sampled clipping. A crash reset threat/wind, restored Debumont melody and preserved the same current song clock. Exact full-game report `/home/hermes/experiments/bitstream-final-ceiling-live-stereo-20261118.json`, SHA-256 `db622e2b257c7e1115b1d9bcb9df11133ec01d3370dc0bba8d2b118880d166c8`.
- The initial two-stage source test run passed **130/130 suites, 2,202/2,202 tests**, production Vite build passed, and **8/8 Chromium music workflows** passed.
- Wider actual-game source coverage passed **60/60 sampled clean/mid/near-danger states** at 20 positions across four songs, including ending segments and a Debumont menu state. No sampled clipping or browser errors; the maximum sampled master peaks were clean **-7.05**, mid **-6.95**, near **-8.14**, menu **-7.96 dBFS**. Immutable report `/home/hermes/experiments/bitstream-final-ceiling-song-coverage-20261118.json`, SHA-256 `a4b5ec8f04cc166e30ebc3fcac1cd2ac3605be9a39392ee45fd4ef6ef770fc40`. These are sparse music-only samples, not full-length true-peak proof. The normal/near RMS differences are not matched-source static isolation.
- Exact new engine code SHA-256: `MasterPeakGuard.js` `8189310d9e05256b9d2a569339e4f7d8dbd235123dafc516278b9c2cf696ee6a`; `AudioSynth.js` `c020dda6f97c52aa179c11a19c4180b58ce99ae2b601d45e329fcbe9cd4ab7c0`.
- **Independent Astra Friday review requested on CT223, not completed.** The first high-effort session did inspect files but was interrupted before returning a review; its resume failed with a Hermes gateway connection error, and a short fresh attempt was refused during an in-progress Hermes source update (`update_paused`). Treat this as no reviewer verdict, not a pass or fail. The review brief was preserved at `/home/hermes/experiments/bitstream-astra-independent-audio-review-brief-20261118.md`.
- Further full-duration/true-peak QA and human listening approval remain pending; **no listening approval has been received** from Marvin.

## Boundary for future integration

Cherry-pick the eventual two-stage fix *after* `454de31` into a separate combined gameplay QA worktree, preserving the Control Friday branch and reviewer authorship. Confirm old start-of-session One More Run, continuous music across crash/menu, saved shuffle, authoritative proximity/wind separation and zero on/off regression. No `main` merge or deployment until combined tests and human sound review.
