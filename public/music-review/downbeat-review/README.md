# *One More Run* — source downbeat listening lab (UNVERIFIED)

This is an optional, standalone research page at `/music-review/downbeat-review/`.
It is **not used by the game**, the Gym, the synthetic beat API, World Dance,
the release beat catalog, or any audio transport service. Do not merge PR #53
or ship source-aligned bar metadata on the strength of this page alone.

## What it does

- Reads the current **original** `public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json`.
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
