# Bitstream Bluffs — V4 drum attack-texture research (UNAPPROVED)

**2026-11-17. Research-only, not an audio release, and no human music-gold claim.** This is a continuation of the V2/V3 percussion investigation. `tools/music/detector_candidate_v4.py` proposes suppressing echoes when a recent same-family attack has a highly similar band-limited waveform texture at a lower amplitude. A separately struck snare/hat normally has independent noise texture, even when quieter than a preceding hit. Tonal kick re-strikes can still correlate, so the kick comparison uses a higher-frequency attack band. The candidate is *not* calibrated as an echo probability.

The detector consumes experimental V2 onset proposals with its echo guard disabled; it **never replaces** V1 or V2 game scores, generates music, or changes a playable stem. It prefilters each family band once and uses bounded 170ms event history rather than scanning all earlier events. No user settings, source masters, performance score JSON, production renderer or public song packs were changed.

## Reproducible synthetic evaluation

`tools/music/benchmark_drums_v4.py` runs the prior nine fixture families plus four intentionally different conditions: a 95ms quiet snare ghost, 145ms quiet kick ghost, 110ms co-hit echo and 65ms snare echo. Four fixed random seeds (559103, 71, 337, 1097) give **52 synthetic audio trials**, always using independent random attack noise for true strikes. The evaluator compares exact class with one-to-one onset matching at **20ms**; it writes each audio SHA-256, model metrics and detector source hash. For fixture import in a standalone public checkout, it mocks only the unused private biome renderer's `BIOMES` attribute; the original `choose_drum_events` extraction function is still executed from its actual tracked source.

| Cohort (synthetic macro-F1) | Released V1 | Experimental V2 ratio | V2 no echo guard | V4 texture |
|---|---:|---:|---:|---:|
| Original 9 scenarios × 4 seeds | 0.5716 | 0.6273 | 0.5839 | **0.6468** |
| Withheld-offset echo scenarios × 4 seeds | 0.4182 | **0.6953** | 0.4305 | 0.6322 |
| Withheld-offset ghost scenarios × 4 seeds | **0.7060** | 0.3838 | 0.4942 | 0.5312 |

**Critical adverse result:** V4 helps the quiet ghosts but loses to V2 on the echo-only scenarios, including the 65ms snare echo. In the withheld-offset ghost cohort, even original released V1 scores higher than V4. Macro-F1 averages across very different synthetic scenarios are not musical sound quality and are not real-song accuracy estimates. This is **insufficient evidence to promote V4**. V3 remains rejected too.

## Engineering checks and reproduction

- Four `unittest` probes cover silence/tiny clips, non-mutating attack similarity, independent true ghost re-strikes and deterministic source-preserving outputs.
- Full 52-case evidence is kept outside the public repo at `/home/hermes/experiments/bitstream-drum-v4-multiseed-20261117-verified.json` on CT223 (report SHA-256 `c5b153474e79e473f71b50907d2ad02b5cd9ed01714ffd2a675db94ab53e6c5d`); it has exact per-fixture true-positive/false-positive/false-negative metrics and source fingerprints.
- From a checkout on CT223 with `uv` available, run:

```bash
PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -m unittest -v tools/music/test_detector_candidate_v4.py
PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python tools/music/benchmark_drums_v4.py --out /tmp/drum-v4-new-report.json
```

The benchmark rejects overwriting an existing evidence JSON. A new output filename avoids overwriting prior measurements. Tests are **synthetic and research-only**, not a listener-approved gold evaluation.

## Release and next investigation

**BLOCK V4 for audio playback, note-score export, automatic gold labeling and in-game music replacement.** The four released songs, current score hypotheses, V2 visual-only overlay and actual-game review queue remain unchanged. Marvin's standalone sound-design lab stays OUT of transcription validation.

Next: isolate real recording passages with original-stem provenance, collect a *human-labeled* set of true ghost notes, actual echoes, co-hits and bleed, and measure per-family 20/50ms precision, recall, tempo-dependent attack bias and false-event rates. The existing **actual-game** Music Lab's 20 source-pinned suspect regions are navigation hints, not gold. No listening is requested of Marvin now.
