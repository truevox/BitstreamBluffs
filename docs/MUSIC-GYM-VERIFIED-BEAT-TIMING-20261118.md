# Music Friday → Control Friday: BSOD Gym beat-aligned release handoff

Date: 2026-11-18 · Source branch `feature/music-gym-beat-grid-20261118` · Owner contract: Control Friday's `docs/GYM-MUSIC-BEAT-HANDOFF.md` (feature/faithful-void-gym-20261118, 9221e99).

## Music contract: 1-second READY, at most 300 ms beat extension

**Control owns all physics and the one-second READY timer.** Only *after* its minimum READY period should it call the public `AudioSynth.getBeatTiming({maxWaitMs:300,expectedRevision:null})`. The result is a frozen, read-only snapshot:

**Trusted:**

```js
{
  trusted:true, release:'on-beat',
  trackId:'...', transportRevision:'<generation>:<trackId>:<clockStart>',
  gridVersion:'source-verified-v1',confidence:0.96,
  beatFrame:6720,beatSeconds:0.14,
  audioContextTime:24.4,dueAudioTime:24.57,waitMs:170
}
```

`beatFrame` and `beatSeconds` refer to the **original recording**, not a bar or generated synth clock; `audioContextTime` and `dueAudioTime` are absolute seconds on the **same actual WebAudio clock**, from this exact player. Wait using the existing gameplay timer, never using music to step physics. Never schedule beyond `min(result.waitMs, 300)`.

**Untrusted:** `{trusted:false,release:'immediate',reason:'...'}`. **GO immediately after READY**, no hold, no fallback tempo. Methods never throw to gameplay.

Immediately before releasing after an actual optional beat wait, call `audio.isBeatTimingCurrent(snapshot)`; if it returns false, **GO immediately**, not start another musical wait. This guards against song skip, seek, death, pause, muted music, suspended context and late timer ticks. A stale generation cannot authorize a launch even if the track title remains identical.

Recommended approximate integration (in Control Friday's Gym code, NOT done by Music Friday):

```js
// Called once when Gym's own minimum READY (1000ms) has elapsed.
let timing;
try { timing = audio?.getBeatTiming?.({maxWaitMs:300}); }
catch { timing = null; }
if (!timing?.trusted || timing.waitMs <= 0) return releaseNow();
// On reset/exit, cancel this one remaining timer with Gym's own lifecycle.
// Never restart READY or requery for a different beat during that attempt.
scheduleGymOnlyTimer(Math.min(300,timing.waitMs), () => {
  // Invalid/late beats do not block the launch; currentness is advisory.
  try { audio?.isBeatTimingCurrent?.(timing); } catch {}
  releaseNow();
});
```

The currentness check can distinguish a true synchronized release for analytics, but MUST NOT gate `releaseNow()` again. If a pending timer is canceled due to Gym reset or exit, the normal Gym state machine controls that reset. Avoid wall-clock assumptions that `AudioContext.currentTime` advances while suspended. Beat lookup never calls `play()`, `seekTo()`, `unlock()` or creates a new audio context.

## Current shipped beat-grid status: **unverified**

The game currently has four soundtrack recordings (One More Run, Pope Leo Wants the AI Root Password, Every Hacker (Runs Out of Code) Part 2, Varmont Is Saved). Every released `performance.json` has `clock.beats=[]`, and the pack manifests contain no verified tempo. The old `StemMusicDirector.nextBeat()` assumes BPM with zero phase and is **NOT** called by this Gym API.

`src/systems/music/BeatGridCatalog.js` marks each actual track `unverified` (zero confidence, pending checks). This is deliberate. **Until per-recording quarter-note pulse frames have an independently checked phase, the real Gym MUST always use normal immediate release after one second.** A model's autocorrelation candidate cannot automatically become a `verified` grid.

`src/systems/music/BeatGridTiming.js` validates source ID, sample rate, total frames, 64-hex source provenance field, format version, overall confidence ≥0.90, explicit dual-review status, full coverage by nonoverlapping sections, ordered pulse frames and reasonable spacing. It supports multiple variable-tempo sections, plus `uncertain` sections which contain **no approved pulses**; it never extrapolates pulses across gaps, section boundaries or the end of recording. It also imposes an absolute 300ms maximum wait. A timing snapshot is rejected if music is off/muted, playing transport unavailable, paused, or suspended, track/recording/revision changes, current source buffer is still loading, or no trusted pulse is imminent.

**Provenance caution:** The format's `sourceSha256` is a declared review provenance field, not yet a verified runtime cryptographic fingerprint of the original audio file. Before marking any real grid `verified`, the review process MUST derive/confirm the original source recording identity and durable pack provenance. Handwritten `humanSpotCheck:'passed'` flags without independent accountable evidence DO NOT count as validation, even though the pure format validator permits test fixtures to exercise that state.

## Offline source-stem candidate study (NOT musical approval)

Reproducible Python/FFmpeg research script: `tools/music/research_gym_beat_candidates.py`; requires `uv run --no-project --with numpy --with scipy python tools/music/research_gym_beat_candidates.py --out <new-report-path>`. It inspects separate drums and bass recordings in three ~11.5-second regions (opening, middle, late) of each of the 4 songs, computes short-energy/onset signals, lag autocorrelation and candidate phases. Raw source paths are read only; no recording changes or committed beat-grid promotion.

Immutable report on CT223 `/home/hermes/experiments/bitstream-gym-beat-candidate-research-20261118.json`, SHA-256 **`d27ca248b38be88d3a70bb804160d5211081641d7e3c9b87399c093a3f5a9c4d`**.

Indicative *detector hypotheses* at the first/mid/late windows (drum stem's top autocorrelation BPM, **not proven quarter-note tempo**):

| Recording | Early | Middle | Late | Interpretation |
|---|---:|---:|---:|---|
| One More Run | 162.53 | 162.53 | 162.53 | Repeated drum periodicity; bass favors 81.27 BPM early, so half/double-time not established |
| Pope Leo Wants the AI Root Password | 58.38 | 146.67 | 146.67 | Weak/ambiguous opening, stronger stable late percussion but divergent early drums vs bass |
| Every Hacker (Runs Out of Code) Part 2 | 167.05 | 139.85 | 143.18 | Candidate changes; opening vs later tempo may be musical or detector error |
| Varmont Is Saved | 80.18 | 107.39 | 107.39 | Bass/drum disagreement and half-time candidates; no accepted meter/phase |

None of those period peaks proves a regular quarter note instead of an upbeat, half-time groove, syncopation or percussion artifact. Additional phase-alignment analysis, independent beat-induction methods, source-reconstruction inspection and **musical spot-checks** are needed before approving per-song grid sections.

## Validation, tests and ownership

`tests/src/music-gym-beat-timing.test.js` covers forged/missing metadata, explicit phase beginning/middle/end (frame exact), variable-tempo section, uncertain sections, 300ms hard limit, stale transport revision, seek/reentry, mute/silence, unavailable context, pause/suspension, and stop/fallback. All shipped track grids reject authorization until verified.

`tools/music/smoke-gym-beat-timing.mjs` uses the **real built game in Chromium**: genuine user-gesture title music, an actual original One More Run OGG playback, seeks at beginning/middle/near end, unavailable/muted/paused/suspended fallback, actual mid-READY jukebox skip, and the real `AudioContext.currentTime` phase. For positive timing-path tests only, it injects a clearly labelled **TEST_ONLY_FAKE_GRID_DO_NOT_SHIP** synthetic grid inside the disposable QA browser page. **This checks API integration with real playing audio; it is NOT validation of the song's musical beats.** The committed release catalog is never modified.

Source files changed are confined to music-owned `src/systems/music/BeatGridTiming.js`, `BeatGridCatalog.js`, `src/systems/AudioSynth.js` public service only, music tests, research and this handoff. No Control Friday Gym gameplay, input mapping, BSOD wall physics, wind, soundtrack, saved settings or production deployment changed. Separate music feature; Control Friday can cherry-pick after reviewing the public API. Keep existing user rules: Gym 5-Bluffs hidden unlock only in one uninterrupted Gym flight; no gameplay modifications from this music handoff.
