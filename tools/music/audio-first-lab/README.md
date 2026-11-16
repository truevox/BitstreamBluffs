# Bitstream Bluffs — private audio-FIRST 4×12 A/B instrument lab

Built November 16, 2026. Marvin explicitly asked for the sounds to
be right BEFORE any non-audio game-engine or BSOD chase implementation.
He also requested original/biome comparison and live blending for
each of four musical families.

## Open the private lab

http://100.115.120.66:8185/

Persistent CT223 user service: bitstream-audio-first-ab-20261116.service
Private site, OUTSIDE Git:
  /home/hermes/experiments/bitstream-audio-first-4x12-20261116/site

The original playable game proof at Tailscale port 8184 is untouched.
No SheetSage2/MERT weights, private audio, trained checkpoints,
game physics, RunScene or BSOD gameplay chase logic were changed
or shipped.

## Two songs, four roles, twelve biomes

The lab uses two 32-second samples selected for audible musical content:
Pope at 2:30–3:02, One More Run at 1:32–2:04.

- **Melody:** the original Maxi vocal ↔ the EXISTING twelve
  excellent biome renditions. Pyramid Peak's owner-approved lead
  remains unchanged. Candy Cane's lead fix is NOT yet implemented.
- **Bass:** original bass ↔ eleven themed alternatives per song.
  A further source dropdown compares:
  V1 original-stem spectral treatments (quite close to original)
  vs **V2 note-guided FluidR3 sampled instrument sounds**,
  twelve total bass identities counting unchanged home.
  The V2 bass pitch extraction is automated and could contain errors;
  audition by ear rather than treating as validated MIDI.
- **Drums:** unchanged original ground drums ↔ eleven airy,
  biome-colored airborne percussion treatments.
- **Featured accompaniment:** the song-selected original Guitar,
  Piano or Other ↔ eleven biome-themed spectral interpretations.
  Pope selects OTHER from musical activity coverage (~22%);
  One More Run selects PIANO (~56%, narrow lead over guitar).
  The other TWO unfeatured original stems continue to play.
  The polyphonic featured timbres are DSP/coloring prototypes,
  not yet all-new sampled-instrument re-recordings.

In total: **124 private Ogg Opus clips** (62 per song):
six untouched-content original stem clips, twelve existing melodic
voices, eleven airy drums, eleven featured versions, eleven V1 bass
versions and eleven sampled-note V2 bass versions. All clips are
48kHz source-clock-aligned and 32 seconds long.

## Live listening controls

- Select any of twelve biomes and either of the two songs.
- Four independent Original / 50-50 / Biome buttons and 0–100 blend
  sliders; three global comparison presets.
- Solo ANY of the four musical families and restore full mix.
- Select sampled V2 or DSP V1 for bass; compare on the same song time.
- Scrub, pause, restart, and loop while all stems stay synchronized.
- BSOD severity is MANUALLY simulated: original and biome versions
  of ALL THREE (Guitar/Piano/Other) receive shared filter,
  saturation and tremolo as deletion gets closer.
- Speed is also MANUALLY simulated: bass volume, low-end punch and
  overspeed grow while independently changing BSOD distance.
- Both controls are explicitly AUDIO TEST SLIDERS, not physics or
  a fabricated live chase signal.

Crossfade uses linear gain for phase-correlated same-source DSP
variants (avoid +3dB doubling at 50%) and equal-power blending
for truly distinct sampled bass/voice variants.

## Reproduction / provenance

Checked-in source only:
- tools/music/audio_first_render.py
  First set of original clips and frequency/time-shaped themed sounds.
- tools/music/audio-first-lab/select_featured_by_activity.py
  Measures temporal source activity across guitar/piano/other,
  prior to selecting the one featured per-song source; NOT RMS volume.
- tools/music/audio-first-lab/transcribe_source_bass.py
  Original source-bass monophonic estimated pitch/events (no AI needed).
- tools/music/audio-first-lab/render_note_guided_bass_v2.py
  Native FluidSynth and FluidR3 GM SoundFont sampled bass interpretations.
- tools/music/sf2_melody_v2.py
  Existing native SoundFont synthesis bridge.
- tools/music/audio-first-lab/index.html and app.js
  Private standalone Web Audio player/mixer, NOT game-engine modules.
- tools/music/audio-first-lab/smoke.mjs
  Real Chromium end-to-end A/B, solo, biome, track and timbre switching QA.

Source stems (read-only):
  /root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4
  /root/bitstream-maxi/launch33/stems/grouped_6s/33_one_more_run

Original full Gentle-score melodic voices:
  /root/bitstream-maxi/transcription-lab-20261115/full-song-pope/full-palette
  /root/bitstream-maxi/transcription-lab-20261115/full-song-one-more-run/full-palette

CT211 generated, NOT Git:
  /root/bitstream-maxi/private-four-family-ab-20261116
  /root/bitstream-maxi/private-bass-sf2-audition-v2
  /root/bitstream-maxi/{pope,one-more-run}-bass-extracted-notes-v1.json

CT223 private site combines these, retaining original V1 bass
under /song/bass-dsp and the better-differentiated sampled V2
under /song/bass. Original source music untouched.

## Verification and boundaries

Real Chromium verified both songs, 12 biome selectors, all four
original/biome blend controls, family solo/restore, switching between
bass V1 and V2 MID-PLAY, simulated BSOD and bass speed sliders,
seeking, and zero JavaScript/media HTTP errors. All 124 files
verified, no model weights or private media in repository.

Original vs V1 bass correlation was roughly 0.98–1.00 (too similar);
V2 source-vs-sampled-bass correlations ranged from about -0.04 to
0.22 across checked biomes, a distinct sound but NOT proof of
correct note transcription or good musicality.

**Awaiting Marvin's ear test:** All non-melody instrument aesthetics,
bass note accuracy, favored drum/featured textures, BSOD effect taste,
and final Candy Cane melody are still UNAPPROVED. The lab is ONLY
32-second previews, not 33 full-song soundtracks or commercial
release clearance. No game-engine BSOD work until music direction
is approved. Keep public release media and model-weight safeguards.
