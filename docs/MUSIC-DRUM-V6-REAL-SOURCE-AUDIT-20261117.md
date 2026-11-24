# Bitstream Bluffs — V6 REAL source-FLAC differential audit

**November 2026 research session; not approved for music/audio promotion.**

Research-only tool: `tools/music/audit_real_drums_v6.py`. It connects **read-only** through the authorized Ursa Major Proxmox host to CT211, obtains full SHA-256 for each original launch33 drums FLAC, and checks it against the immutable song's `performance.json` source hash **before** decoding audio. Short mono 16kHz float PCM is streamed through stdout from remote FFmpeg directly into memory, never writing intermediary FLAC or PCM files to disk. Every reviewed window is pinned to its exact original source hash, decoded-PCM hash, original frozen score hash, 48kHz source start/end frame and class-specific 20/50ms one-to-one *agreement* counts.

The study covers **14 different real recording excerpts across all four released songs**: six source-hash-pinned drums passages from the existing machine-ranked in-game Music Lab `NEXT SUSPECT` queues, plus two independent fixed-time windows (14s and 75s) per song. It compares frozen V1 unreviewed source scores, V5 candidate onsets and V6 candidate onsets. **None is human gold**, so counts and one-to-one pairings are NOT precision, recall or proof of false hits.

## Observed on real source stems

| Events across the 14 real-song windows | Frozen V1 (unverified) | V5 tentative | V6 tentative |
|---|---:|---:|---:|
| Kick | 443 | 467 | 432 |
| Snare | 184 | 687 | 652 |
| Hat | 609 | 775 | 706 |
| **Total** | **1,236** | **1,929** | **1,790** |

The V6 10%-family-attack gate removed **139 of V5's 1,929 real-song proposals (7.2%)**, distributed as 35 kicks, 35 snares and 69 hats. In contrast, on the nine original **synthetic** scenario families with four alternate seeds, it reduced V5 synthetic false detections by 1,306. These figures aren't directly comparable: the real excerpts are different recordings with **no truth labels**, and synthetic results are generated from simplified, spectrally cleaner drum fixtures.

At **20ms** one-to-one exact-class onset agreement with the existing **unverified** V1 release score, V5 matched 81 kicks, 128 snares and 373 hats; V6 matched 74 kicks, 127 snares and 357 hats. Neither increased agreement nor decreased agreement proves a candidate is more accurate; the frozen V1 itself is known to be provisional.

**Engineering implication:** the synthetic cross-band energy veto does **not** carry its dramatic selectivity over to these real separated song windows. No evidence currently supports auto-promoting V6 to playable music. The frequent candidate snare-vs-release disagreements deserve source listening and independent labels, not automatic rejection.

## Reproducible audit evidence

- Immutable full report outside Git on CT223: `/home/hermes/experiments/bitstream-v6-real-flac-unlabeled-20261117.json`.
- SHA-256 of report: `92acb9f20948db5c40351a008e79050cfcb74bd05bbcf531769d3d071c3c71dc`.
- Four full source FLAC SHA-256 values were checked before any source window was decoded; all matched corresponding release-score fingerprints.
- Source paths and source hashes are recorded in the tool/report; source audio never entered Git, and no existing song, score or browser Music Lab code changed.
- Twenty combined research unit tests pass, including new fail-closed full-source hash validation, malformed PCM rejection, one-to-one exact-class reference alignment, and V6-as-subset-of-V5 invariant.
- Original review-queue windows remain at their *actual* source-local offsets; comparing an isolated 8s window to full-song score events has boundary/transient effects. No release accuracy can be inferred from an excerpt-start/end mismatch.

Reproduce the report from CT223 with authorized PVE+CT211 read access (output must be a **new filename**, because the audit refuses overwrite):

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B tools/music/audit_real_drums_v6.py --include-fixed-windows --out /tmp/bitstream-real-drums-new-audit.json
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tools/music uv run --no-project --with numpy --with scipy --with librosa python -B -m unittest -v tools/music/test_audit_real_drums_v6.py tools/music/test_detector_candidate_v6.py tools/music/test_benchmark_drum_family_gate_v5.py tools/music/test_audit_drum_errors_v1.py tools/music/test_detector_candidate_v4.py
```

**Release gate remains CLOSED:** V6 is *not* a replacement score or a sound renderer. Next meaningful step is a human-labeled, source-hash-pinned evaluation across kick/snare/hat attacks, source bleed and true quiet ghost notes, reviewed through the **actual in-game Music Lab** (the standalone lab remains SOUND DESIGN ONLY). Compare verified one-to-one 20/50ms gold precision/recall and listen for musical quality before any source-score changes. No Control Friday BSOD, wind, UI, save, gameplay or shared input files were modified by this audit.
