# Adaptive 4×12 audio manifest: feature-branch contract

This is the tested, *optional* extension of bitstream-music-pack-v1,
not a new public production pack or an instrument-selection decision.

## Why the architecture works

4×12 counts adaptable **sound-family identities** per biome:
Melody, Bass, Airborne Drums and ONE per-song featured source
(Guitar OR Piano OR Other). It does NOT cap the mix at four streams.

All **six original source stems** stay in each segment's sources map,
scheduled to the same frame clock. Unselected Guitar/Piano/Other
remain audible originals, never discarded. Selected source remains
scheduled, but the adaptive mix gate attenuates it once an appropriate
replacement is actually ready.

Existing voice:<biome> streams handle melodic performance. Three
reusable source buses handle Bass, Airborne Drums and Featured. Even
with 12 existing lead sources, that is typically 6+12+3 = **21 mixer
source IDs**, versus 51 names for a naive fully indexed design.
All other published and private media assets remain unchanged.

## Optional pack declaration

Add this object alongside the existing segments, effects and layers
keys. Existing music packs **without it behave as before**.

    "adaptive": {
      "featuredStem": "other",
      "variants": {
        "bass": {
          "debumont": ["bass/debumont/segment000.ogg", "bass/debumont/segment001.ogg"]
        },
        "drums": {
          "debumont": ["air-drums/debumont/segment000.ogg", "air-drums/debumont/segment001.ogg"]
        },
        "featured": {
          "debumont": ["featured/debumont/segment000.ogg", "featured/debumont/segment001.ogg"]
        }
      }
    }

This illustration assumes a two-segment song. For a real song, each
configured biome/role requires **exactly one path per segment**, aligned
to existing sampleRate and startFrame/frames. Path validation allows
only safe relative paths inside that pack's root (no traversal).

- featuredStem accepts only guitar, piano or other; exactly one per song.
- All eleven nonhome biome keys are valid, but **partial availability is
  supported**: a missing biome variant uses the original source.
- Home/bitstream-bluffs NEVER contains adaptive backing variants.
- Existing six core source IDs are mandatory; adaptive files are NOT
  added to the permanent sources map. There can be at most 45 named
  permanent sources when adaptive metadata is present, reserving three
  mixer buses within the global 48-source budget.
- Melody assets retain their current voice:<biome> naming.
- The actual instrument used to *produce* an adaptive variant is
  intentionally unspecified: GM, physical modeling, real recordings,
  multisamples, granular synthesis and hybrid re-performance are all
  allowed. Nominal Guitar/Piano/Other bucket labels do NOT constrain
  the result.

## Runtime behavior

- All six original stems are loaded/scheduled through normal game
  segment playback. Original vocals remain under the existing toggle.
- When a biome's alternate bass/featured file becomes schedulable,
  a 200ms replacement crossfade begins. Its musical time matches the
  current decoded chunk sample clock, including mid-chunk switches.
- Airborne drum variants engage only in air and in nonhome biomes.
  Landing immediately starts returning to the real source drum stem.
- Returning home restores original bass, drums and featured source.
  The two OTHER accompaniment stems remain unchanged all along.
- A missing, late or malformed alternate cannot silence its original:
  fallback restores it, retries are backed off, and rapid switches
  cannot allocate an unbounded number of mixer source buses.
- Prefetch failure for a LATER segment must not silence the currently
  healthy segment. If the future file remains missing at the boundary,
  the matching original stem returns. The backoff survives that fallback;
  otherwise the same 404 would be re-fetched every 75ms.
- A replacement already loaded for a future segment is promoted near
  the correct sample-clock boundary, never 200–250ms before it plays.
- Each track's independent user stem-gain settings are reapplied to the
  corresponding reusable adaptive bus, including when the next song's
  featured source switches from Other to Piano or Guitar.
- A decoded replacement file significantly shorter than its expected
  source segment is invalid and must never take over playback.
- User-mix gains, gameplay motion gains and adaptive replacement gains
  use separate WebAudio stages, avoiding a volume-setting conflict.
- No instrument is audible by creative fiat; this is plumbing for
  audio candidates that Marvin must later review.

## Known boundaries

Only the private audio lab has actual candidate biome variants today;
the 33-song full-length, segmented adaptive pack has NOT been generated.
The present implementation does not invent musical instruments or
mix/score evaluation; it only routes correctly supplied assets.
BSOD-distance-aware DSP on an adaptive replacement itself still needs
game telemetry and approved FX behavior. Do not substitute speed.
Production deployment, source licensing and final musical approvals
are separate future gates.

## Reproducible tests

    node --experimental-vm-modules node_modules/jest/bin/jest.js \
      tests/src/adaptive-music-router.test.js \
      tests/src/adaptive-music-director.test.js \
      tests/src/music-pack.test.js \
      tests/src/music-fx.test.js --runInBand

Real Chromium uses the same private Pope stems without copying them:

    BITSTREAM_PRIVATE_AUDIO_SITE=/path/to/private/site \
      node tools/music/audio-first-lab/smoke_adaptive_browser.mjs

The smoke builds temporary metadata/symlinks, starts a loopback-only
server, exercises real WebAudio and deletes all temporary files.
It verifies the two unfeatured source stems, Debumont-to-Candy
switching, flight and landing, full original Home restoration,
source-bus count, and browser/media errors.

Use the optional two-segment tests to exercise the real compressed audio
boundary at eight seconds. These generate **temporary** 8-second
split Oggs using ffmpeg; the existing private source clips stay intact:

    BITSTREAM_PRIVATE_AUDIO_SITE=/path/to/private/site \
      node tools/music/audio-first-lab/smoke_adaptive_browser.mjs --segments

The deliberate failure variation omits one future featured segment:

    BITSTREAM_PRIVATE_AUDIO_SITE=/path/to/private/site \
      node tools/music/audio-first-lab/smoke_adaptive_browser.mjs --missing-second-segment

Both validate all six originals, music clock, reuse of only 21 source
IDs and restoration of source Other if an optional future chunk is
missing, with bounded HTTP 404 retries. Neither variation publishes audio.


## Verified branch regression status (2026-11-16)

39 targeted music tests pass; three actual Chromium/WebAudio smokes pass (single 32-second segment, two 8-second segments, and second-segment deliberate 404 fallback), with 21 mixer buses. The full Jest suite has seven failing suites and nine failing tests on BOTH this branch and its untouched ee4923e baseline; do not misattribute legacy terrain/tricks/config/UI failures to the optional audio router. Existing release Vite build and private-asset gate pass.
