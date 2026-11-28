# *One More Run* — periodicity, syncopation and beat-phase cross-check (UNVERIFIED)

**2026-11-21 · Music Friday owner of research PR #53 again · No approved source beat, tempo, downbeat, bridge or meter.**

## Why the other tracker wasn't enough

The [variable-tempo first pass](20261121-independent-variable-tempo-diagnostic.md) fitted original drums better than a fixed grid, but degraded held-out bass evidence. The reverse bass-trained fit was better on drums than the bass-trained static control, yet the two fitted streams agreed on just 20.81% of exact beat times within 40ms. This is **not evidence of verified tempo drift**. A rhythmic onset is not necessarily the quarter-note pulse, and a bass note is not necessarily synchronous with a kick or with beat one.

A second, deliberately different estimator now uses **windowed onset autocorrelation**, including separately ranked half-time and double-time rhythmic hypotheses, then **cross-correlates** the drum and bass streams over possible offsets. It does not reuse the prior Viterbi period path to estimate local rhythms, although both methods reuse the same low-band source-onset envelopes and stems separated from one original audio recording. It must **not** be called independent ground truth.

## Source and reproducibility

- Immutable exact original *One More Run* source pack: 174.6 s, 8,380,800 frames at 48 kHz, 15 segments, manifest SHA-256 `e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a`. Per-segment original drums and bass OGG SHA-256 evidence is in the report.
- 28 overlapping 18-second windows every 6 seconds, truncated only near the 174.6s ending. Regions are **correlated**, not independent observations.
- 10ms envelope sample grid. A three-point parabolic autocorrelation peak interpolator estimates *fractional-bin rhythmic periods* and reduces obvious period-bin quantization, but it cannot conjure genuine sub-10ms source transient information. Analysis is not an approved time-frequency method and does not claim verified tempo precision.
- Tested possible quarter-like intervals 32–46 analysis ticks (~130–188 BPM); retained half-time (64–92 ticks) and double-time (16–23 ticks) competing periodicity peaks. These are structural hypotheses, *not evidence that the recording's musical meter or quarter note is within the selected range*.
- Source-based cross-correlation allows ±450 ms drum/bass onset phase differences. Their peak may be a shifted bass attack, snare backbeat, rhythmic swing, half-pulse syncopation, section transitions, or separation artifacts, **not a tempo correction or musical bar one**. The sequence comparison also evaluates diagnostic global ±quarter- and ±half-pulse displacement.

## Direct findings, algorithmic candidates only

- **Drum periodicity:** all **28/28** 18-second windows select the same *coarse* original rhythm repetition bin at 37 ticks (~162.53 BPM before interpolation). The fractional-bin interpolants range **163.110–164.162 BPM**, median **163.584 BPM**, in this detector. These readings may reflect repeated drum loop structure or limitations of this estimator; they do not verify exact tempo or lack of drift.
- **Bass periodicity:** wider and structurally ambiguous; **15/28** windows have the same coarse quarter-like lag bin as drums and **22/28** are within one 10ms bin. Some bass windows have strong conflicting longer-period preferences (notably **78–96s** and **84–102s** with ~134 and ~131 BPM candidate lags, respectively). These do not establish a real change to 130 BPM.
- **Cross-stem onset offset:** 15 of 28 local comparisons favor drums about **40–50ms earlier** than the bass, while a few windows favor larger ~190–200ms offsets. These suggest consistent instrumental timing or subdivisions can explain some disagreement, but exact instrumentation/beat labels are **not** verified.
- **Rival beat-track phase:** the previously computed drum/bass dynamic paths agree within ±40ms for just **20.807%** of drum beats at zero shift. If we artificially offset the bass track by ±**0.1875 s** (approximately half of a 160-BPM quarter-note), agreement increases to **38.217–38.429%**, still low and **not proof** of a half-beat syncopation or the real beat phase. The shift asymmetry, different local tempo hypotheses and tracker overfitting make these comparisons suggestive only.

**Interpretation:** A regularly repeated drum pattern around the 160–164 BPM family is plausible. That does not automatically imply the source audio is tempo-locked. Conversely the bass disagreement can arise from syncopation, a chord change, phase slips, source-separation artifacts or mixed tempo. A single 160 BPM prompt is not source timing evidence. The entire report remains **UNVERIFIED**.

## Algorithmic QA and gating

A standalone new offline script and **10 new synthetic/safety tests** check: silent/constant source fail-closed; stable 154, 160 and 166 BPM synthetic periodicities; known linear tempo ramp sensitivity; missing/invalid inputs; positive/negative cross-stem offset sign; half-time accent not automatic 80 BPM; synthetic half-pulse beat-path offset recovery (without assigning real beat one); exact original source evidence contract and no approved bar or gameplay fields. These tests prove the detector's *software contracts*, not authenticity of a real beat grid.

The existing 10 variable-tempo Python tests, five initial Python source tests and five Node tests also pass. Original OGGs remain read-only in a pre-existing full checkout; the working tree is sparse and includes no original OGG copies.

**No safe promotion** to any published source-aligned meter grid, `RELEASE_BEAT_GRIDS`, `AudioSynth`, synthetic meter timing, World Dance, Gym, collisions, physics or scorekeeping. Need comparisons against genuinely distinct rhythm extraction (e.g. spectral onset/continuous original mix) and then selective human musician audition of high-quality consensus passages with explicit bridge boundary and downbeat/phrase uncertainty.

Source-bound output: `docs/music-review/one-more-run-rhythm-periodicity-crosscheck-UNVERIFIED-20261121.json`, SHA-256 `c6609aa15bc24ae0eacbd132c079e02775567cd98a830f9739383d3e0cd24665`.

**Provenance:** Marvin asked Music Friday to take #53 back from CC and move ahead independently; his suspicion of unstabilized Suno/Kie tempo is a motivation, **not a verified source tempo measurement**. Every detection hypothesis, numerical value and scope restriction in this report is Music Friday's source research. CC Friday was explicitly relieved of #53 ownership on its GitHub conversation. PR #53 stays DRAFT until human approval and safe release checks.
