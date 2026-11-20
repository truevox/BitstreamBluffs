# Cosmetic-only synthetic beat and downbeat — API handoff

**November 19, 2026 — Music Friday.** Owner requested adapting the **already-existing artificial 0.5-second crash count-in beat** to expose the **start of fake 4/4 measures**, merge that safe additive interface to `main`, then investigate genuine source downbeat detection separately. This work is the synthetic stage; **no one has verified the true bar-one position in any original song.**

## What the existing fake pulse actually was

`src/systems/music/FatalCrashCountIn.js` previously used **0.5 seconds per artificial count-in beat**: two silent slots followed by four drum accents cut from an original OGG stem. It was **not a whole-song beat API**. `AudioSynth.getBeatTiming()` continues to require a trusted, independently human-verified source grid and fails closed for every released song. World Dance currently reacts to actual OGG energy, not to this fake clock.

## New additive read-only API

`AudioSynth.getSyntheticMeterTiming()` returns a frozen source-clock snapshot when an original track is actively running and audible, otherwise `null`. It assumes **half-second beats**, **four per measure**, fake measure 0 beginning at **original recording source time 0.000 seconds**. These are arbitrary musical assumptions, not inferred downbeats or an endorsed tempo/time signature.

Example at actual song position **2.03 seconds**, assuming WebAudio `clockStart=10.000`:

```js
{
  trusted: false,
  timingKind: 'synthetic-unverified',
  use: 'cosmetic-only',
  canAuthorizeGameplay: false,
  assumedMeter: '4/4-synthetic',
  beatSeconds: 0.5,
  beatsPerMeasure: 4,
  measureSeconds: 2,
  sourceTimeSeconds: 2.03,
  beatIndex: 4,             // zero-based, globally within this original song
  beatInMeasure: 1,         // one-based: 1, 2, 3, 4
  measureIndex: 1,          // zero-based, starting at song t=0
  isMeasureStartBeat: true, // true throughout the first artificial beat
  atMeasureStart: true,     // only near the first 50ms after a bar boundary
  beatStartSeconds: 2,
  measureStartSeconds: 2,
  nextBeatSeconds: 2.5,
  nextMeasureStartSeconds: 4,
  beatStartAudioTime: 12,
  measureStartAudioTime: 12,
  nextBeatAudioTime: 12.5,
  nextMeasureStartAudioTime: 14,
  trackId: '<current original track ID>',
  transportRevision: '<_token>:<track ID>:<clockStart>',
  audioContextTime: 12.03,
}
```

Read each animation tick if needed; **trigger exactly once when `(transportRevision, measureIndex)` changes**, and react to `(transportRevision, beatIndex)` to detect artificial quarter-note pulses. `isMeasureStartBeat` describes which beat you're in, not a one-frame event; do not fire repeatedly while it stays true. In a shorter visual treatment, `atMeasureStart` is a convenience window, not a scheduling guarantee. The WebAudio clock tracks the actual original recording and survives transport bookkeeping; it isn't another player or JS timer. When the jukebox seeks/switches tracks, the `transportRevision` changes and consumers must reset their event guard.

The new access method fails closed to `null` on unavailable/unstarted/paused, muted, disabled, loading/unsupported, manual vinyl pause/resume, fatal crash count-in, non-run menu mode, beyond-source duration and destroyed contexts. It **must not** be used for scoring, physics, Gym release, collision, jumps, achievements, beat-qualified rewards or official leaderboards. Its meter identity and zero source-confidence explicitly prevent accidental trust promotion.

The fatal-crash planner additionally exposes `beatInMeasure:[1,2,3,4]`, `measureStartOnsets:[drumsStart]`, a four-beat measure duration, and `syntheticMeterOrigin:'count-in-first-drum'`. **That crash-only artificial bar origin is not aligned with the song-wide t=0 artificial origin.** Existing scratch, silence, four drum sounds and band-return times did not change.

## Who uses it and what isn't shipped

This commit exposes the information; it **does not modify World Dance** or automatically animate on these fake beats. Control Friday may opt into its own purely visual beat-one emphasis, gated by the already-existing World Dance and Reduce Motion controls. Avoid simultaneous animation triggers from both OGG energy and synthetic bar flags without a clear blend decision. Do not add a separate audio decoder, music timer or gain node.

**Future, separate research:** detect true quarter-note pulse phase, downbeat/measure markers, meter changes, phrase starts, and section boundaries from actual original recorded stems. Output candidate source-bound timestamp maps tagged `unverified` and include manual review. Do not overwrite `RELEASE_BEAT_GRIDS` or rebrand synthetic source t=0 bars as actual song bar one. Music Friday owns that research and will coordinate handoff after this safe synthetic API is merged.

## Automated gate

New `tests/src/music-synthetic-meter.test.js` exercises half-second/4-beat boundaries, measure 1 start and following bars, floating boundaries, arbitrary transport revisions and seek clock changes, missing/paused/muted/fatal/disabled source, invalid meter math, and prevention of verified Gym release. Existing `tests/src/music-gym-beat-timing.test.js`, `tests/src/fatal-crash-countin.test.js` continue to pass. Source contract documented at `src/ARCHITECTURE.md`. No source OGG, performance scores, original beat-grid catalog, scene/physics, saved settings, music graph or deployed visuals are modified by this addition.
