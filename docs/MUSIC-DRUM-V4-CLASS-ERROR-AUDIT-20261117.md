# Bitstream Bluffs — V4 drum-class error audit (SYNTHETIC RESEARCH ONLY)

**November 17, 2026. No human-verified real-song accuracy; no released audio changes.** This follow-up breaks down the existing 52 synthetic V2/V4 trials by kick, snare and hi-hat rather than reporting only mean F1. New source: `tools/music/audit_drum_errors_v1.py` with tests in `tools/music/test_audit_drum_errors_v1.py`. It uses the project's established **one-to-one class-specific 20/50ms matcher**. Every case contains exact false-positive and missed-onset sample frames, cohort, seed and audio hash. It also counts suppression proposals near and far from *synthetic* known hits; proximity is explicitly **not** interpreted as proven causal correctness.

## Key diagnosis

| Original nine scenarios × four fixed seeds, 20ms micro-F1 | V2 ratio | V4 texture |
|---|---:|---:|
| Kick | **0.5429** (618 false hits) | 0.4971 (1,052 false hits) |
| Snare | 0.6955 (320 false hits) | **0.8362** (348 false hits) |
| Hat | **0.7934** (550 false hits) | 0.6853 (970 false hits) |

- V4 recovers quiet snare re-strikes in these fixtures, but also accepts far too many non-snares as hats and kicks. Its kick/hat class precision is below V2; retaining all no-echo-guard proposals cannot be the final approach.
- In *withheld-offset echo* fixtures, V4 loses to V2 in **all three** families (20ms micro-F1 kick 0.5036 vs 0.6136, snare 0.7810 vs 0.8506, hat 0.7442 vs 0.8109).
- In *withheld-offset ghost* fixtures, V4 improves snare (0.8065 vs 0.5051) and kick (0.6368 vs 0.4444), but outputs 389 **false hats** where zero hats were generated (V2 196). This matters: a better mean-F1 can conceal a musically objectionable extra drum class.

## Reproduction and immutable evidence

The full 52-case JSON report is outside the public game repository on CT223 at `/home/hermes/experiments/bitstream-drum-v4-error-audit-20261117.json`, SHA-256 `dd4f75291444b89a26587e32099b99f0136b1dc60e228ed36cadf03e98f1a60b`. The script refuses to overwrite reports and includes source hashes for each detector. Unit probes test one-to-one matching, exact class/time tolerance, suppression proximity semantics, and immutability of source audio. All eight V4 plus audit research tests passed together.

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B -m unittest -v tools/music/test_audit_drum_errors_v1.py tools/music/test_detector_candidate_v4.py
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B tools/music/audit_drum_errors_v1.py --out /tmp/drum-error-audit-new.json
```

## Engineering decision

**Still block V4 promotion.** Prior macro-F1 (0.6468) was a broad average of synthetic scenarios, not reliable evidence of per-family audio improvements. A future trial should (1) track cross-band false triggers independently, (2) preserve quiet true re-strikes, (3) suppress echoes per class, and (4) require real source human labeling plus actual-game WebAudio validation before changing performance scores. The source FLAC, frozen note scores, 4,745 Ogg clips and gameplay Settings/Music Lab remain unchanged. The controls/BSOD developer can work independently; this audit alters only offline music research.
