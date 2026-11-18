# Music-engine QA after independent Astra source review — 2026-11-18

**Scope:** isolated Music Friday `feature/music-final-ceiling-20261118` only. No Control Friday merge, `main` deployment, sound-level approval, permission changes, or persistent player changes.

## Reviewer provenance and gate

At source commit `1d923b2`, a **separate, completed read-only GPT-6 Astra/Codex** review returned **CONDITIONAL PASS for integration QA**, NOT release approval. Report: `/home/hermes/experiments/bitstream-astra-direct-codex-review-20261118.txt`.

The original **Astra Hermes session** `local-daa24b37b9b0de58b285ea9fda3b3208b114d8a80e8fe176efdca6ffde4424f0` remains distinct and must be **RESUMED, never replaced** when CT223 Hermes stops reporting `update_paused`. The user has another thread repairing Hermes. The direct Codex review is not evidence that the original Hermes query finished.

## Reviewer concerns and remediation

- **High, strict ceiling:** All sample-rate and real-game stress checks now fail when a channel exceeds `PEAK_MAX + 0.0002` (0.8902), not a permissive 0.90/1.0. NaN/Infinity outputs fail too. `tools/music/audit-master-peak-guard-samplerates.mjs` and `tools/music/audit-bsod-busy-mix.mjs`.
- **High, bypass prevention:** New `tests/src/audio-master-graph-integrity.test.js` executes actual `_buildGraph()` against recording WebAudio mocks. It asserts the **only audible output connection** is `finalSampleCeiling -> destination`, and verifies music/SFX/wind/static buses pass through compressor, soft shaper, and final nonoversampled ceiling in order. The separately injected one-sample, zero-filled browser-autoplay unlock buffer is explicitly not part of audible routing.
- **Medium, stereo:** Both `tools/music/audit-bsod-song-coverage.mjs` and `tools/music/audit-bsod-mixed-program-headroom.mjs` now split final output into independent L/R analysers and enforce the sample ceiling on each. These are **sparse time-domain samples**, not contiguous full-song true-peak capture.
- **Medium, served-build evidence:** The busy-mix browser test compares SHA-256 of actual served `index.html` **and the entry JS bundle** against this checkout's built `dist/` files. It records the served digests, actual Chromium version and WebAudio context sample rate in each immutable report, as well as local source-file SHA-256. A stale/different served production bundle fails rather than returning a falsely bound report. This check requires a built/static preview, not Vite dev server.
- **Medium, partial initialization:** `_ensureCtx()` now catches failures during `_buildGraph()`, disposes partial stem-director attachment and closes the just-created AudioContext before nulling the reference; a new unit regression reproduces failed node creation and asserts close/dispose.
- **Medium, integration timing:** The music-branch BSOD browser smoke now uses Control Friday's actual WebAudio filter-convergence condition instead of a fixed 550ms delay. Preserve this exact behavior when cherry-picking into a combined gameplay test worktree.

## Hard ceiling spectral tradeoff (not a listening verdict)

A new **source-bound** `OfflineAudioContext` 9 kHz bipolar stereo overdrive test at 44.1/48/96 kHz adds high-frequency harmonic measurements and per-sample final-ceiling activity. Sample-rate testing now includes 6 input types × 4 shaper modes × 3 rates = **72 synthetic configurations**, of which **18 use the production two-stage chain**. The test deliberately allows the historical single-stage modes to fail and requires every two-stage output channel to remain under 0.8902 amplitude.

At **48 kHz**, an intentionally excessive 9 kHz sine of amplitude 1.034 produces a 21 kHz folded third-harmonic component around **−34.66 dBFS** after the two-stage guard, versus around **−68.38 dBFS** with just the 4× soft stage. This is evidence of an audible-spectrum *possibility* when the final hard ceiling is active, not evidence normal game music sounds bad. With moderate and quiet stimuli, the final ceiling changed **zero samples above 0.0002**. When narrow synthetic pulses forced the oversampled stage beyond the limit, the second stage corrected about 0.6–1.3% of samples depending on sample rate, with maximum correction about 0.144 amplitude.

**No numerical DSP re-tuning is owner-approved.** The current limiter is a proven *sample-domain* safety backstop, not a sample-perfect lookahead limiter, a full-song continuous peak scan, or a true-peak/digital-to-analog guarantee. Before release, characterize activation under realistic full-duration mixed material and obtain human musical approval.

## Independent review limits

Astra's completed Codex review performed read-only source/diff inspection, mock graph execution, curve checks and an isolated numerical alias probe. It **did not run** the complete Jest/Chromium/Vite gates itself. Music Friday's own additional measurements are distinct from Astra's verdict. No claim of original Hermes-session completion or Astra sign-off on later follow-up changes is made.

## Updated engineering verification (Gal Friday, November 18)

The follow-up source implementation and tests were run separately from Astra's earlier report: **131/131 source test suites, 2,204/2,204 Jest tests, and the Vite production build passed**. The original 8 browser/music workflows were rerun on the rebuilt private QA game. The source tree and the original user game must still not be merged or deployed without Control Friday's integration review.

The strict 24-state combined-game stereo audit passed with **no output above 0.8902 amplitude**. It verified served HTML and JS assets from `http://100.115.120.66:8214/` match the local production build byte-for-byte; measured Chromium 158.0.8127.18 and actual WebAudio rate 44.1 kHz. The final stage **never had to act** in the sampled busy-game states: no soft-shaper L/R sample exceeded the hard ceiling. Source-bound, immutable stereo report: `/home/hermes/experiments/bitstream-astra-fixes-busy-stereo-20261118.json` (SHA-256 `90abfb42c6361d27587e26aee53b5c3954299d74182353c9177cca45bd1dbf2b`).

The widened four-song **60 sampled-state** sweep passed with separate L/R analyser channels and menu return: `/home/hermes/experiments/bitstream-astra-fixes-stereo-song-coverage-20261118.json` (SHA-256 `1d7b30e1ab37787d501bc62085ee2e39ca30cae492c0c2ba619dbbeac0d7b478`). The four-song mixed-program A/B-and-menu sweep also passed with independently checked L/R probes: `/home/hermes/experiments/bitstream-astra-fixes-stereo-program-v2-20261118.json` (SHA-256 `f3bf26dca3c66fbedb1c5d5bdfb13a226512d32a05fe83f6334442f2b9caa045`). A brief first attempt of that last *QA script* failed because the newly added stereo tap forgot to carry its `name` field; the script was corrected and passed upon rerun. This was a regression in the audit instrumentation, not in the game engine.

The broader source-bound synthetic audit at `/home/hermes/experiments/bitstream-astra-high-frequency-20261118.json` (SHA-256 `fdedd69e6a3e7337349996e81e8aac7d1aa5f4431c7e1d7c19c9097728546495`) has **72 scenarios**, including 18 two-stage examples and 54 comparisons. All candidate samples obey the tight ceiling. But an intentionally overdriven 9 kHz, amplitude 1.034 input causes the hard safety stage to change **~23% of samples at 44.1 kHz and ~35% at 48 kHz**; the folded third-harmonic component reached **−33.35 and −34.66 dBFS**, respectively. This is a meaningful measurable **distortion/aliasing tradeoff** under unnatural high-frequency overload—not evidence of poor quality in normal game playback. Correct gain staging is still required; the emergency sample ceiling is not a compressor replacement.

**Remaining gates:** original saved Hermes Astra session has not completed (a separate conditional automation checks for safe recovery and resumes the exact session once healthy); Firefox/WebKit are not installed on CT223; full-length continuous true-peak, speaker/device performance, and Marvin's listening review are still not performed. No human-quality approval should be inferred from these automated passes.
