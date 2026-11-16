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

## Third song — actual sampled guitar-family audition (2026-11-16)

Marvin requested a third song to hear the guitar family, suggesting
Varmont Is Saved first. The exact original song and separated stems
are in the 33-song CT211 launch33 archive (slot 31). However:
Varmont guitar active coverage ~8.7%; Other ~20%, so guitar would
not be its featured source under Marvin's actual per-song winner rule.

Scanned the whole archive for genuine guitar-dominant sources.
Only two of 32 original six-stem songs choose guitar from the
offline temporal musical coverage metric:

- Every Hacker (Runs Out of Code) — Part 2, slot 03 and YouTube ID
  WRBGQUqD54U: guitar ~26.2% vs Other ~22.7%, piano ~0%;
  selected 32s excerpt from 4.5s where guitar is ~71.9% active.
- scada_plaintext.err, slot 26: guitar ~24.1%, Other ~11.2%,
  piano ~0.5%, its best 32s guitar passage ~48.4% active.

The better ear-test candidate Every Hacker is now the third track
of the SAME private A/B page at http://100.115.120.66:8185/ .
Its displayed title ends in [GUITAR] so it is easy to find.
This third track uses the real original six source stems and ELEVEN
NEW distinct sampled-guitar performances from actual GM SoundFont
patches, rather than just filters on the original audio.

Source-only reproduction stages (all experimental source paths
remain read-only):

- tools/music/audio-first-lab/rank_guitar_full_archive.py:
  measure all 32 separated tracks, persist guitar activity ranking.
- tools/music/audio-first-lab/extract_polyphonic_guitar.py:
  transcribe guitar musical content for the chosen 32 seconds using
  local harmonic FFT templates, nonnegative sparse matching and
  simple note-on smoothing; 41 raw candidates, 35 final events for
  most patches. The source stem and output are in the CT211
  launch33 archive; estimated pitches/chords MUST be ear-checked.
- tools/music/audio-first-lab/render_sampled_guitar_showcase.py:
  use libfluidsynth with eleven GM instruments to reperform the
  extracted notes, including Steampunk picked BANJO (GM 105),
  Crystal HARP (46), Candy muted FUNK guitar (28), Debumont nylon
  guitar (24), and Pyramid sitar-like plucked lute (104). All
  samples are source-clock-aligned and preserve a little original
  source for attack continuity; they are not pure EQ transforms.
- tools/music/audio-first-lab/render_third_song_excerpt.py:
  generate six unchanged source-stem clips, eleven airy-drum
  retextures, eleven source-based bass reference transforms and
  eleven note-guided sampled bass alternatives for the third
  excerpt. Needs the existing tools/music/audio_first_render.py,
  the existing tools/music/sf2_melody_v2.py and the 2 earlier
  bass scripts from this audio-first-lab directory on Python path.

CT211 generated private music paths (NOT in Git):

  /root/bitstream-maxi/launch33/guitar-showcase-ranking-20261116.json
  /root/bitstream-maxi/launch33/hacker-guitar-notes-private.json
  /root/bitstream-maxi/private-hacker-guitar-20261116/
  /root/bitstream-maxi/private-hacker-full-lab-excerpt-20261116/

CT223 serves 50 additional private synchronized 32s clips under
  /home/hermes/experiments/bitstream-audio-first-4x12-20261116/site/every-hacker-pt2/

The overall lab now has THREE songs and 174 independent Ogg clips.
In the new third track, all eleven biome guitar patch alternatives
are selected under FEATURED ACCOMPANIMENT, with Original/half/Biome
and Solo controls. Existing bass V1/V2 and airy drum alternatives
are also present. A 12-voice lead melody score for Every Hacker
DOES NOT YET EXIST: the lab correctly leaves original sung Maxi
vocals in place and DISABLES only that song's Melody A/B controls,
rather than implying a missing instrument is available.

Actual Chromium tested all three songs: sample-accurate original and
replacement guitar start together, switching to Steampunk Banjo,
soloing featured guitar, 0/50/100 blending, switching from Pope and
One More Run, 9 media sources on the guitar track versus 10 on
the other two, and zero JS/HTTP failures.

This work does not add Varmont or guitar to the released game.
The new sampled guitar voices are real DIFFERENT instruments, but
automatically transcribed polyphonic guitar notes may be imperfect:
owner musical approval remains pending. Pyramid original existing
melody and game engine, BSOD physics, other song assets, and all
release/weight safety checks remain unchanged.

## November 16: remaining ACTUAL sampled instrument families (latest)

**Owner direction:** Complete eleven airborne drum kits, eleven piano
instruments, eleven other instruments and genuinely distinct Candy
Cane lead. Critically, retain ALL previous bass, guitar, source,
melody and effect-only audio: these have not been audited by Marvin.

### New sound assets, preserved alongside previous drafts

- **33 NEW sampled percussion kit clips:** eleven nonhome airy GM bank
  percussion kits across ALL THREE songs. From original separated
  drum stems, detect onset times and approximate kick/snare/hat roles,
  then trigger DIFFERENT native FluidR3 GM drum samples for each
  biome. Source hit counts: Pope=157, One More Run=192 and Every
  Hacker=103 across each 32-second excerpt. Source beat mapping is
  preliminary; user listening is the final quality gate.
- **11 NEW Piano-family actual samples:** source One More Run piano,
  approximately 122 preliminary polyphonic note events, about 106
  retained for render; eleven real SoundFont instruments, including
  Crystal Cavern HoloPad and Steampunk Clockwork Upright.
- **11 NEW Other-family actual samples:** source Pope Other, about 54
  preliminary polyphonic note events and 50 rendered, instruments
  including Candy Gumdrop Sequencer and Debumont Snowstrings.
- **2 NEW Sugar Pop Candy melody clips**, one Pope and one One More
  Run, from previously-established Gentle-score vocal melody notes.
  Actually sampled GM Marimba + lower-level square synth plus
  independent bouncing rubber-plop note attacks. Deliberately
  NOT the old Candy GM81 saw lead, and no similarity to original
  Pyramid GM61 brass lead intended. Original previous Candy and
  PERFECT Pyramid are both fully preserved.

New synced assets are additive, so there are **231 PRIVATE Ogg
clips** across all three songs. Files went into independent
new directories below the private CT223 listening lab:
- /song/drums-sampled/biome.ogg — new actual sampled percussion.
- /pope/featured-sampled/biome.ogg — new sampled Other.
- /one-more-run/featured-sampled/biome.ogg — new sampled Piano.
- /song/melody-candy-v3/candy-cane-canyon.ogg — NEW Sugar Pop
  for Pope and One More Run only.

Old drum and featured versions remain at the ORIGINAL paths
/song/drums/biome.ogg and /song/featured/biome.ogg. Both existing
bass folders (bass and bass-dsp) and eleven earlier guitar
samples for Every Hacker remain unchanged. The prior Candy lead
remains /song/melody/candy-cane-canyon.ogg. All six source
recordings for each song remain unchanged.

**All version controls are now wired:** AIR DRUMS has NEW sampled
vs OLD effects; FEATURED has NEW sampled vs OLD effects for Pope
and One More Run, while Guitar remains its original sampled version;
CANDY has NEW Sugar Pop vs OLD Candy only when there is an actual
synthetic melody and Candy biome selected. Original/50-50/Biome
blend for all four families, solo, song/biome choice, Bass V1/V2
selection, BSOD and speed sound-only manual test knobs all remain.
All three changes default to NEW but are reversible without
restarting or losing the place in the song.

### Reproduction & provenance, NOT Git media

Native sampled audio generation is fully reproducible via:
- render_sampled_air_drums.py, with original DRUM source and start.
- render_sampled_featured.py, with original Piano/Other source
  and note-estimation source from extract_polyphonic_guitar.py
  (now supports --start for generic source stems).
- render_candy_melody_v3.py, with the old approved gentle/notes.json
  for Pope or One More Run.
All are under tools/music/audio-first-lab. These are SOURCE ONLY;
rendered assets, weights, original music and any protected data are
outside Git. Scripts use Python tabs.

Private CT211 rendered roots:
- /root/bitstream-maxi/private-sampled-drums-20261116
- /root/bitstream-maxi/private-featured-samples-20261116
- /root/bitstream-maxi/private-candy-sugar-pop-v3-20261116

The listener stays the SAME Tailscale-only page at
http://100.115.120.66:8185/ with private source audio in
/home/hermes/experiments/bitstream-audio-first-4x12-20261116/site.

**QA:** Actual Chromium verified new sampled drum and feature
source paths in both original two songs, old V1 drum/featured
switches and back during playback, original bass switching,
NEW and old Candy lead selections and return, guitar preserved
as sampled in the third song, correct hidden Candy selector when
not in Candy biome, 10/9 source count as appropriate, no JS or
HTTP errors. Independently checked 22 new-vs-old audio pairs:
nonzero audio, safe peaks, and distinct waveform samples.
No game chase/physics or public soundtrack modifications; this
is first draft AUDIO, pending user listening approval.

## November 16 research V2 — not in the listening lab

While the owner has not yet listened to guitar/bass/drums/featured alternatives,
we performed a strictly ADDITIVE technical research pass: audited all 33 sources,
ran independent Basic Pitch and co-hit drum transcripts on the three excerpt
songs, and smoke-tested a versioned, cache-safe 33-song task planner.
The original 231 listening clips and all selections are untouched. See
[RESEARCH-V2.md](RESEARCH-V2.md) for precise evidence, scripts, CT211 paths,
proxy-score limitations, and the explicit owner-approval gate.

## November 16 V3 research — objective benchmarks and stem label confusion

Without any musical sign-off from Marvin, V3 added scored synthetic
note tests, all-family semantic profiles, a controlled htdemucs_6s
instrument-routing probe, held-out-kit drum classifier calibration,
relative note-expression metadata, and full SHA256 source/preview
preservation checks. **Guitar caught an acoustic piano and strings**
in controlled synthetic examples, confirming its label is not an
instrument identity. All 231 original private audio clips remain
unchanged and no V3 audio entered the public game.

See [RESEARCH-V3.md](RESEARCH-V3.md) for measured results, assumptions,
private CT211/CT223 outputs, and explicit musical approval gates.
