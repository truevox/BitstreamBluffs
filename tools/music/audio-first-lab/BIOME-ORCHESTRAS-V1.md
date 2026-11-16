# Bitstream Bluffs — eleven biome orchestras (creative candidates)

**Status: Friday's NOT-YET-APPROVED artistic recommendations.** Marvin
approved an orchestra-like identity for eleven biomes and the freedom to
use whichever sound-generation method actually sounds best; he has
NOT yet listened to or approved any new specific assignment below.
Never replace the 231 existing private auditions or the perfect
owner-approved Pyramid Peak lead without further listening decisions.

## Architectural contract

- Twelve identities = Home/Bitstream plus eleven nonhome biomes.
- The home identity retains **all six original source stems**.
- Each song's Guitar, Piano or Other **source bucket** can be chosen for
  ONE featured re-performance according to note/activity coverage.
  The other two original buckets keep playing, beat-aligned and
  available to the BSOD effects system. A stem name does not prescribe
  a replacement instrument.
- Four adaptive sound families are melody, bass, airborne drum kit and
  a single featured accompaniment. They are *not* a four-stream limit.
- Both original Maxi vocal and the biome melody are independent.
  Pyramid Peak's approved lead stays locked. Other existing leads and
  Candy Sugar Pop V3 remain available audition references, not automatic
  endorsements.
- Bass should always retain a useful low fundamental. Drum alternatives
  should respect source attack placement. Featured accompaniment should
  retain accurate notes/phrases and behave musically alongside the lead,
  not turn into a second competing melody.
- All nonhome instruments are AUDIO DESIGN TARGETS. Actual rendering
  might use multisampled instruments, procedural physical modeling,
  granular/frequency-domain resynthesis, field recordings, or GM
  SoundFont samples if and only if that is the best sound.

## Unapproved palettes

| Biome | Bass character | Airborne percussion | Featured accompaniment (source-agnostic) | Preferred sound engine |
| --- | --- | --- | --- | --- |
| **Debumont** | Warm console/wood-bodied bass, soft rounded fundamentals | Powder brush, sleigh hush, woody shaker | Fireside hammered dulcimer, mellow plucked nylon or resonant cabin strings | Real plucked samples + compact wavetable + gentle room |
| **Garbage Dump Glacier** | Corrupted FM low pulses, dirty spectral sidebands | Found scrap ticks, compressed air and fractured circuit noise | **Tuned junkyard**: suspended pipes, smashed electronics, metal scraps with recognizable pitches | Recorded foley pitched with spectral resynthesis + controllable granular layers |
| **Pyramid Peak** | Deep contrabass with dusty low-brass reinforcement | Sistrum, frame drum and drifting sand shakers | Qanun/oud/santoor-style plucked and struck accompaniment under the **unchanged approved brass lead** | Expressive sampled strings + Karplus–Strong resonances |
| **Underwater Mountain** | Fretless glide over a round sine sub | Submerged bubbles and muted hydro taps | Bowed liquid-glass harmonics, waterphone-like resonances and soft hydrophone swells | Physical resonators + glass samples + fluid filtering |
| **Crystal Cavern** | Rounded sine sub with crystalline overtones | Tiny glass clicks and soft prism shakers | **HoloPad**: broad luminous polyphonic harmonies, decidedly *not* another glockenspiel | Layered poly synth / spectral pad / slow harmonic envelopes |
| **Space Mountain** | Warm orbital analog mono bass | Vacuum clicks, tiny static chirps, near-silent impacts | Navigational FM plucks, telemetry echoes and spatial electric-bell harmonies | FM synth + spatial delays / controlled sound-design layers |
| **Candy Cane Canyon** | Elastic taffy synth sub, soft rubber transients | Sugar snaps, candy-wrapper foley and bouncing clicks | Pizzicato candy strings or a silly miniature accordion — NOT another marimba or square-lead clone | Sampled toy accordion/pizzicato + rubbery custom articulations |
| **Sky Jellyfish Mountain** | Breathing low sine tone, floating under the airy vocal melody | Breath pulses, rainstick drifts, membrane whispers | Wind-harp resonance, delicate Aeolian string shimmer, spacious sustained harmony | Spectral / physical string modeling + subtle breath noise |
| **Steampunk Slopes** | Mechanical piston-driven sub with pressure-cycle swells | Gear clicks, valves and steam bursts | **Copper Banjo candidate retained**; augment with struck electromechanical tines or tiny clockwork plucks | Real banjo samples + tuned metal-resonator modeling |
| **Micro Mountain** | Miniature pixel sub with a genuine low octave | Thimble knocks, tiny woodblocks and rattle sprites | Wind-up kalimba, pin-sized toy-plucks, miniature mechanical music | Kalimba sampling + physically modeled toy strings + foley |
| **Vertigo Vents** | Distorted volcanic sub and subterranean trembling | Ash noise, steam jets and distant fractured impacts | Bowed steel tension chords and tuned iron plates — NOT a second organ | Bowed-metal recordings + spectral resynthesis + controlled saturation |

Home does not require eleven alternate choices; it uses the
original mastered stems and existing home melody identity.

## Build pipeline and relationships

An orchestra is a COHERENT COMBINATION, not an isolated patch label.
A candidate per-biome sound manifest should record the following:

- **Musical role:** bass, airborne percussion, melody, or featured
  harmonic/rhythmic/countermelodic accompaniment.
- **Source evidence:** exact six-stem source asset, decoded sample clock,
  known/uncertain note attacks, pitch register and confidence.
- **Voice identity:** sound-design name, actual synthesis backend(s),
  sample/license provenance, articulations, attack/sustain/release
  treatments, dynamics and optional spatial/biome processing.
- **Lead relationship:** frequency/register separation, accompaniment
  rhythm, melodic density and scene identity relative to the active
  biome melody. For example Crystal HoloPad should contrast with
  glockenspiel; Steampunk piston bass must not just duplicate calliope.
- **Level and safety gates:** source-arrangement comparison,
  loudness/true-peak, gap handling, source clock alignment, phase and
  cut transitions; explicit fallback to original if no candidate loads.
- **Approval:** all first-pass candidate renders remain additive
  and selectable, never silently replacing prior versions.

General MIDI can still win an A/B comparison. It is merely one member
of the instrument toolchain, not the destination or creative ceiling.

## Engine verification (same feature branch)

The adaptive manifest may hold any biome-specific asset paths without
registering every file as a permanent source. The runtime has **six
mandatory original stem buses, existing melody voices and three reusable
adaptive buses** (Bass, Drums, Featured). It gates attenuation on
successful replacement scheduling and restores originals when returning
home or encountering missing assets. No full-song production pack or
biome-orchestra render has been promoted from this proposal.

Source implementation:
- src/systems/music/AdaptiveBiomeRouter.js
- src/systems/music/MusicPack.js
- src/systems/music/StemMusicDirector.js
- src/systems/music/MusicFXGraph.js
- tests/src/adaptive-music-router.test.js
- tests/src/adaptive-music-director.test.js
- tools/music/audio-first-lab/smoke_adaptive_browser.mjs

The real WebAudio smoke uses the existing private Pope excerpts without
copying, replacing, or modifying any Ogg. It tests Debumont to Candy,
airborne/landing transitions and Home restoration, including the
untransformed Piano and Guitar streams while Other is featured.
Optional two-segment browser tests generate only **temporary** trimmed
audio, checking real decoded Opus clock alignment and a deliberate
future-segment omission. New biome designs are still audition candidates,
not silently installed or owner-approved sounds.
