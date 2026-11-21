# One More Run — harmonic cue cross-check and WebAudio audition QA (UNVERIFIED)

**2026-11-20 UTC · draft PR #53 / issue #50 · agent-authored research, not owner-approved timing.**

## Why this was needed

The first pass ranked four possible 4/4 downbeats from original separated
*drum and bass* rhythmic envelopes. These were repeated source accents, **not
verified meter positions**. Choosing those top candidates as bar starts would
silently ignore chord/phrase changes, bridge behavior and bass-syncopation.

A second, non-percussion research stream now examines the **original Demucs
separated guitar/piano/other OGG stems** over all 15 song segments. It uses
frequency-to-pitch-class (chroma) distributions and spectral-change novelty
across ~200ms neighborhoods. For each of the three candidate BPMs and four
candidate pulse phases, it compares the mean novelty on each proposed beat-one
vs other beats, preserves all four offsets, and lists prominent harmonic-change
timestamps for human listening. It does **not** transcribe actual chords.

**Not an independent ground truth:** the separated stems came from the same
original mix and inherit correlated Demucs artifacts. Harmonic novelty can
highlight guitar attacks, fills and masking rather than chord resets. The
comparison is conditioned on the drum/bass proposal's beat phases, which also
limits independence. Scores are normalized per source segment and are neither
probabilities nor musical reviewer approvals.

## Concrete cross-check

At **160 BPM only**, on the *first-ranked phase* in each of 15 original source
windows, the rank-one harmonic-change bar offset **agrees with the drum/bass
rank-one offset in 7/15 cases and disagrees in 8/15**. Agreement occurs in the
12s, 36s, 96s, 132s, 144s, 156s and 168s segment starts; disagreement occurs
at 0s, 24s, 48s, 60s, 72s, 84s, 108s and **120s**. This is not a statistical
confidence measure and does not establish the true bar line in either subset.
The **120–132s** window deserves particular human review because its
first-pass 160 BPM percussion/bass support was relatively low. It has *not*
been identified by ear as the half-time bridge, and neither detector shows a
confirmed section boundary or global song-phase continuity.

All candidate lists remain explicitly **UNVERIFIED**. The new source-bound
metadata is in
`docs/music-review/one-more-run-harmonic-bar-cues-UNVERIFIED-20261120.json`.
It records exact original source manifest and six-stem hashes, candidate-report
SHA-256, stem-local strongest changes, and ranked harmonic-vs-percussion
comparisons for **all 15 segments**. No new original audio files were made.

## Browser playback / integrity gate

The standalone optional `/music-review/downbeat-review/` research page now
shows the selected per-offset harmonic contrast alongside its drum/bass ranking.
Its playback path checks SHA-256 **of each original OGG's bytes** against the
source-bound original-stem fingerprints before decoding. A mismatched source
refuses playback instead of presenting misleading synchronized clicks.

Chromium/Playwright exercised actual `AudioContext`-based original OGG decode
and playback from the opening, 120s section and shorter ending, including the
six-stem mix, beat-one offset switching and Stop. **Nine original OGG GETs**
were observed, zero uncaught JavaScript errors. An intentionally altered OGG
response was rejected with the expected SHA-256 mismatch. The local HTTP server
read audio from an already-existing hash-identical full checkout because the
research worktree intentionally excludes OGGs to protect CT223 disk space.
This is machine playback QA, **not human ear verification**.

Test commands:

```bash
uv run --offline --no-project --with numpy --with scipy python -B tools/music/test_original_downbeat_candidates.py
uv run --offline --no-project --with numpy --with scipy python -B tools/music/test_harmonic_bar_cues.py
node --test tools/music/test_downbeat_review.mjs
# See public/music-review/downbeat-review/README.md for full-audio Playwright command
```

## Remaining musical gates before production

Identify the actual bridge entrance and exit *by source listening*, corroborate
quarter-note phase through all transitions against mix/drums/harmonic stems,
check phrasing and potential pickups, test 2/4 or compound meter hypotheses,
and obtain independent human review for each accepted interval. Only then
consider a **separate, versioned, frame-exact** genuine-source bar-grid schema.
Do not merge this draft into the shipped synthetic beat API or alter Gym,
World Dance, physics, source OGGs or `RELEASE_BEAT_GRIDS`.
