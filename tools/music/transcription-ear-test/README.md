# Bitstream Bluffs — SheetSage2 and Basic Pitch, V3 church organ hybrid

2026-11-15. Private research/ear-test only. Source: Maxi's original
separated lead-vocal FLAC; 25-second slice t=150–175s of the Pope song.
No changes to the original FLAC, original V3 organ, game sound or main.

## Owner's first-hand listening feedback

Marvin preferred the SheetSage2 octave -12 version: "fucking TIGHT."
He thought SheetSage Raw might be more accurate to Maxi's sung pitch,
but was too shrill as a church organ, even though Maxi is a soprano.
He explicitly asked for the V3 church organ sound with SheetSage -12
notes/timing. Distinguish fidelity to the sung vocal octave from
the artistically preferred *organ register*. Do not assert one
octave lower was the true pitch of Maxi's singing.

## Model evidence, not ground truth

SheetSage2 official weights (CC-BY-NC-4.0) and pinned MERT backbone were
used on CT214 in an isolated research-only installation. To work around
a cuFFT error on torch CUDA, a stand-alone runner computes only the
original frontend's STFT on CPU, retains full 300-second model window,
and processes all learned model layers/decoder on GPU. Source code:
sheetsage2-cpu-fft.py and sheetsage2-batch.py. Full-song isolated
vocal/full mix plus 25-second analysis yielded MIDI, ABC, chord/key,
and beat tracks. Same 25 seconds: SheetSage2 68 sequential vocal notes.
Spotify Basic Pitch Apache-2.0 running isolated on CT211 produced
129 raw notes, including simultaneous harmonic fragments, and 766
pitch bend events. Separate non-overlapping interval optimization
selected 72 Basic Pitch notes for the initial audio comparison.

Cross-model comparison: 57 of 68 Sheet notes matched Basic Pitch under
one-to-one onset (max 180ms), minimum 40ms overlap and pitch-class
constraints; 56/57 share exact pitch class. Fifty Sheet notes received
corroboration from both Basic Pitch and independent SPICE neural F0.
This represents model agreement, NOT confirmed musical correctness.

## Original ear test and its V3 organ provenance

Original SheetSage Raw and SheetSage -12 and Basic Pitch monophonic
were rendered with V3's exact FluidR3 GM SoundFont program 19,
the original Vertigo organ's V1 texture blend, attack layer,
saturation and normalization. They differed from old V3 by their
pitch and note-onset choices, and by using flat MIDI note centers
without V3's expressive continuous pitch bends.

NOTE: The preferred SheetSage -12 was already the V3 organ timbre.
No replacement of timbre was necessary.

## New V3 expression variants

Script build-v3-sheetsage-hybrids.py takes the original 68 SheetSage
-12 notes and F0 controls without changing timing, note keys or pitch
register. It measures V3's original within-note F0 fluctuation,
centers the movement around each note's median (NOT the absolute
V3 pitch or octave), rejects octave jumps, smooths it and
anchors modest movements to the SheetSage-12 note center.

Hybrid Gentle: up to +/-32 cents, movement weight 0.72.
Hybrid Expressive: up to +/-70 cents, movement weight 0.92.
Both were actually rendered successfully for 25 seconds using
the original render_v3_pitch_examples.py and unchanged instrument/FX.
Original V3 output, original SheetSage -12 output, and source
stems remain untouched. No artist approval of hybrids yet.

## Private listening page

http://100.115.120.66:8181/tools/music/audition-transcription/

Six clock-aligned 25s variants: new Gentle V3×Sheet and Expressive
V3×Sheet, original Flat SheetSage -12 (Marvin's preference),
SheetSage Raw, Basic Pitch Clean, unchanged V3 organ. Original
Maxi vocal plus optional backing also available. Backing and
extra biome acoustics default OFF. Browser smoke verified six
voice switches and eight decoded media clips with no errors.

All generated private audio under public/music-transcription-audition/
is excluded from Git; source model weights and rights-restricted
SheetSage outputs are research-only, not shipped game assets.
