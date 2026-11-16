# Bitstream Bluffs — controlled V3 audio research (2026-11-16)

## Owner directive and boundaries

Marvin explicitly approved all five follow-ups: (1) known-note benchmarks,
(2) cross-stem/instrument coverage diagnostics, (3) drum classifier,
(4) expressive performance metadata, (5) rendering integrity QA.
He also warned that Guitar and Piano, not just Other, may catch instruments
unrelated to their nominal names. This is **Marvin's hypothesis**.
The following measurements are **Gal Friday tool-grounded research**, NOT
Marvin's creative endorsement.

**Immutable:** the pre-existing 231 Ogg auditions and their selectors,
the approved Pyramid Peak lead, both bass generations, all guitars,
Candy variants, original masters, game and BSOD chase.
No music, checkpoint, or proprietary stem entered public Git.

## 1. Scored ground-truth transcription

benchmark_notes_ground_truth.py generated twelve original, synthetic
16-second SoundFont recordings from known MIDI notes. Two instrument
patches per family, melody and chord patterns. Matching requires
the correct MIDI pitch and note onset within 125ms.

| Family | FFT decoder v1 F1 | Basic Pitch v2 F1 |
| --- | ---: | ---: |
| Guitar | .6186 | **.7208** |
| Piano | .5770 | **.9616** |
| Other (synth and pad) | .5951 | **.8954** |

These are MEANS across the test cases, not real music accuracies.
Synthetic rendering distribution is unlike source separation with
multiple instruments, effects, bleed and vocals. Earlier source
chroma-proxy scores were worse/mixed for Pope's real Other stem.
No algorithm automatically won promotion by generating more notes.

Private source/truth/predictions/scores on CT211:
 /root/bitstream-maxi/research-audio-20261116-groundtruth-v3/

## 2. Profile every stem — all types can be mixtures

profile_stem_semantics.py examined 209 files: 33 x 6 grouped stems and
eleven original One More Run WAV stems. It measured three independent
3-second excerpts per file: spectral centroid, band power, pitch
concentration, transient density, dynamic level, and pairwise
signature similarity. These are SCREENING features, not absolute
contamination or pure instrument identification.

Average activity across the 33 songs, same thresholding rule:
Other **40.593%**, Guitar **16.767%**, Piano **2.863%**.
Most-active winner by song: Other 30, Guitar 2, Piano 1.
The stem types are active simultaneously, not exclusive.
One More Run: Piano 55.587%, Guitar 54.728%, Other 50.430%.
Its known 11-to-6 grouping maps the keyboard WAV into Piano, while
synth, strings, woodwinds, and FX are explicitly grouped into Other.

**Actual six-stem label-confusion probe:** We synthesized eleven known
instrument performances one at a time and ran the real htdemucs_6s
through a 35.2s test WAV. Approximate destination energy fractions:

| True isolated GM instrument | Demucs six-stem output |
| --- | --- |
| Nylon guitar | Guitar ~100% |
| **Acoustic piano** | **Guitar 58.10%; Piano 41.73%** |
| **Orchestral strings** | **Guitar 57.80%; Other 39.63%** |
| **Orchestral harp** | **Guitar 99.86%** |
| Square synth | Other ~100% |
| Church organ | Other ~100% |
| Vibraphone | Other ~100% |
| Trumpet | Other 99.97% |
| Choir Aahs | Vocals ~100% |
| Picked bass | Bass ~100% |
| Sampled kick/snare/hats | Drums ~100% |

**What this establishes:** Guitar can receive piano, strings and harp
even with known isolated synthetic sound. A Demucs stem name is a
routing bucket, not a reliable instrument taxonomy. The test supports
Marvin's hypothesis but does NOT prove these same specific sources
are in particular original song stems. Isolated GM timbres differ from
the arrangement of a commercial-style mix.

Research outputs on CT211:
 /root/bitstream-maxi/research-audio-20261116-semantic-profile.json
 /root/bitstream-maxi/research-six-stem-bucket-test-20261116/
 (sources.json, known-instrument-probe.wav, separated WAVs,
 bucket-results.json).

The installed Demucs CPU runner separated the test but failed saving
WAV without TorchCodec. A research-only runner replaces the save
backend with SoundFile, without modifying installed Demucs packages
or any production audio workflow. No new external models installed.

## 3. Known-label drum classifier calibration

calibrate_drum_classifier.py generated 288 labeled, isolated
GM drum recordings in six patches and three velocities across
kick, snare, hat, tom and cymbal classes. RandomForest classifier
was evaluated with each drum-kit patch entirely withheld in turn.

- Held-out patch-grouped accuracy: **0.8021**.
- Held-out macro F1 across five classes: **0.7952**.
- Per-kit macro F1: approximately 0.39 for patches 25 and 48
  versus up to 1.00 on some other kits. Domain generalization is weak.
- This is NOT a validated replacement for the existing drum detector,
  and overlapping hits, rolls, drum-source leakage remain to be tested.

Private trained model and validation manifest on CT211:
 /root/bitstream-maxi/research-drum-classifier-20261116/
Never commit model weights to Git or audition site.

## 4. Instrument expressiveness

extract_expression_v3.py generated non-overwriting enriched note JSONs
for three actual source excerpts: Guitar 135, Piano 299, Other 151
events. Each estimates attack strength, relative velocity (45–120),
sustain/attack character, repeated-note arrivals, and overlapping
note-on events. This is an instrument-agnostic *hint* from a
potentially mixed stem, NOT isolated MIDI note dynamics.

Polyphonic pitch bends and vibrato were intentionally left
UNESTIMATED because source harmonics cannot reliably be assigned
to one simultaneous note. Wrong musical expression is worse than
an explicitly incomplete candidate.

Private on CT211:
 /root/bitstream-maxi/research-expression-v3-20261116/

## 5. Integrity and regression gate

verify_audio_integrity.py calculates full-file SHA256 and probes
metadata plus 1.5s of decoded audio. The source archive inspection
covered **209/209** FLAC/WAV files with zero checksum/probe flags;
all six 11-to-6 grouped One More Run sources also matched their
pre-existing expected SHA256s.

Every one of the **231 Ogg auditions** was SHA256-checked, with
**six decoded-window float peaks above 1.001**, 1.0067–1.0490:
five old Every Hacker effects-only drum versions (Pyramid Peak,
Sky Jellyfish, Steampunk, Underwater, Vertigo) and one sampled
Space Mountain drum. Lossy codec sample overshoot does not
necessarily prove clipped source audio; preserve old clips and
flag these for future safe peak handling.

A second independent 231-clip SHA/metadata snapshot, evaluated by
compare_integrity_manifests.py, found **zero missing, zero changed,
zero duration regressions, zero loudness shifts beyond 3dB**.
Six peak warnings persisted; none were silently modified.
Sample RMS is NOT integrated LUFS and cannot serve as mastering.

Private integrity manifests: CT211
 /root/bitstream-maxi/research-integrity-sources-20261116.json
and CT223
 /home/hermes/experiments/bitstream-audio-first-4x12-20261116/
 files integrity-preview-20261116.json,
 integrity-preview-repeat-20261116.json and
 integrity-regression-20261116.json.

**Ten deterministic unit tests pass** in test_research_v2.py and
test_research_v3.py across silent inputs, synthetic note matching,
candidate expression, checksum mismatches, audio probing and guardrails.

## Future-safe decisions

- Develop **multi-label instrument identification across all three
  non-drum accompaniment buckets**, not Guitar/Piano/Other by name.
- Test realistic polyphonic dense mixes with known instrument sources.
- Validate note and drum extraction on manually scored real passages.
- Avoid deploying the weakly-generalizing 5-class drum classifier.
- Treat expression as optional research data, not approved performances.
- Add proper LUFS/gain analysis and safe peak-limited *additional*
  versions if required; never overwrite existing auditions.
- Only after owner listening approval, consider rendering a full
  33-song by 12-biome bank and gameplay audio integration.
