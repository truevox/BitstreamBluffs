# Bitstream Bluffs — BSOD proximity corruption, music-only (provisional)

**2026-11-18 — Research/feature branch only; no merge, deployment or human sonic acceptance.**

## Owner direction vs engineering choices

Marvin's canonical owner directive (local GBrain
`projects/truevox-bitstreambluffs/audio-stem-graph/reactive-accompaniment`)
is that ALL THREE **original** accompaniment families **guitar, piano and
Other** progressively darken/distort/tremolo as the **real physical BSOD
gap closes** and return clean on escape. These effects are *not* sled speed
or wind: bass keeps its independent velocity response, drums keep their
airborne/landing response, vocals and biome melody remain intact. Only one
accompaniment family per song receives replacement biome recordings; the
other two stay original, but all three original families respond to danger.

The exact danger curve/FX amounts below are **Gal Friday's provisional
engineering audition settings**, not owner-approved listening values.
No claim is made that the effects sound musically good yet.

## Implementation

- Consume the existing nine-field `EVT.BSOD_STATE_CHANGED` payload.
  `AudioSynth._onBsodState` forwards its authoritative `proximity01` to
  the same `StemMusicDirector` running the single current song. There is
  no chase simulator, local threat clock, alternate playback director or
  calculated proximity from sled speed. Signed `relativeAirX` still drives
  the independent wind bus, not this effect. Vacuum wind may be zero but
  physical BSOD danger remains relevant to music.
- The source-only `BsodThreatProcessor` is allocated once per original
  guitar, piano and Other mixer bus. It routes the current original audio
  after normal biome effects through a **dry path** and a smooth **processed
  path** (waveshaping, lowpass darkening and low-depth LFO tremolo).
  A bounded normalized danger ramps the processed portion up to 84%,
  lowers the wet cutoff toward 2.2 kHz and strengthens tremolo near contact.
- All modulation uses smoothed native `AudioParam` updates and a 0.025
  change deadband. No WebAudio graph reconstruction, timers, decode, buffer
  re-render, song seek, note replacement, tempo shift or pitch transposition
  happens for each BSOD proximity sample. Existing biome FX *replacement*
  crossfades still route through the same permanent processor.
- Only guitar/piano/Other buses have threat nodes. Bass, ground/air drums,
  Maxi vocals, every melodic voice, environmental wind, UI/SFX, the audio
  master and other adaptive sources remain separate. The original five
  source stems and all 4,745 Ogg clips are untouched.
- When the player escapes, source attack integrity and clean original mix
  return using a smoothed fade. In Title/Pause/GameOver, danger is forced
  to zero, even if stale BSOD events arrive, and Debumont's menu melody
  with neutral accompaniment resumes on the **same song clock**. This
  honors the session rule: One More Run once at page load, never on death.
- Dynamic Orchestra OFF still means *original recordings with normal DSP*.
  BSOD threat is original-source DSP, not a replacement instrument, so it
  does not depend on Dynamic Orchestra being ON or the user's vocals unlock.

## Verification and release boundary

- Pure/fixture tests cover bounded monotonic danger, clean distant states,
  stronger darkening at near contact, exact dry restoration after escape,
  original three-family routing, no drums/bass/voice treatment, preserving
  the processor across standard biome `replaceEffects()`, one-time LFO
  disposal and active-mode/menu mode switching without clock loss.
- An actual Chromium + real source Ogg/WebAudio smoke on isolated `:8202`
  tests One More Run opening and original-source processors, authoritative
  event with **wind at zero while danger 0.97 corrupts music**, clean
  escape despite wind sound, vacuum with danger but no wind sound,
  crash returning to Debumont and uncorrupted accompaniments, and no
  page exceptions or missing music assets. This is functional DSP testing,
  **not human-approved sound quality**.
- Research branch `feature/music-bsod-corruption-20261118`, built on
  music-continuous feature commit `92fdb57`, which itself includes Control
  Friday's combined BSOD/audio integration. This branch must not be
  independently merged onto old main without that full event contract.
  No gameplay, physics, key mappings, balance, Music Lab, note inspector,
  review queue, song scores, or original sound assets are modified.

**Completed functional gate:** combined source suite 129/129 and 2,196/2,196 tests; isolated Vite production build PASS; eight real Chromium sound workflows PASS, including new danger-specific browser smoke, natural song rollover, session/shuffle persistence, three-screen jukebox, in-game Sound Lab, score inspector, source review queue and vocals/shard purchase. The audio was not listened to or personally approved by Marvin. No playable production deployment was performed.

**Update — real-source loudness correction:** later headroom measurements on shipped Oggs exposed a severe unintentional +5.6 to +11.4 dB near-danger average-gain boost in the first waveshaper. The proposed calibration now uses controlled saturation makeup and gentle mid-danger compensation, with an auditable 36-passage real-source WebAudio loudness/headroom gate. Full evidence, exact fixed thresholds and remaining limitations: `docs/MUSIC-BSOD-REAL-OGG-HEADROOM-GATE-20261118.md`. This changes audio processing only, not the gameplay BSOD signal.

Future ear-validation: compare real four-song excerpts at several danger
levels in actual in-game music engine; pay special attention to hard
harmonic transients, gain headroom, and low instrument activity. The older
standalone lab remains SOUND DESIGN ONLY, never transcription verification.
