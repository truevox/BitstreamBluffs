# One More Run — continuous variable-tempo prototype and negative-control audit

**2026-11-21 · INDEPENDENT RESEARCH ONLY · NO VERIFIED SOURCE BEATS · NO RELEASE CHANGES**

Music Friday prepared this as a separate, non-shipping CC Friday handoff. Marvin observed that his Suno/Kie outputs may not have been exported in any fixed-tempo mode; this is **Marvin's hypothesis**, not proof of drift. Do not conflate a generation prompt's **160 BPM** with the actual recording's pulse, time signature or measure-start timestamp.

## Source and method

- Operates on the unchanged **174.6-second**, **15-segment**, 48 kHz original OGG *One More Run* pack, with exactly the manifest hash `e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a` and per-segment SHA-256 checks on the original **drums** and **bass** stems.
- Full timeline is continuous, explicitly **without resetting beat phase at each 12-second segment split**. Each decoded source stem is resampled *in memory* to 11,025 Hz; low-band onset envelopes and segment-boundary masks are evaluated on approximately **10 ms** time intervals. No OGGs are copied, touched or re-encoded.
- A constrained Viterbi-style path tests a variable **quarter-note-like** pulse with permitted interbeat periods of 33–44 analysis ticks (a deliberately loose **136–182 BPM** analysis range), smooth per-beat period change, weak soft 160 BPM prior and nonzero onset evidence. This is a **candidate-finding assumption**, not a measured actual BPM range. It expressly does **not** test an 80 BPM true half-time musical meter.
- Compare against the same-stem **best static grid** over an independent 150–170 BPM/phase sweep. Score on the training stem and separately check against the other original separated stem. Repeat in reverse roles, change several penalties, and compare the two resulting beat paths. Training-test separation is imperfect because Demucs outputs may be correlated.
- Only unverified individual beat *candidates* are recorded, as 48 kHz source-frame coordinates **derived by quantizing ~10 ms analyses** (not sample-accurate transient labeling). No 4/4 beat-one, bar, meter, section, chorus or bridge labels are assigned.

## Directly measured algorithmic outcomes (NOT source truth)

| Comparison | Drums-trained / bass check | Bass-trained / drums check |
|---|---:|---:|
| Fitted fixed-grid tempo candidate | 163.75 BPM | 163.75 BPM |
| Fixed-grid training onset mean | 0.43181 | 0.30020 |
| Variable-grid training onset mean | 0.56898 | 0.40280 |
| Fixed-grid held-out onset mean | 0.23750 | 0.24139 |
| Variable-grid held-out onset mean | 0.23013 | 0.28185 |
| Variable minus fixed on held-out evidence | **−0.00737 (worse)** | **+0.04046 (better)** |

The two independently fitted candidate beat paths align within **40 ms at only 20.81%** of drum-proposed beats; median distance to nearest bass-proposed beat is **129.7 ms**. They cannot be treated as converged estimates of the same source pulse.

**Sensitivity checks:** Three levels of tracker smoothing/prior penalties give held-out *bass* differences of **−0.00239, −0.00737, −0.00065** (none beat the drum-trained constant-grid control). In reverse, held-out *drum* differences are **+0.04396, +0.04046, +0.00542** relative to a **bass-fitted** constant-grid control. Be careful: that fixed control is not the separate **drum-optimized** static grid, so the positive reverse comparison is **not** proof of drift or independently correct phase.

The changing-period path finds favorable local drum attacks and plausible candidate regional pulse rates (~160–164 BPM across many windows), but the **music-meter interpretation remains unsupported**. Stem accents, subdivisions, half-time feel, kicks displaced from strong beats, filtered note transients, source separation artifacts, and selection bias all compete with genuine drift as explanations.

### Decision / gates

**DO NOT PROMOTE THIS MAP TO PRODUCTION.** A flexible path's superior in-sample score is not a scientific detection of actual tempo drift; disagreement between drum-only and bass-only trackers is substantial. This is useful **negative evidence** that our current onset model is inadequate for trustworthy beat-one labeling.

The next autonomous research step is multi-resolution periodicity and harmonic phrase comparison around *continuous* candidate positions, with weak-region quality flags and no mandatory 160 BPM start assumption. CC Friday should compare genuinely distinct methods and seek a short amount of independent human spot-checking **only once** the models converge. The actual half-time bridge entrance/exit and any pickup still require external musical evidence.

**Release safeguards:** PR #53 and this child diagnostic must stay draft and isolated. Do not modify `RELEASE_BEAT_GRIDS`, `AudioSynth`, synthetic meter timing, Gym scoring, World Dance, physics, official saves, the original sound files or production soundtrack. Never label these observations human-approved.

### Reproduction

From a checkout with Python NumPy/SciPy + FFmpeg and access to an **existing, matching full-source OGG worktree**:

```sh
uv run --offline --no-project --with numpy --with scipy python -B tools/music/test_research_variable_tempo.py
uv run --offline --no-project --with numpy --with scipy python -B tools/music/research_variable_tempo.py \
  --source-pack /path/to/existing/original/33_local-one-more-run-bitstream-bluffs \
  --prior-report docs/music-review/one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json \
  --out /tmp/variable-tempo-UNVERIFIED.json
```

Experimental source-bound report:
`docs/music-review/one-more-run-variable-tempo-first-pass-UNVERIFIED-20261121.json`.

Owner attribution: Marvin raised possible absence of a steady-BPM render and possible drift. **All algorithm choices, scores, conclusions and safety recommendations here are Music Friday's analysis, not Marvin's claims or approvals.**
