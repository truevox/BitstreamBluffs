# One More Run — higher-band spectral onset rhythm and whole-song phase coherence

**November 21, 2026 · Music Friday / [DRAFT PR #53](https://github.com/truevox/BitstreamBluffs/pull/53) · UNVERIFIED original-song source timing.**

## Why an alternative signal matters

Earlier low-band drum/bass onset estimators found plausible ~163 BPM rhythmic repetition but disagreed about local tempo/beat phase; a flexible dynamic-programming rhythm path fit drums more closely yet **failed held-out bass**. A false, fixed 160-BPM clock was never a verified source grid. Marvin correctly raised *possible* Suno/Kie variable tempo (not measured). This pass uses *different* audio features: **positive log spectral change from 230–4,700 Hz**, not primarily low-band RMS attacks, across **five original** separated instrument roles (drums, bass, guitar, piano and other). Each original `.ogg` byte sequence is independently checked against **already archived exact per-stem SHA-256 evidence** from the earlier first-pass and harmonic reports before FFmpeg decoding.

The new detector uses 5.805ms onset frames and compares 18-second overlapping local autocorrelation windows every 6 seconds, plus a separate *whole-song complex Fourier phasor frequency scan*. All OGGs are read from an existing full worktree without copying or re-encoding; all resulting reports are derived JSON only. The chroma and spectral streams use **the same separated source recording** and are **not truly independent recordings or ground truth**. The original 12s OGG segment boundaries are masked against spurious onsets. 48kHz original sample-count alignment remains manifest-bound, not proven sample-exact audio beat timing.

## Direct spectral-onset results (periodicity candidates, not actual musical tempo)

Across **28 overlapping** 18-second windows, with BPM hypotheses bounded 140–180:

| Stem | Median preferred spectral rhythm period, expressed as BPM | Window-range BPM |
|---|---:|---:|
| Original separated drums | 163.763 | 163.371–164.117 |
| Original separated bass | 163.804 | 162.942–164.761 |
| Original separated guitar | 164.220 | 160.080–175.773 |
| Original separated piano | 163.849 | 158.357–175.345 |
| Original separated other | 163.735 | 159.924–164.923 |

In **all 28 windows**, at least **two of bass, guitar and piano** favored a rhythmic period within **±3 BPM** of the independently spectral-analyzed drums; in **23/28**, all three did. This is not statistical confidence: overlapping windows, shared audio sources, and deliberately coarse assumptions create dependence. The earlier low-band and new higher-band drum estimators' preferred BPM figures differed by **under 1 BPM in every window** (mean absolute difference ~0.278 BPM), despite extracting rhythm features differently.

The earlier low-band bass onset detector's apparent **~130 BPM** outliers around 78–102 seconds are *not replicated* by the new bass spectral onset detector. That argues against immediately interpreting those outliers as musical tempo changes. It doesn't prove no tempo changes, nor confirm that the quarter note is 163.8 BPM. Weak instrument roles and instrumental syncopation still introduce ~158–176 BPM periodicity alternatives, especially for piano and guitar. Half-time feel and syncopation do not necessarily mean the beat period changed.

## Whole-song periodicity vs phase stability

The whole-song complex-phasor test independently scans a candidate 155–173 BPM **rhythmic modulation frequency** on each original spectral-onset stream, including separately rescanning both 87.3-second halves. A given phasor magnitude is a **relative onset-phase concentration** from 0 to 1, not a calibrated confidence or actual beat/downbeat probability. Dense chord attacks, subdivisions, note anticipation, changes in arrangement or timing drift all reduce it.

- Drums: best whole-song periodicity **163.80 BPM**, relative phasor coherence **0.240907**; first half independently best **163.70**, second half **163.90 BPM**. This 0.20 difference is an *estimator result*, not scientifically established tempo drift. Whole-song phase is **not strongly locked**; measured onset accent pattern and changing arrangement may account for it.
- Bass: best whole-song periodicity **163.75 BPM**, coherence **0.063786** (weak). Guitar **163.85 BPM**, 0.049809 (weak); piano **163.25 BPM**, 0.082291 (weak); other **162.75 BPM**, 0.056129 (weak). None provides independent validation of actual quarter-note pulse or phrase starts.
- A 163.80-BPM **drum-selected** periodicity is evaluated without refitting the other roles; the other stems have weak-to-moderate phase coherence at that selection. Coarse local spectral BPM consistency does **not** automatically establish global phase stability.
- Synthetic, *known-ground-truth* steady ~163.84-BPM impulses show strong phasor coherence (~0.98 over 36s), while deliberately ramping synthetic 155→172 BPM reduces even its best coherent phasor (~0.39). The method can discriminate those artificial cases, **but this validation does not prove what caused the real recording's lower coherence**.

**Interpretation:** We have stronger evidence for a prominent rhythmic periodicity in the 163–164 BPM neighborhood, including both low-frequency and separate high-frequency feature extractors. We still **cannot distinguish** a nearly constant true tempo with syncopation/arrangement changes from gently drifting source timing, especially where the bridge or pickups occur. The 160 BPM generation prompt remains an intended prior, not a source measurement. This also tells us why pushing a fixed-grid beat-one sequence to gameplay now would be dangerous.

## Validation / provenance / stop conditions

- Original whole-song manifest SHA-256 `e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a`, 15 uninterrupted source segments, 174.6 seconds = **8,380,800 sample frames at 48kHz**.
- **Source-bound original 5-stem OGG SHA checks** before audio decoding, with prior original drum/bass report and harmonic source report hashes also embedded in output JSON. Corrupted/mismatched source OGG bytes fail closed instead of silently creating music timing labels.
- Synthetic and malformed-input tests verify known steady and ramped audio onsets, known 154/160/166 BPM pulse intervals, half-time accents, zero/constant source rejection, source mismatch, nonfinite input, and no approved downbeat status. These are software validation tests, **not** source-music labeling.
- The phase scan is intentionally oversampled (0.05 BPM bins); do not infer 0.05 BPM *measurement precision* from a finite recording. Per-window frequency estimates, stems and bands share substantial statistical dependence.
- No musician review has certified any source downbeat, meter, phrase or half-time bridge, and no audio files, release metadata, game logic, World Dance, Gym scoring or synthetic clocks have changed.

### Reproduce

```bash
uv run --offline --no-project --with numpy --with scipy python -B tools/music/test_research_spectral_rhythm.py
uv run --offline --no-project --with numpy --with scipy python -B tools/music/test_research_global_pulse_phase.py
# Access exact existing original OGG pack; do not copy into sparse research checkout.
uv run --offline --no-project --with numpy --with scipy python -B tools/music/research_spectral_rhythm.py \
  --source-pack /existing/source/33_local-one-more-run-bitstream-bluffs \
  --prior-report docs/music-review/one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json \
  --harmonic-report docs/music-review/one-more-run-harmonic-bar-cues-UNVERIFIED-20261120.json \
  --out /tmp/spectral-analysis-UNVERIFIED.json
uv run --offline --no-project --with numpy --with scipy python -B tools/music/research_global_pulse_phase.py \
  --source-pack /existing/source/33_local-one-more-run-bitstream-bluffs \
  --prior-report docs/music-review/one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json \
  --harmonic-report docs/music-review/one-more-run-harmonic-bar-cues-UNVERIFIED-20261120.json \
  --out /tmp/phase-coherence-UNVERIFIED.json
```

Detailed machine diagnostics (both unapproved):

- `docs/music-review/one-more-run-spectral-onset-UNVERIFIED-20261121.json`
- `docs/music-review/one-more-run-global-pulse-coherence-UNVERIFIED-20261121.json`

**Outstanding:** Need truly independent *music-structure* evidence from original mix/musical listening on a few strong and ambiguous intervals to determine downbeats and bridge; likely add beat index continuity and stem-specific instrumentation offset models instead of an unqualified 160-BPM grid. Never promote any above hypothesis to `RELEASE_BEAT_GRIDS`, World Dance, Gym or physics without review. This document is agent research, not Marvin's endorsement.
