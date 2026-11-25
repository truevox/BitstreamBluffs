# #291 — clean v2 soft-peak guard draft, not release-approved

Branch is deliberately based on current `main`, not the older pre-release crossfade stack in experimental PR #321. Only the post-compressor final-output guard constants and their explanatory comment change at runtime:

| Parameter | Released v2.21.2 | Draft v2 |
|---|---:|---:|
| Soft knee | 0.86 | 0.74 |
| Soft ceiling | 0.965 | 0.82 |
| WaveShaper curve / native oversampling | 8193 points / 2× | Unchanged |
| Other biome presets, stems, vocal FX, SFX gains, playback and physics | Released values | Unchanged |

This is a sample-domain nonlinear backstop, **not** a calibrated brickwall true-peak limiter. Extra headroom does not guarantee perceptual transparency; no automatic normalization or source edit. The candidate should not be merged without an owner listening decision and independent code review.

Source-grounded QA is in draft PR #339 and `docs/music-review/20261124-issue291-r2-mixed-output-matrix.md` on that branch:
- 33/33 consecutive published R2 song crossfades (including the wrap; five high-risk biome identities stratified) at or below -1 dBTP 4× estimate: worst -1.268 dBTP, max RMS change .041844 dB;
- 99/99 opening/middle/ending original-OGG + scripted wind/SFX/BSOD/crash overlap stress windows at or below -1 dBTP: worst -1.744 dBTP, max RMS change .019861 dB;
- 1197 source-hash checks, original production baselines reproduced within 2e-5, independently verified published metadata and negative-tamper controls; zero sampled clips/4× overs/nonfinite samples;
- Earlier candidate v1 (.78/.88) missed -1 dBTP in 1 of 33 crossfades and is superseded for evaluation.

Owner-only blind 6-pair 24-bit FLAC listening preview is temporarily available at `http://100.115.120.66:18249/` on Tailnet; this represents v2 and should replace the old v1 preview. The user has not yet supplied a subjective listening verdict.

**Not proven:** continuous complete-song mastering, all biome × track combinations, actual v2 live crossfade/BSOD capture on the user's Chromebook or other hardware, or the physical cause of repeated -128-frame AudioWorklet timestamp discontinuities in a separate diagnostic tap. Invalid live capture reports are retained, never counted as passes. This is an unmerged draft only, [skip netlify].
