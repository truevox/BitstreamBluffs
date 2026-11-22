# *One More Run* — source downbeat listening lab (UNVERIFIED)

This is an optional, standalone research page at `/music-review/downbeat-review/`.
It is **not used by the game**, the Gym, the synthetic beat API, World Dance,
the release beat catalog, or any audio transport service. Do not merge PR #53
or ship source-aligned bar metadata on the strength of this page alone.

## What it does

- Reads the current **original** `public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json`.
- **Checks SHA-256 of each of the six original OGG stems at audition time**;
  a tampered or mismatched audio response fails closed before decoding.
- Also shows source-bound **rhythmic phase-continuity uncertainty** per segment. The new analysis found 22/27 transitions without sufficient multi-stem corroboration, five with stable candidate phase, and zero with a corroborated shared change. This is a failure to *prove* drift, **not proof of steady tempo**. Every phase summary is tied to original-pack, baseline, harmonic, and whole-source research SHA-256 fingerprints.
- Displays separate, explicitly unverified **guitar/piano/other pitch-class change**
  rankings for the selected tempo/phase/beat-one offset, including when the
  harmonic cues *disagree* with drum/bass accent rankings. These derived
  Demucs stems are correlated; this is not independent human corroboration.
- Checks the original manifest SHA-256 against the research candidate report.
- Fetches only the original selected 12-second OGG stem segment, directly from
  the same origin, on demand; no source audio copies or generated backing tracks.
- Auditions all 15 source research windows against three *hypothesized*
  tempos, up to four pulse phases per tempo, and **all four possible** 4/4
  beat-one offsets per phase.
- Accents beat one with a stronger tick, keeping quarter pulses unchanged while
  reviewing rival measure placements. Choose full six-stem mix, drums, bass,
  or guitar+piano+other as needed.
- Exports *observations* to a local JSON download. Observations are **not**
  verification, and are not automatically written into the song or GBrain.

The extended source report covers all 15 segments, including the shorter 6.6s
ending. Its ending candidates are particularly sparse. No section has been
human-audited; there are no trusted beat/measure frames to ship.

## Reproduce

```bash
python3 tools/music/build_downbeat_review_data.py
node --test tools/music/test_downbeat_review.mjs
uv run --offline --no-project --with numpy --with scipy python -B tools/music/test_harmonic_bar_cues.py
# To exercise real WebAudio playback from a sparse checkout without copying OGGs:
BITSTREAM_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
 BITSTREAM_CHROMIUM=/usr/bin/chromium \
 BITSTREAM_FULL_SOURCE_PACK=/path/to/existing/full/33_local-one-more-run-bitstream-bluffs \
 node tools/music/smoke_downbeat_browser.mjs
# In a normal checkout containing the original audio and dependencies:
npm run dev
# Open /music-review/downbeat-review/ on that Vite server
```

The lightweight local CT223 **sparse** research checkout excludes original
`public/music/**/*.ogg` files to preserve disk space, so its standalone HTTP
server will display source metadata but cannot play audio. A normal full
checkout or Netlify preview that includes the original tracked OGGs can play.
Do **not** copy OGGs into the sparse worktree just to run this reviewer.

## Listening and release gates

1. Repeat the exact same excerpt with four beat-one offsets. Reject candidates
   that make section entries, chord changes, and anticipated beat-one accents
   feel musically displaced. A compelling kick accent alone is not enough.
2. Compare alternate pulse phases and 160.00 / 161.50 / 163.84 BPM *hypotheses*.
   A 160 BPM generation prompt does not prove the recording's actual tempo.
3. Seek independent human/musical review of pickups, rests, the deliberate
   half-time bridge, and competing 2/4 or compound-meter interpretations.
4. Annotate exact source frames, time signatures, version and source hashes,
   uncertain intervals, and review provenance before proposing a release schema.
5. Never import this JSON into `RELEASE_BEAT_GRIDS` or change gameplay physics
   from a merely plausible click overlay.

The exported `bitstream-unverified-listening-notes-v1` format deliberately
has no `verified` status or release-data fields.

### 2026-11-21 lossless master WAV verification / targeted review queue

Source SHA256 for the actual **CT211 original lossless WAV master** is
`636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721`.
The master was verified on CT211 and decoded through an SSH read-only audio
stream for analysis—**never uploaded, copied to the repo, served by this page,
or modified**. The derived [original-master research](../../../docs/music-review/20261121-wav-master-rhythm-and-structural-cues.md)
is tied to the previously verified original full-mix MP3 by 0-sample-lag PCM
correlation of >0.998 for opening, middle and ending excerpts. The high-band
rhythmic periodicities agree within 0.03 BPM in all overlapping windows;
**no verified real beat-one or bridge/chorus annotation follows**.

The player now accepts optional **source-verified master-derived review passage
ranges** (12 unapproved suggestions) to help focus human listening. Each range
is played using its **existing unchanged SHA-verified original OGG stems**;
a range crossing a 12-second original segment boundary schedules appropriate
source-time exact portions of both adjoining OGGs. The hypotheses' synthetic
click positions and bar offsets remain absolute-source aligned after seeking.
Only a human's explicitly downloaded notes record their impressions; nothing
is written back into production gameplay or musical reference timing. This
page never plays the original WAV master itself and no master data is shipped.
