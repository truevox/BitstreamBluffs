# Bitstream Bluffs — V6 cross-band drum candidate audit (RESEARCH ONLY)

**November 17, 2026 — NOT approved for playback or source-score changes.** Following the V5 family-gating study, the offline V6 prototype adds a simple cross-band consistency veto to tentative drum onsets. At each V5 candidate attack timestamp, a 12ms pre/post measurement estimates newly rising bandpassed energy in kick (45–180 Hz), snare (350–3500 Hz), and hat (4400–7500 Hz) bands. Candidates whose own-family rise accounts for less than 10% of total measured rise are excluded. The same 10% gate for all three classes was fixed from synthetic development diagnostics before scoring separate random-seed validation. This is a *heuristic*, not a confidence probability or learned model.

**Research tools only:** `tools/music/audit_cross_band_v6.py`, `detector_candidate_v6.py`, `benchmark_cross_band_v6.py`, `test_detector_candidate_v6.py`. The code reads in-memory synthetic waveforms and produces independent JSON reports. None is imported by live game audio, `StemMusicDirector`, the frozen score exporter, or any playback module.

## Fixed-rule synthetic comparison

| 20ms macro-F1 across alternate-seed validation patterns | V5 (V4 snares, V2 kicks/hats) | V6 (V5 + cross-band gate) |
|---|---:|---:|
| Original 9 fixture families × 4 seeds | 0.6889 | **0.8903** |
| Echo-offset scenarios × 4 seeds | 0.6854 | **0.8939** |
| Quiet-ghost-offset scenarios × 4 seeds | 0.5049 | **0.7728** |

On the original nine scenarios, **false positives fell from 1,541 to 235**, while false negatives increased from 96 to 108. On the held-out echo-offset family, V6 had 52 false positives and 2 misses, versus V5's 299 false positives and no misses; on quiet-ghost-offset family V6 had 50 false positives and 100 misses versus V5's 448 false positives and 96 misses. The same 20ms and 50ms class-matched evaluations happen to produce equal results on these fixtures; this is not an assumption about real recordings.

Development (559103,71,337,1097) and separate validation (17,41,809,2027) use the **same synthetic generation algorithms** with different random seeds, so they are not independent song/source holdouts. V6 thresholds were fixed after inspecting synthetic development attack-energy distributions; any future tuning against the published validation set must use a new evaluation cohort. A strong result under these artificially well-separated frequency bands may **collapse under real source bleed**, broadband snares, kick harmonics, compression, reverberation, silent attacks, distortion, or other instruments occupying drum bands.

## Reproduction, provenance and safety

- The development diagnostic source is preserved at CT223 `/home/hermes/experiments/bitstream-crossband-v6-development-20261117.json`, SHA-256 `057bc37bb272a08bad63b24c0c5a9375489029154589f7fed2bd3284466d13fa`.
- The full 104-trial V5/V6 result is preserved at CT223 `/home/hermes/experiments/bitstream-crossband-v6-holdout-20261117.json`, SHA-256 `f9e606409feead5e0c4d47699766ace277b4d1783d802242aa7d4bcc2221de7e`.
- Reports include fixture audio SHA-256, seed, exact original/candidate source identity, time-tolerance metrics, per-case false-positive/false-negative counts and unapproved status. Neither report overwrites existing evidence.
- Sixteen combined V4/V5/V6 research tests pass, including silence, invalid configuration, finite near-boundary features, cross-class simultaneous hits, echo suppression and original-audio immutability.

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B -m unittest -v tools/music/test_detector_candidate_v6.py tools/music/test_benchmark_drum_family_gate_v5.py tools/music/test_audit_drum_errors_v1.py tools/music/test_detector_candidate_v4.py
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B tools/music/benchmark_cross_band_v6.py --out /tmp/v6-fresh-audit.json
```

## Decision and next gate

**V6 is NOT eligible for audio release, automatic score correction, substitution of the 33,752 frozen note guesses, or promotion to human gold.** No real-song precision, recall, sample timing, nor subjective musical accuracy has been established. The standalone sound-design lab remains sound-design-only. To progress, test V6 on source-stem excerpts with independently verified attacks and a separate *real* human-labeled gold set; explicitly probe kick/snare broadband overlap, simultaneous hits, and quiet ghost strikes. The in-game Music Lab and its source-pinned review passages remain the authoritative playback validator once real source labels exist. No controls/BSOD code, Settings, audio buses, saved data, original FLAC or released Ogg was modified.
