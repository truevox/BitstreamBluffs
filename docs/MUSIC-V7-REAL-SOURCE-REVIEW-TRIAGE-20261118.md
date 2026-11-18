# Bitstream Bluffs — V7 real-source drum disagreement triage

**Research-only diagnostic, November 18, 2026.** V7 is NOT a new audio detector, playable performance, score patch or human-verified gold set. It provides concrete, source-hash-pinned *review priorities* from V5/V6 and the existing unverified V1 score; the legacy standalone lab is still SOUND DESIGN ONLY. The actual in-game Music Lab remains the appropriate future verification environment.

`tools/music/triage_real_drum_disagreements_v7.py` reads 14 real-source FLAC excerpts already used for the V6 descriptive audit (six drum passages in the actual-game `NEXT SUSPECT` queue plus two independent 8s windows per song). The tool verifies **all four full FLAC SHA-256s** against the frozen score source provenance before decoding; audio is streamed read-only via CT211/PVE FFmpeg. No media, score, queue, renderer or running game is written.

For each of **1,929** V5 candidate onsets, it records source-local 48kHz frame/time, drum family, V6 keep/reject and its own-frequency-band energy share, potential simultaneous cross-class onsets, potential short same-class re-strikes, and one-to-one matches to provisional release onsets at both ±20ms and ±50ms. Release-score *agreement* is a proxy for review priority, never confirmed truth, error, precision or recall. Candidates within 200ms of excerpt boundaries are excluded from the shortlist (but retained in complete evidence) to avoid overprioritizing decoder/detector edge artifacts.

## Machine-only review priorities

The deterministic review subset contains **32 specific onset hypotheses, eight per song**, diversified by disagreement type, family, source region and temporal spacing. No in-game UI changes have been made. These are event timestamps inside already existing source songs, and the previous six `NEXT SUSPECT` excerpts are unchanged.

| Song | Example event at source time | Machine question, not a factual error |
|---|---|---|
| Pope | Snare at **76.894s** | V6 rejected attack matching the provisional release onset; possible real strike or mislabeled V1 |
| Varmont | Hat at **172.434s** | V6 rejected release-concordant hi-hat hypothesis; needs acoustic judgment |
| Runs Out of Code | Hat at **19.870s** | V6 rejected release-concordant hat event; own-band attack nearly absent |
| One More Run | Hat at **76.316s** | V6 rejected release-concordant hat alongside other near-coincident proposals |

In the **full 14-excerpt evidence**, 24 rejected V6 events nevertheless match a provisional released note within 20ms; 1,232 V6-retained hits do *not* match the release within that tolerance. That is a model-disagreement inventory, NOT counts of true errors, true notes or hallucinations. The shortlist includes 13 of the former category and nine of the latter, with other overlapping/coincident or re-strike risk categories. Some events have more than one reason. Classes are hypotheses, not annotated acoustic truth.
## Reproducibility and safety gates

**Full private review evidence:** CT223 `/home/hermes/experiments/bitstream-v7-real-source-review-triage-20261118.json`, source/bundle status `machine-only-review-priority`, format `bitstream-real-drum-machine-review-triage-v7`. Contains all event annotations and the curated 32-event shortlist; SHA-256 `db4647b3839efc984b725d25d3c5de31024652c4431f1fd29629e1c806f81aa7`. A repeat independent remote FLAC run produced **byte-for-byte identical** JSON with the same SHA-256, and the first/second run preserved all source assets.

Twenty-five focused V4–V7 research tests pass, including five new one-to-one matching/source-score mismatch/triage/immutability/shortlist invariants. The code refuses output overwrite and fails closed on wrong source SHA, altered release score hash, incorrect review status, overlength source window, or unexpected V6 candidate identity. It never writes gold labels or passes research events to music rendering.

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B tools/music/triage_real_drum_disagreements_v7.py --out /tmp/music-v7-review-new.json
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B -m unittest -q tools/music/test_triage_real_drum_disagreements_v7.py tools/music/test_audit_real_drums_v6.py tools/music/test_detector_candidate_v6.py tools/music/test_benchmark_drum_family_gate_v5.py tools/music/test_audit_drum_errors_v1.py tools/music/test_detector_candidate_v4.py
```

**Next real validation gate:** independently label selected source attacks (kick, snare, hi-hat, co-hits, reverb/echoes and quiet re-strikes) with an actual human listening to the *real in-game* lab; only then evaluate class-specific one-to-one onset precision/recall at 20ms/50ms and potentially approve new instrument recordings. Do not interpret V7 as authorization to ask Marvin to listen now: no participation was requested or assumed.

**Parallel controls/BSOD work remains separate.** Music wind consumer `e97189a` is on feature branch `feature/music-bsod-audio-consumer-20261117`, reviewed against Controls Friday's `5846fe4`, not merged or deployed. This V7 research touches only `tools/music/` and documentation.
