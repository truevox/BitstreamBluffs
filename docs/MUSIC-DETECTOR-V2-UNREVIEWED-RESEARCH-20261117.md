# Bitstream Bluffs — Detector V2 research and in-game score comparison

**November 17, 2026 — EXPERIMENTAL ONLY. No new playable audio, no verified musical accuracy, no owner listening approval.**

Marvin's explicit lab boundary remains in force: the older standalone lab is SOUND-DESIGN-ONLY, never evidence of transcription, note alignment or sample-exact release integration. These tests use actual release source-stem excerpts and the actual game Music Lab for score inspection. Neither current nor V2 note-event guesses are ground truth.

## Experimental methods

- Accompaniment: source-derived 10ms spectral novelty with 2ms waveform RMS attack refinement, >=80ms attack separation, and 128ms physical note-analysis windows using harmonic-support estimates and interpolated FFT bins. Zero padding is not improved physical frequency resolution. Still confuses overtone leakage, strums and reverb.
- Bass: preserves existing release YIN pitch path, adds repeated same-pitch attacks only to long spans with several independently detected, approximately periodic re-strikes. Irregular real reattacks may still be missed.
- Drums: separate kick, snare and hat onset streams permit overlapping hits. An amplitude-ratio echo guard may erase true quiet ghost notes. A separate waveform-correlation gate recovered many quiet strikes but produced excessive false triggers. **Neither is ready for release**.
- Melody: fully unchanged from the released score. No new vocal model.

The EXACT detector source used to generate all four frozen V2 scores is preserved at tools/music/research/v2_ratio_release_snapshot/detector_candidate_v2.py with SHA-256 2d9ed6a002babd6fab028a47dff024be7e665a48ba5c561b0ded654de450d042. This agrees with the generator hash recorded in all four candidate scores. The working tools/music/detector_candidate_v2.py has evolved since this capture; a different code hash requires a new distinct score version. Never imply that later variants generated the original V2 scores.

## Measured synthetic results — not human musical gold

| Exact-note synthetic fixture | Released v1 F1 at 20ms | Experimental V2 F1 at 20ms |
|---|---:|---:|
| Low chromatic | 0.100 | 0.638 |
| Repeated eighth notes | 0.365 | 0.682 |
| Plucks with echoes | 0.093 | 0.644 |
| Two-note chords | 0.333 | 0.763 |

Bass repeated eighths at 50ms: 0.364 → 0.822. More irregular synthetic bass patterns improved, but there are no real-song labels.

Drums ratio-echo guard at 20ms: isolated hits 0.564 → 0.853; simultaneous hits 0.500 → 0.933; hat roll 0.663 → 0.952; echoed co-hits 0.316 → 0.933. **Adversarial fixtures FAIL**: on independently seeded quiet snare re-strikes 120ms apart, release v1 F1 0.705 versus V2 ratio 0.374 with candidate recall 0.52; quiet kick re-strikes 0.571 versus V2 ratio 0.400 with recall 0.50. A waveform-correlation variant increased recall but yielded many spurious hits, lowering precision. The first stress fixture erroneously reused identical random-noise attacks per note; that fixture was replaced with properly independent noisy strikes before these results were recorded. Treat quiet drum co-hits and ghost notes as release blockers.

## Actual-source, unlabeled comparisons

All four songs have immutable candidate score-v1 JSON sidecars with quality experimental-candidate-unreviewed, a distinct candidate score hash, a parentScoreHash of the released score, and the identical six original FLAC stem fingerprints and unchanged original melody. They are not playable stems. Original scores, raw FLAC and all 4,745 shipped Ogg files are unchanged.

| Song | Bass release → V2 | Drums release → V2 | Accompaniment release → V2 |
|---|---|---|---|
| Pope | 209 → 348 | 1743 → 2411 | Guitar 1216→1578; Piano 1256→2156; Other 2228→858 |
| One More Run | 301 → 459 | 1860 → 2776 | Guitar 2028→1158; Piano 2896→1469; Other 3548→1751 |
| Runs Out of Code | 202 → 275 | 1787 → 2575 | Guitar 2214→888; Piano 1716→2217; Other 1952→843 |
| Varmont | 143 → 220 | 1600 → 2424 | Guitar 834→1521; Piano 1664→2074; Other 2004→849 |

A 24-passage real-original-stem assay measured event densities (not F1). An all-four-song comparison of pitch/hit class and one-to-one timing within 50ms generated **473 weighted eight-second role disagreement passages** and a diversified top-20 shortlist. No accuracy is implied by disagreement. Highest-interest examples: One More Run piano 56–64s has release 266 events, V2 118, with only 65 matching; Varmont Other 136–144s has 326 vs 109, with 67 matching. These need human review, not an automatic selection of either score.

CT211 frozen outputs: /root/bitstream-maxi/detector-candidate-v2-20261117/candidate-all-four-v2; original source and models remain on CT211. CT223 read-only QA copy: /home/hermes/experiments/bitstream-candidate-v2-capture-20261117. The model-disagreement-review-queue-v1.json is a suspicion queue, NOT a human-verified gold set.

## The actual in-game Music Lab comparison

Settings → Manage Sound → Music Lab → NOTES (N) → V2 toggles a **diagnostic-only overlay**. CYAN represents released source-score candidates, PINK represents unreviewed V2 candidates, GREEN represents a human draft correction on the RELEASE score, and AMBER marks a selected release note. The game engine continues playing whatever original/replacement stems its existing configuration chooses; no V2 score event is playable and no V2 stem exists. V2 overlay events cannot be selected or edited as accepted truth.

Each real music pack may contain an optional experimentalPerformance descriptor (safe relative path, score hash and exact baseline parent hash), distinct from its production performance pointer and all audio source names. The in-game validator requires unreviewed candidate quality, exact song/sample/featured-role match, same six original source fingerprints, correct parent and unchanged released melody. Corrupted candidate or stale network response from song A cannot replace song B or interrupt normal audio; either failure leaves released score and playback usable.

The original 4,745 Ogg files were verified byte-for-byte unchanged by tools/music/validate_performance_release.py, including checking that all music-controlling pack fields remain identical to the previous published release. Renderer scripts require explicit --allow-unapproved-scores for an experimental private render; no release replacement was made.

## Release decision

**BLOCK candidate musical promotion.** Synthetic F1 and model disagreement are not real-song accuracy. In particular, drum quiet ghost hits, source bleed and echoed attacks need annotated real-source references. The review queue, manual-score patch workflow, and currently instrumented actual-game Music Lab provide a way to build this gold set when Marvin is ready. The legacy standalone lab remains sound design only, as directed.

Next: mark gold on several high-disagreement real passages, preserve human notes as separate source-hash-bound corrections, evaluate one-to-one at 20/50ms, and promote only individual high-confidence corrected roles/sections after actual-game audible review.
