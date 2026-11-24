# Candidate: tighter final-output peak backstop
Separate draft stacked on #316 (33bb1fe2); no edits to approved biome presets, original recordings, source gains, playback clocks, physics, or replay identity. The final output transfer is exactly linear through 0.78; soft knee approaches 0.88, same 2x oversampling and same native node. This is a sample-domain nonlinear backstop, NOT a true-peak limiter or mastering certification.

Paired experiment: actual contiguous v4 pre-guard PCM from high-speed controlled original-song overlap (index 1), replayed offline through the identical input to current guard, tighter 2x guard, tighter 4x guard, and original guard with -1dB post trim. Four qualified biomes, five rejected instrument captures including all three Arcade pre-guard attempts. Paired private aggregate SHA-256 7dc5762d68c8048527378dcf0abeb3d954b1f08be8d88d104cba5da5c7ed9d86. All four soft-knee comparisons retained integrated loudness at 0.1 LUFS reporting resolution; that does NOT establish identical timbre or perceptual equivalence. 4x did not demonstrate a meaningful benefit. The fixed -1dB trim reduced all loudness by 1dB. Baseline Candy Cane rounded to 0.0 dBTP in FFmpeg; independent estimate -0.027.

| Biome | Paired baseline | Paired tighter 2x | Actual candidate live |
|---|---:|---:|---:|
| Candy Cane | -0.027 | -0.675 | -0.528 |
| Vertigo | -0.382 | -1.014 | -1.018 |
| Garbage | -0.458 | -1.133 | -1.139 |
| Crystal | -0.552 | -1.233 | -1.235 |

All numbers dBTP estimates. Actual candidate live final PCM: 4/4 qualified, two invalid instrument attempts retained, zero measured overs/clips/nonfinite/near-silent overlap windows. Independent FFmpeg -0.5, -1.0, -1.1, -1.2 respectively. Private aggregate SHA-256 606b87d285d6546e31295969119b56eacd764e7c639ca60b97595b9343820371. Candidate is an improvement, not yet meeting conservative -1 dBTP on Candy Cane. Arcade's discontinuities also occur pre-guard: do not assign cause to guard or declare solved. Capture reliability/device testing, actual moving-gameplay/SFX/BSOD stress on candidate, full catalog/biome coverage, subjective listening and independent review remain. Do not merge or publish private media based on this experiment alone. 42 focused tests, ruleset/identity checks PASS.
