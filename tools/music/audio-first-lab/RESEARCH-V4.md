# Audio-first 4x12 orchestra lab — V4 independent revisions (2026-11-16)

**Status: built and privately audible; not artist-approved, not live-game
music, not commercially cleared.**

Private Tailnet lab: http://100.115.120.66:8186/

After the first all-biome integrated listening pass, Marvin made two
**distinct** observations (neither was interpreted as an approval of
any replacement):

1. **Timing and articulation:** Some notes *seem to arrive late* and
   stop hard; others do not. He asked whether the accompaniment's
   source scoring differs from the lead, or slow attacks cause the effect.
2. **Orchestra character:** Multiple mountains still sound alike,
   despite different instrument names. He particularly liked
   **Vertigo Vents, Crystal Cavern and Pyramid Peak**, and requested
   **more low-resonant BOOOONG** in Crystal.

The two problems were investigated, then resolved *as independently
auditionable experimental changes*. The original first-pass audio
remains unchanged for a literal A/B.

## Diagnosis grounded in source files

**Yes, scoring methods differ.** Lead melody comes from the
SheetSage2-derived, earlier-tested vocal score (with octave and
expression choices); the featured accompaniment comes from independent
Basic Pitch polyphonic extraction of the chosen Demucs Guitar/Piano/Other
stem plus an unapproved source-envelope velocity/length proxy. Bass uses
separate fundamental-frequency tracking. Airborne foley onset timing
comes from spectral transients in the original drums.

Pope's Other featured excerpt: 151 automatic note candidates,
**median 198 ms**, 62% under 250 ms.
One More Run's Piano: 299 candidates, **median 197 ms**,
66% under 250 ms. The detector's onsets have NOT been manually
verified against true score or against an independent human onset
annotation. A note that was detected late can still be late in V4.

**Envelope bug independently reproduced.** The previous featured
renderer used fixed attacks ranging from 3 ms to 250 ms. Its shaped
note buffer ended before the specified release completed.
On a controlled 550-ms MIDI note, the last 10ms RMS of the old
hydroglass, HoloPad, windharp and bowed-steel outputs was **roughly
92%, 104%, 95%, and 98%** of their average respectively, right before
a hard end. A 160–250 ms attack on mostly 200 ms notes both masks
onsets and creates a hard-off / late-on illusion.

The shared initial sounds were built from **the same sine-partial
synthesis recipe** across biomes, often with the same sampled
support, untransformed accompaniment mix, and small foley contribution.
This limited the difference between allegedly unique instruments.

## The three comparison selections

All versions use the EXACT same source-note event coordinates and
the same preapproved melody recordings. Only audio synthesis and
mixing stages change. Same two 32s song excerpts and all eleven
biomes, separate Ground/Air, original Maxi vocal toggle.

| Gallery selector | What changed | What did not change |
| --- | --- | --- |
| **First pass** | Nothing. The exact V1 clips from Marvin's initial listen | Original recordings, source scores and V1 mix |
| **Timing / envelopes** | Retains original instrument recipe but advances slow internal envelopes into audibility at the original detected onset; provides genuine note-off tails that taper to **exact silence** | **All note pitches, chosen event onset times and source-score estimates remain the same**, as do backing-stem level/scaffold choices |
| **Distinct orchestra** | Timing repair **plus** novel biome-specific physically inspired voices and more present bespoke airborne foley. Less weight for the common sampled featured glue, more for unique instruments | The same source-score coordinates, original six-stem provenance, selected/unselected logic and source melody performances |

New renderer:
tools/music/audio-first-lab/render_biome_orchestras_v2.py

Independent behavior tests:
tools/music/audio-first-lab/test_orchestra_revisions_v2.py

V2 instrument construction:

- Debumont: feedback-delay string / muted wood hammer model
- Garbage: struck inharmonic resonators, saturating grit
- Pyramid: brighter doubled plucked wires; **original lead unchanged**
- Underwater: fluid frequency wobble and inharmonic hydroglass
- Crystal: struck resonator with strong low fundamental and
  **additional, sparsely triggered resonating BOOOONG bell**
  using the existing note pitch class
- Space: chirping FM telemetry with dynamic sidebands
- Candy: beating reed harmonics plus toy-accordion tremolo
- Sky Jellyfish: colored windy string harmonics / aeolian noise
- Steampunk: feedback-string banjo with gear-click transients
- Micro Mountain: bright little inharmonic kalimba tine
- Vertigo: preserves dark bowed steel character with abrasive
  excitation and a new consistent release.

V4 does **NOT** claim these prototypes are physically exact simulations
of real-world instruments or a final soundtrack. All instrument names
are descriptive sonic design targets. Sampled support is still present,
and further acoustic/sampling work may be warranted.

## QA and private asset preservation

Original first-pass gallery: 48 Ogg files preserved in
/root/bitstream-maxi/orchestra-v1-20261116/site/.

Two additive revision media sets live in:
- site/revisions/articulation/ — 48 files
- site/revisions/orchestral/ — 48 files

Total current private gallery Ogg count: **144**.
Original 231-file listening archive at Tailnet :8185 remains unchanged.
Old original source stems and the approved Pyramid Peak lead Ogg
remain untouched; the new renderer reads them as input only.

Both revision QA reports **PASS**, 48/48 unique SHA256 assets,
zero short-window decoded peak/finiteness/format flags:
- qa-v2-articulation.json
- qa-v3-orchestral.json

The original site 48 files were rehashed against qa-v2.json after
migration, with old QA paths reconciled to the immutable site folder.
All 144 assets passed full-byte hash verification. No new audio was
included in Git. The site is an existing supervised CT211 loopback
server exposed ONLY through CT223 Tailnet SSH port 8186.

Real Chromium WebAudio comparison smoke PASS:
**148 HTTP resources**, playback, A/B original, all three revisions,
ground/air percussion, sample-aligned seek and biome/song changes,
optional Maxi voice and zero JS/media-loading errors.

Python unit tests: four pass. They verify for all eleven instrument
modes, both revisions have audible first-15ms attacks, explicit
end-of-note fade to silence, and source event counts/onsets held
constant between revision categories; they also independently
demonstrate the four original hard-cut defects.

## Musical interpretation and next gates

1. Ask Marvin whether articulation-only feels tighter but still
   familiar. **This isolates the envelope defect.** If some notes
   still arrive late, compare actual source audio against Basic Pitch
   events and correct the transcription — DO NOT randomly quantize
   all source onsets.
2. Ask whether reorchestration makes **different mountains sound
   different**. Keep Pyramid and Vents identities and augment Crystal
   only as desired. If the extra resonances are too crowded, adjust
   bell trigger density, resonance decay and level without revising
   note-event timing.
3. Shared original backing remains by **explicit owner instruction**.
   Not every perceptual similarity is a bug: it's still one song.
   Assess the timbre of transformed featured, bass and airborne drum
   sources independently when needed.
4. These are 32-second demonstrations, not 33 complete masters,
   licensed public game assets, complete LUFS mastering or approved
   source transcriptions. Full-song work remains gated on ears.

Source design canonical homes:
- tools/music/audio-first-lab/BIOME-ORCHESTRAS-V1.md
- tools/music/audio-first-lab/ADAPTIVE-4X12-MANIFEST.md
- tools/music/audio-first-lab/ORCHESTRA-LAB-V1.md
