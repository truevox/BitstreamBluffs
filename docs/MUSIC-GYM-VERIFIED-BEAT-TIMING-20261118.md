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

## November 18 follow-up: whole-recording phase analysis (still NOT trusted)

The first candidate study sampled three passages per song. Music Friday subsequently expanded `research_gym_beat_candidates.py --all-segments` to **all 65 original pack segments** (18 Pope, 17 Every Hacker, 15 Varmont, 15 One More Run) and **both independent drums/bass separated stems**, recording each audio file SHA-256. This is 130 per-source research windows, not whole-song musical annotation. Immutable report `/home/hermes/experiments/bitstream-gym-beat-full-segment-research-20261118.json` SHA-256 **`df44512eac4a3f3361ef319691476fdbde9c6fe2ba8a5daf5e668ba62526258f`**.

The top *drum-stem autocorrelation* category was 162.53 BPM in 12/15 One More Run windows, 139.85 BPM in 12/17 Every Hacker windows, 107.39 BPM in 10/15 Varmont windows, and 146.67 BPM in only 7/18 Pope windows. But the detected *phase* from those same segments drifted badly: simply chaining those raw BPM estimates across a song would introduce quantized tempo errors and pick the wrong pulse during syncopation or pickups. None of these is a trusted Gym grid.

A **second, independent signal-processing hypothesis** was then generated by new `tools/music/research_gym_phase_coherence.py`. It reconstructs an absolute-source-seconds onset envelope across consecutive drum OGG segments, scans global Fourier periodicities, and measures per-segment complex-phase vector coherence and first-half/second-half phase disagreement. It remains a non-metrical rhythmic *attack-train* measurement. Immutable report `/home/hermes/experiments/bitstream-gym-global-phase-coherence-20261118.json` SHA-256 **`a15554bd478a843ca522bd2b39f9a281ebf61839e6d0eda178c0a75e67584950`**.

| Song | Strongest whole-recording percussion periodicity | Local phase coherence | Important ambiguity |
|---|---:|---:|---|
| One More Run | **163.839 BPM** | 0.8421 | The three-window detector was quantized to 162.53; another competing periodicity at 122.822 has coherence 0.8262 |
| Every Hacker | **140.130 BPM** | 0.6750 | Multiple detected rates 139–143, with drifting/weak sections |
| Varmont Is Saved | **201.254 BPM** | 0.9559 | 201.254 is likely a rhythmic subdivision; strong 120.757 and 160.983 periodicities coexist, so beat identity is unresolved |
| Pope Leo Wants the AI Root Password | **183.923 BPM** | 0.6953 | Other strong peaks at 110.296 and 147.173; unclear meter and section changes |

**These are explicitly NOT verified tempos.** A high phase-coherence figure can belong to percussion subdivisions, hi-hats, ostinato or a non-quarter-note musical accent. It cannot independently prove the human-perceived regular quarter pulse or whether a chorus intentionally changes tempo. Source stem separation may also distort attacks. We should focus independent source-listening/visual beat alignment on One More Run first, then Every Hacker; maintain invalid sections wherever independent checks disagree. No guessed beat files were added to `public/music`, and every released `BeatGridCatalog` entry remains unverified.

Reproduce research via:

```bash
uv run --no-project --with numpy --with scipy python tools/music/research_gym_beat_candidates.py --all-segments --out /home/hermes/experiments/<unique-name>.json
uv run --no-project --with numpy --with scipy python tools/music/research_gym_phase_coherence.py --out /home/hermes/experiments/<unique-name>.json
```

The tools refuse to overwrite evidence. For future production grid approval, derive exact source-frame pulse positions, validate the metrical identity/section boundaries with independent methods and human spot checks, then verify durable original-recording provenance. Under no circumstances should these research FFT phases be copied directly into the production catalog as `verified`.

## November 18: portable eight-window visual review and two-reviewer gate

The exact original WAV, drums, bass and independent beat-tracker hypotheses
are now available as **offline visual evidence** in
[`docs/music-review/README.md`](./music-review/README.md). The self-contained
HTML is [`one-more-run-timestamped-onsets-20261118.html`](./music-review/one-more-run-timestamped-onsets-20261118.html), with eight original-source time ranges, separate WAV/drums/bass onset lanes, and **unverified** 81/161 BPM tempo-hypothesis ticks. A read-only source hashing and regeneration check produced identical HTML bytes; no audio recording is bundled.

`tools/music/compile_gym_quarter_note_reviews.py` prepares two independently
completed, source-bound annotation files and checks exact original WAV/pack
hashes, regular quarter-note identity, source-frame pulse coverage,
confidence >=0.90 and **<=45ms** agreement between the two reviewers.
Where there is disagreement it returns an **uncertain** section without
candidate pulses. Crucially its output is intentionally **not** in the runtime
beat-grid format; even two agreeing reviewers cannot silently make the Gym
wait for an unapproved beat. Blank templates and source JSON evidence are
portable in `docs/music-review/`. Human reviews and final explicit promotion
remain **NOT DONE**; the real released soundtrack remains fail-closed.
