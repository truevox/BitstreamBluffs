# Bitstream Bluffs — V5 classwise drum gating research (UNAPPROVED)

**2026-11-17; detached offline research only.** Following the instrument-family false-positive audit, this experiment selects one of the existing V2 ratio-guard or V4 attack-texture predictions *per drum family*. It does not change either detector, create new songs, modify any V2 score, or touch game controls, BSOD, audio buses or Settings. This is a selection among **unverified synthetic heuristics**, never an approved rendered track.

## Fixed family recipes and evaluation

`tools/music/benchmark_drum_family_gate_v5.py` compares six fixed recipes: pure V2, pure V4, V4 snare only, V4 kick+snare, V4 snare+hat and V4 kick only. For every selected recipe, results are scored with the same strict one-to-one class-and-onset matching at 20ms and 50ms. The experiment reuses 13 synthetic patterns, then evaluates **four development seeds (559103, 71, 337, 1097) and four separate alternate validation seeds (17, 41, 809, 2027)**, for 104 measured fixture trials. Reusing the *same* synthetic generators across these seeds is NOT independent real-song holdout evidence.

| Alternate-seed validation macro-F1 (20ms) | V2 all | V4 all | V4 snare only | V4 kick + snare |
|---|---:|---:|---:|---:|
| Original nine fixture patterns | 0.6234 | 0.6430 | **0.6889** | 0.6785 |
| Echo-offset patterns | **0.6949** | 0.6343 | 0.6854 | 0.6504 |
| Quiet ghost-offset patterns | 0.3799 | 0.5287 | 0.5049 | **0.6084** |

In the nine original patterns across these validation seeds, the V4-snare-only selector has **1,541 false positives and 96 missed events**, versus 1,517 false positives and 343 misses for pure V2. Snare-only is a promising synthetic compromise but still has substantial false-positive risk and misses some true hits. V4 on both kick and snare recovers more quiet synthetic ghosts but generates 1,980 false positives on the same nine-pattern cohort. No one recipe wins every cohort, and V2 remains strongest in the echo-offset family.

## Evidence, reproduction and release decision

The full immutable trial evidence lives outside Git at CT223 `/home/hermes/experiments/bitstream-v5-family-gate-20261117.json` (SHA-256 `b89c38c75f17bb5bf0ac7b61c5065f4a3e54d1ae531dc94ebe92e7c4dba9e7ac`). It identifies the exact V2/V4 detector source hashes, recipe choice, each audio input SHA-256, both tolerance scores and every synthetic seed. The runner refuses to overwrite prior reports. Four new unit tests validate selector isolation, invalid role rejection, exact three-family recipes, 20/50ms result formation and audio-source immutability; all twelve combined V4/audit/V5 research tests pass.

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B -m unittest -v tools/music/test_benchmark_drum_family_gate_v5.py tools/music/test_audit_drum_errors_v1.py tools/music/test_detector_candidate_v4.py
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B tools/music/benchmark_drum_family_gate_v5.py --out /tmp/drum-family-new-report.json
```

**Do NOT promote a V5 selector to playback, performance score, source gold labels or automatic music replacement.** There is no human-approved real-song accuracy evaluation or sound approval. Further work should challenge the phantom hat/kick cross-band proposals on source stems and measure true quiet-ghost-versus-echo discrimination on human-annotated passages in the *actual* in-game Music Lab. Keep standalone sound-design auditions separate. The other developer's controls/BSOD work proceeds independently; no shared interfaces were changed here.
