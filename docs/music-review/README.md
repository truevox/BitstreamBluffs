# Gym beat evidence — *One More Run*, 2026-11-18

**No musical beat has been approved.** These are source-bound diagnostics and
human-review materials, NOT `bitstream-beat-grid-v1` release metadata. They
**do not modify the Gym or cause its READY period to wait for music**.

## Offline visual review

Open [`one-more-run-timestamped-onsets-20261118.html`](./one-more-run-timestamped-onsets-20261118.html)
in a browser. The HTML contains eight SVG comparisons from the source WAV
and separate original-game drums and bass OGG stems. Each window has three
onset-strength curves and **three different unverified rhythm hypotheses**:

- **Cyan**: ~80.75 BPM dynamic tracker, started at a prior of 80 BPM.
- **Gold**: ~161.50 BPM dynamic tracker, started at 160 BPM (the prior
  120 BPM run independently arrived at the same proposed timestamps).
- **Pink dashed**: ~163.839 BPM globally extrapolated original-WAV
  Fourier onset comb (an entirely different algorithmic method, not beat truth).

These ticks are intentionally not all lined up. The user should *not* infer
musical correctness from a pretty plot or a machine agreement percentage. The
only legitimate approval requires a listener to identify the perceived **regular
quarter-note pulse** (not bar-downbeat, offbeat, kick, or snare subdivision).

Original source identity: `/root/bitstream-maxi/launch33/audio/33_one_more_run.wav`
on CT211; SHA-256
`636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721`.
The source length is 174.6 seconds, stereo 48 kHz; the HTML has NO raw WAV,
Ogg, MP3 or other sound recording embedded. Listening requires access to the
original recording, not the plotted-onset view. The first and last panels are
chosen deliberately to expose long-term phase drift. All 15 original segments
remain marked **uncertain** in the blank review template.

The complete derived research JSON inputs are preserved in this Git branch
for clean-checkout repeatability; no source audio is included:
`one-more-run-machine-review-queue-UNVERIFIED-v1.json`,
`one-more-run-original-mix-onsets-UNVERIFIED-v1.json`, and
`one-more-run-dp-beats-UNVERIFIED-v1.json`.

The source was re-hashed on CT211 just before generating the visualization,
and its streamed downsampled PCM was checked against two previous
independent original-source experiment records. Re-running the generator
against the exact source and these committed JSON inputs produced an
identical 437,085-byte HTML file, SHA-256
`dad1c10ab97d4792cd4b8540947d7abb05f439799571abbf5bb00ef68ec7a957`.
The onset curves are independently normalized per window, so their heights
are **not** comparable loudness readings between sections.

Example read-only reproduction from an authorized machine with direct
CT211 access (unique output name required; the tool refuses overwrites):

```bash
set -o pipefail
ssh -F /dev/null -T root@ursa-major \
  'pct exec 211 -- ffmpeg -v error -nostdin \
  -i /root/bitstream-maxi/launch33/audio/33_one_more_run.wav \
  -ac 1 -ar 11025 -f f32le pipe:1' | \
  PYTHONDONTWRITEBYTECODE=1 uv run --no-project --with numpy --with scipy \
  python -B tools/music/build_gym_beat_visual_review.py \
  --manifest public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json \
  --queue docs/music-review/one-more-run-machine-review-queue-UNVERIFIED-v1.json \
  --multiprior docs/music-review/one-more-run-dp-beats-UNVERIFIED-v1.json \
  --original-mix docs/music-review/one-more-run-original-mix-onsets-UNVERIFIED-v1.json \
  --original-sha256 636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721 \
  --out /home/hermes/experiments/one-more-run-beat-visual-repro-UNVERIFIED.html
```

Verify the original CT211 WAV SHA-256 independently before streaming; the
script cross-checks the provided original hash against existing evidence and
separately hashes the streamed decoded PCM. It does not persist audio. The packaged file is generated
by `tools/music/build_gym_beat_visual_review.py`; it refuses to overwrite an
existing file and checks track ID, exact pack manifest SHA-256, source WAV
SHA-256, sample rate, duration, and every segment's original frame range.
Visual SHA-256 `dad1c10ab97d4792cd4b8540947d7abb05f439799571abbf5bb00ef68ec7a957`.

## Human review procedure — when listening is possible

1. Give **each of two independent reviewers** their own fresh copy of
   [`one-more-run-human-review-blank-v1.json`](./one-more-run-human-review-blank-v1.json).
   They should not copy answers from one another. Set each `reviewerId` to a
   distinct real reviewer identifier; do not reuse the blank template as
   a purported completed review. Both must use the exact source recording
   whose SHA is recorded in the template.
2. Each reviewer independently listens to the eight priority windows in
   [`MUSIC-GYM-ONE-MORE-RUN-CROSSCHECK-20261118.md`](../MUSIC-GYM-ONE-MORE-RUN-CROSSCHECK-20261118.md).
   Mark *every* pulse in the original song's 48 kHz integer source-frame
   coordinates, evaluate half/double time (approximately 81 vs 161 BPM),
   inspect fills and tempo transitions, and document the actual meter. Other
   sections **remain uncertain** unless independently reviewed. Set
   `status:'reviewed'`, `meter:'regular-quarter-note'`, `confidence>=0.90`
   and the full section `pulseFrames` *only* where justified.
3. After genuinely listening, the reviewer may replace `attestation:'PENDING'`
   with the exact listening-attestation sentence documented in
   `tools/music/compile_gym_quarter_note_reviews.py`. A string is not a
   cryptographic proof of real listening or identity; the release
   reviewer must separately check accountability and provenance.
4. Compare independently completed files with the **offline consensus tool**.
   It refuses source hash/manifest mismatches, missing identity or declared
   independent listening, duplicate reviewer IDs, unordered pulses, missing
   beat intervals, and incomplete source-section coverage. It requires both
   reviewers to mark the same number of events at corresponding positions
   within **45 milliseconds**. Where reviewers differ, the resulting section
   stays `uncertain`, with no candidate pulse frames.
5. The consensus tool's output format is **not** the game beat-grid format;
   a separate final authorized reviewer must explicitly approve metrical
   identity, source provenance, confidence and section boundaries before
   producing any real `bitstream-beat-grid-v1` asset. Do not infer approval
   from independent-algorithm agreement alone.

Example using two separately completed reviewer files (not yet available):

```bash
python3 -B tools/music/compile_gym_quarter_note_reviews.py \
  --mode compare \
  --manifest public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json \
  --queue docs/music-review/one-more-run-machine-review-queue-UNVERIFIED-v1.json \
  --review-a /path/to/independent-first-review.json \
  --review-b /path/to/independent-second-review.json \
  --out /home/hermes/experiments/one-more-run-human-consensus-UNVERIFIED.json
```

The published browser Gym timing API remains **fail-closed**, defaulting to
GO after READY for all four currently unverified soundtrack recordings.
Control Friday's validated integration is `integration/gym-verified-beats-20261118`
(`6f79349` cherry-pick, `3b11d1e` gameplay consumer); Music Friday's work
here changes neither that integration nor the music/audio engine.

## Tests and safety

- Python: `test_compile_gym_quarter_note_reviews.py` — independent review
  validation and **actual JavaScript runtime** rejection of a consensus
  candidate, even when two synthetic reviewers supposedly agree.
- Python: `test_build_gym_beat_visual_review.py` — source identity, source
  segment boundaries, no approved beats, and synthetic SVG content.
- Chromium: `smoke-gym-beat-visual-review.mjs` — eight accessible offline
  SVG panels, 24 waveform curves, no audio or network, and `canAuthorizeGame=false`.
- Release timing contract: `tests/src/music-gym-beat-timing.test.js`
  remains the source of truth for no music hold on any unverified song.

**Limitations:** The original PCM was downmixed and resampled to 11,025 Hz
for onset plotting; these curves cannot replace listening or qualified
beat/meter annotation. No human musical judgments have yet been made.
