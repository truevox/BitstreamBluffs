# *One More Run* — original full-mix MP3 versus shipped separated-stem rhythm

**Music Friday · 2026-11-21 EST · [DRAFT PR #53](https://github.com/truevox/BitstreamBluffs/pull/53) · UNVERIFIED source quarter notes, downbeats, drift and bridge.**

## Important provenance discovery

The protected older original-music audition worktree `/home/hermes/worktrees/bitstream-adaptive-music-20261115` contains a file named `public/music-transcription-audition/one-more-run-original.mp3`. This source was **already preserved by prior music work**, not newly downloaded. It is a **lossy MP3** with explicit metadata title *One More Run (The Ballad of Bitstream Bluffs)*, artist `truevox`, **174.624s** ffprobe duration, and exact SHA-256:

`931402316385f7a1afd302d59132b812f0ae6a312b46b8cd85826c0a63906a8e`

The originally recorded **lossless WAV master** was separately referenced by a *previous November 18* original-mix report at `/root/bitstream-maxi/launch33/audio/33_one_more_run.wav` on CT211, previously reported SHA-256 `636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721`. **We have not independently reread that WAV in this pass**; none of the new MP3 results should be represented as verified PCM master measurements. The MP3 was analyzed in place, with its exact SHA checked before every decoding pass. No original audio was copied, recompressed, resampled into persistent audio files, or modified.

## Identity check against actual game music, not just a matching title

Using unmodified original 15-segment six-stem OGGs from the existing full-source Bitstream Bluffs worktree, the first, middle and final source excerpts were summed from all **six original stem roles** (drums, bass, piano, guitar, other, vocals), after checking source SHA fingerprints from archived evidence. At 11,025Hz mono *analysis decoding only*, full-mix MP3 PCM was cross-correlated against reconstructed OGG PCM over a ±100ms lag search.

| Original song excerpt | Best PCM correlation lag | Normalized waveform correlation |
|---|---:|---:|
| 0–12s | **0 samples** | **0.92001** |
| 84–96s | **0 samples** | **0.70253** |
| 168–174.6s | **0 samples** | **0.85720** |

These are strong evidence this MP3 corresponds to the **same recording/timeline**, not a random similarly named song. It does not prove that a lossy MP3 is *bit-identical* to the WAV original, nor that grouped separated stems reconstruct an exact master mix; Demucs bleed, gain, source OGG encoding, stereo-to-mono choices and MP3 psychoacoustic coding explain imperfect waveform correlation. The script **fails closed** if source fingerprints change, the MP3 SHA/title/duration disagree, or the opening/middle/ending correlations/lag exceed hard-coded conservative guards.

## Alternate source timing evidence: unseparated full mix

The new source script analyzes the original MP3 **as an actual unseparated audio mixture**, using high-band (230–4,700 Hz) log spectral onset flux. Then it independently computes source-drum stem rhythmic periodicity over the same 28 overlapping 18s windows (6s hop). These are different representations of the **same performance**, not independent recordings.

| Metric | Full original MP3 mix | Original separated drums |
|---|---:|---:|
| Median rhythmic-period candidate | **163.8092 BPM** | **163.7632 BPM** |
| Preferred window estimates | **163.1779–164.2225 BPM** | **163.3705–164.1174 BPM** |
| Whole-song preferred frequency | **163.85 BPM** | **163.80 BPM** from prior separate-stem global scan |
| Whole-song relative phase concentration | **0.105246** | **0.240907** from prior separate-stem global scan |

**Every one of 28 original-mix windows differs from the separately computed drum-stem periodicity by under 0.5 BPM** (largest absolute difference about **0.3112 BPM**). This is much stronger support for a prominent repeating rhythm near 164 BPM than the early low-band isolated bass outliers. However, the mix's whole-song *phase concentration* is low (~0.105), and an onset-frequency estimate is **not an actual marked quarter-note onset, meter or bar one**.

Original full-mix source and original drums are both coherent enough for an uncalibrated relative phase comparison in **16/28** overlapping windows. Their relative rhythmic-phase candidate offsets range from approximately −0.039 to +0.122 candidate beats at those selected windows. **This is not ground-truth phase agreement or proof of a steady beat throughout the recording**: they derive from the same actual mix, the relative timbral weighting differs, and weak intervening windows are deliberately left unclassified.

The previously preserved **original WAV full-mix** analysis from November 18 separately listed a roughly **163.839 BPM** periodic candidate, *among multiple stronger competing frequency peaks* (e.g., around 123 and 205 BPM). That earlier result is context, not independent verification of the current MP3 or actual tempo/meter. The current method's 140–180 BPM prior can also miss genuine slower musical feel.

## Regression and safeguards

- **Seven new Python tests** cover identical/misaligned synthetic waveform correlation, rejection of silent source evidence, rejection of altered MP3 fingerprint before decode, synthetic high-band 164 BPM periodicity, known-phase identical onset streams, and explicit source-integrity and unverified-result constraints.
- The previous **58 research tests** and full original OGG browser/audio-tamper smoke remain applicable; this increases the suite to **65 automated checks**, subject to a fresh full run.
- The original MP3 file was **not copied into the game repo, build, Netlify preview, or listening lab**; it stays safely in the older existing worktree. The new report stores source identity, checksums, summary analysis and derived data only.
- Nothing in this result proves the Suno/Kie source definitely holds a fixed BPM or definitely drifts. A near-164 BPM rhythmic repetition is **strongly corroborated**, not an approved precise beat grid. Missing original-source harmonic phrase boundaries and human beat-one certification remain critical.

### Reproduction

From a Git checkout with the research scripts, FFmpeg/FFprobe, NumPy/SciPy and access to the already-existing original source media:

```sh
uv run --offline --no-project --with numpy --with scipy python -B tools/music/test_research_original_mix_phase.py
uv run --offline --no-project --with numpy --with scipy python -B tools/music/research_original_mix_phase.py \
  --source-pack /existing/original/33_local-one-more-run-bitstream-bluffs \
  --prior-report docs/music-review/one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json \
  --harmonic-report docs/music-review/one-more-run-harmonic-bar-cues-UNVERIFIED-20261120.json \
  --global-report docs/music-review/one-more-run-global-pulse-coherence-UNVERIFIED-20261121.json \
  --original-mix-mp3 /existing/source/one-more-run-original.mp3 \
  --out /tmp/one-more-run-original-mp3-mix-phase-UNVERIFIED.json
```

Exact source-derived JSON: `docs/music-review/one-more-run-original-mp3-mix-phase-UNVERIFIED-20261121.json`, SHA-256 `2a61b050c639e975edab27a06075ec664ce3363d1d0d821797519b94330d8622`.

**Open gate:** Need reliable *absolute beat-onset tracking* and musical phrase/downbeat analysis, ideally using the separately archived original WAV with verification of its master SHA-256 and actual source offset, then a short, targeted listening review. Production `RELEASE_BEAT_GRIDS`, source OGGs/MP3, World Dance, Gym, physics, scoring, and the synthetic decorative click grid remain untouched. Marvin's mention of possible unstabilized Suno/Kie source tempo is a hypothesis, **not** an approval or direct musical measurement.
