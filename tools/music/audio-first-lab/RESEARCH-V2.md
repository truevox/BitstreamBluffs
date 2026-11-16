# Bitstream Bluffs — additive source-first research (2026-11-16)

This folder contains a new **non-destructive** round of music research on
CT211. Marvin authorized four tasks while he cannot audition: improve
polyphonic note detection, improve percussion onset/class detection, audit
all 33 source tracks, and prepare a repeatable versioned research pipeline.

**Nothing here is an approved instrument, mix, release master or game edit.**
The original 231-clip private A/B lab at http://100.115.120.66:8185/
is UNCHANGED, including Pyramid Peak, both prior bass generations, guitar
instruments, old/new sampled drums, featured audio and both Candy leads.
Do not promote or remove auditions without direct owner approval.

## 1. Full 33-song source audit

New code: audit_stem_library.py. Run with the CT211 research environment:

    /root/bitstream-maxi/.venv/bin/python3 audit_stem_library.py \
      --root /root/bitstream-maxi/launch33 \
      --out /root/bitstream-maxi/research-audio-20261116-library-audit \
      --workers 6

- Inspected all **33** tracks and **198** six-family FLAC stems.
- All six expected stems present for each song, zero ffprobe/short-window
  decode errors, zero greater-than-100ms duration skews, zero within-song
  sample-rate disagreements.
- The supplied 11 original WAV tracks for **One More Run**, slot 33,
  are present alongside their 6 compatible grouped stems.
- The 2-second activity spot checks flag: piano low at 31 sampled locations,
  guitar 23, Other 12, bass 2 and vocals 1; drums have one near-full-scale
  sampled peak. This is NOT a full-song separation-quality diagnosis.
- JSON and human-readable Markdown reports are at
  /root/bitstream-maxi/research-audio-20261116-library-audit/{audit.json,README.md}
  on CT211, outside Git. Inputs were read only.

## 2. Alternative polyphonic transcription: Basic Pitch

New code: transcribe_polyphonic_v2.py.
Uses the CT211-local Basic Pitch ICASSP 2022 TFLite checkpoint,
from the existing .venv. Three **32-second** source excerpts tested:

| Track / featured stem | v1 FFT event count | v2 Basic Pitch count | Chroma proxy evidence |
|---|---:|---:|---|
| Every Hacker Part 2 / Guitar | 41 | 135 | mean cosine .7781 -> .8435; precision .8667 -> .7371; recall .2852 -> .3003 |
| One More Run / Piano | 122 | 299 | mean cosine .6419 -> .6463; precision .6925 -> .6556; recall .3042 -> .4422 |
| Pope Leo / Other | 54 | 151 | mean cosine .8714 -> .8615; precision .8039 -> .7413; recall .2128 -> .1749 |

The proxy is based on simultaneous pitch-class energy in the ORIGINAL
isolated stem. It is **not ground truth**: cannot verify octave, note attack,
wrong fundamental, correct voicing, or musicality, and harmonic bleed can
inflate numbers. In particular, the Other results are *mixed/worse*;
never automatically promote Basic Pitch by count. All earlier transcripts
and rendered audio are preserved in place.

Private v2 note JSON is under
/root/bitstream-maxi/research-audio-20261116-candidates/ on CT211.

## 3. Alternative percussion detector

New code: transcribe_drums_v2.py.
Uses fine-grained multi-band source onset energy and permits simultaneous
kick/snare/hat events, unlike the v1 single-label 65ms detector.

| Track | v1 onsets | v2 distinct onsets | v2 trigger events including co-hits |
|---|---:|---:|---:|
| Pope Leo | 157 | 215 | 272 |
| One More Run | 192 | 331 | 448 |
| Every Hacker Part 2 | 103 | 170 | 230 |

More detected events may mean better recovery of hats and overlapping
transients, **or** more false positives. This remains an unapproved score
candidate; percussion role and timing accuracy require listening.
Files: /root/bitstream-maxi/research-audio-20261116-candidates/*-drums-v2.json.
The prior sampled kits and sound files remain unchanged.

## 4. Versioned 33-track research pipeline

New code: pipeline_v2.py; uses source inventory and existing archive
ranking. Generates a deterministic planned job graph keyed by instrument,
chosen excerpt, input file path/size/mtime and new detector code hashes.
It refuses existing workspaces and output overwrites; --resume is allowed
only on an exact matching plan and it reuses valid existing event outputs.

**Plan-only by default** (does not transcribe audio):

    /root/bitstream-maxi/.venv/bin/python3 pipeline_v2.py \
      --root /root/bitstream-maxi/launch33 \
      --out /root/bitstream-maxi/research-pipeline-v2-plan-20261116 \
      --slots all

Plan: **33 songs, 132 task entries** = 66 executable note/drum
research tasks + 66 owner-gated future render/game tasks.
The featured-family selector provisionally chooses 30 Other, 2 Guitar,
1 Piano across this particular archive; because Other is a catchall stem,
**these are not approved final arrangement decisions**.
One More Run is recognized as the special 11-to-6 grouped source.

To run source-derived event extraction for one example only, use an
unused private --out path and explicit --execute --slots 3.
Reuse the same path with --resume; don't recreate or overwrite old audio.
Smoke tested slot 03: initial execution succeeded, and rerun produced
two cache hits. The pipeline currently handles technical research
transcripts, **not** full-song 33x12 rendering or deployment. The later
render-and-release tasks are explicitly blocked pending owner decisions.

## Technical checks and restrictions

- test_research_v2.py exercises silent drum sources, synthetic transient
  timing, local waveform metadata, planning determinism and no-missing-input
  guards. Do not promote with a failing test.
- Research jobs on CT211 are outside the release repository. Commit only
  new source .py, tests and documentation.
- The source inventory's metadata/code-hash fingerprint is NOT a full
  cryptographic content hash of all FLAC masters; upstream changes that
  preserve size/mtime need a separate strong check before final renders.
- No claim of source separation purity, musical correctness, copyright
  clearance, final mastering, approved timbres or BSOD chase integration.
- Do not touch the excellent previously approved Pyramid Peak lead.
- Do not replace, rename, prune or silently change any previous listening
  choice. Keep private music and models outside public game distribution.

## Next technical gates before wider rendering

1. Validate candidate guitar/piano/Other notes against scored known-note
   references or manually corrected note passages (chroma proxies are not
   proof of correctness).
2. Check percussion v2 for false triggering, rolls, simultaneous attacks,
   and source timing, not just onset counts.
3. A/B promising v2 candidate audio with previous versions **additively**
   before allowing full-song expansion.
4. Strengthen content-addressed archive fingerprints and per-stage QA for
   full-length jobs, then select owner-approved timbres and biomes.
