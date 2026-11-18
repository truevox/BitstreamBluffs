# Music Friday → Control Friday: fatal-crash vinyl stop, original-drum count-in, full-band return

**November 18, 2026 — Music-owned research implementation.** This work is on `feature/music-fatal-countin-20261118`, directly descended from the current integrated six-stem/vinyl branch `9abb3f7`. It also incorporates Control Friday's fatal event/fault isolation commits `1000852` and `afeff56` (locally cherry-picked as `55a4c65` and `ee83979`). Music-specific files are implemented on top; see the music commit in this branch. **Marvin approved implementation NOW, superseding his earlier hold.** Deployment and human listening are still separately gated; no merge to `main`.

## Exact gameplay/audio contract

Control emits the **single existing** crash event before its matching run-end:

```js
EVT.CRASH, {fatal:true,negated:false,runId:'<current-run>',cause,...}
EVT.RUN_END, {record:{id:'<same-run>',cause:'crash',...},biomeVisits}
// Shielded, nonfatal:
EVT.CRASH, {fatal:false,negated:true,runId:'<current-run>',cause,...}
// Gym catch: EVT.GYM_ATTEMPT_RESET; NO fatal CRASH or RUN_END.
// Immediate retry: EVT.RUN_START, {runId:'<new-run>',gym:false,...}
```

`AudioSynth._onFatalCrashMusic(payload)` **requires** `fatal===true`, `negated===false`, a nonblank string `runId`, an actual currently audible/playing original source stem transport, and no manual-pause session. A stale/legacy `negated:false` event without `fatal:true` and `runId` cannot start a count-in. Duplicate fatal events for the **same run** are ignored. A *later genuinely fatal crash* with a different run identity supersedes older effects without stacking two scratches or two drum count-ins.

The controlling original song's **`StemMusicDirector` instance, track identity, playback token, audio-context clock anchor, transport position and source decoder** all remain intact. Nothing calls `transportPause()`, `transportPlay()`, `stopMusic()`, or `seekTo()` on fatal death. The existing `RUN_END` enters the Game Over arrangement **without canceling the fatal scratch**; `RUN_START` on immediate retry deliberately leaves the existing recovery plan alone. The count-in keeps unfolding independently of game/menu/score/initials/shop scenes, and it **never delays physics, UI, Game Over or retry**. No second playlist, background song player, sampled copyrighted record scratch or new source recordings.

## Current four-step WebAudio arrangement

| AudioContext-relative time | Arrangement | Implementation |
| --- | --- | --- |
| `T` to `T+0.205 s` | Descending short vinyl scratch | Existing shared `TurntableScratch.play('pause')` on music bus |
| `T+0.205` to `T+1.205 s` | **2 silent research pulses** | New per-source recovery gain sits BEFORE source motion, adaptive/source fade and room sends; all normal band/voice inputs gated off |
| `T+1.205`, `+1.705`, `+2.205`, `+2.705 s` | **Exactly four 140 ms original drum accents** | Four separate **short excerpts from the already decoded original `drums.ogg` AudioBuffer**, routed back into the SAME music mixer via `countInInput`; originals advance silently behind gates |
| `T+3.205 s` | Full band returns | Same preexisting source nodes and WebAudio clock; original stems automatically ramp to 1 over ~55 ms on a common gate |

This timing is **SYNTHETIC / UNVERIFIED**: `0.500 s per provisional pulse` and two silent pulses are **only one testable research configuration**. `planFatalCountIn` refuses any `timingKind` that pretends to be source-verified. Neither this feature nor these numbers appear as trusted pulse frames in `RELEASE_BEAT_GRIDS`; the existing BSOD Gym read-only timing API **fails closed** during death recovery with reason `fatal-recovery-grid-unverified`, and previously issued Gym timing advice becomes invalid while that recovery is active. *One More Run*'s apparent ~81 vs ~161 BPM half/double-time interpretation remains unresolved. The right song-specific, listener-perceived musical quarter notes, transitions, accents, source hashes and independent human spot-checks are a **release blocker** for beat-synchronized deployment. Do not claim current accents are aligned to the recording's beat.

**Original-drum source identity:** To avoid pretending the band's original drum stem necessarily has exactly four evenly spaced strikes at the death instant, a bounded source onset search selects a **loud short transient from the actual already-decoded original drum stem**. It then schedules **four short copies** of that same authentic excerpt, so four strikes exist even during a drumless intro. No synthetic drum sound or replacement drum recording is generated. If an audible original drum excerpt is missing, fail safely to the game's continuous soundtrack instead of silently suppressing the music. The original decoder/cache's `_fetchSource` can warm a later original drum segment when an entire initial segment lacks a usable excerpt; only that existing track/source is fetched, without a second song player. The source accent selection is an engineering **transient heuristic**, not a beat detector, and the repeated hit may sound mechanical until auditioned.

Source-bound original-OGG four-song browser QA documented the selected original drum excerpts:

| Shipped song / original first drum segment SHA-256 | Original excerpt offset | Notes |
| --- | ---: | --- |
| `One More Run`, `0040ca6cfa771eab0a57593daedcbe72aeee40b7c858e5933bfc23bd0876416b` | ~3.039 s | Genuine fatal BSOD game test plus measured audio-output QA |
| `Every Hacker`, `369e8f47d80716f2581cbe60cda2089e2ec39c3f2a35f5f87c312ecc8abbb03c` | ~8.960 s | First 8 seconds nearly drumless, but an authentic source hit exists later in original segment 0 |
| `Varmont Is Saved`, `dde8c1ecca31beccccdaf04d19f9ad442613d46fd69d806065911da5ad47630f` | ~8.939 s | Audible original source transient |
| `Pope Leo Wants the AI Root Password`, `797e21cc277bc673f0b5f6a3f9b7883cb77864e2d50ce00204c2556304c09ceb` | ~0.855 s | Audible original source transient |

The hashes above identify **individual first 12-second original drum OGG segment files**, NOT the complete six-stem song masters or vetted beat grids. No audio assets or existing score notes were modified by this feature. All four song source identities in the browser remain unchanged through the synthetic death sequence.

## Precedence / cancellation

- **Manual Pause:** the existing manual `GAME_PAUSE` tokenized handler cancels this automatic count-in first, then uses its separate tested pause/resume turntable effect and source-frame-accurate transport freeze. Never confuse manual vinyl with death vinyl.
- **Explicit jukebox Play, Pause or Skip, including during Game Over / PauseScene:** the user's decision cancels death count-in, restores normal source gains, and is authoritative. Changing track cancels any stale old-song count-in; old async audio cannot replay the previous recording.
- **Music mute / all songs off / audio unavailable:** cancel pending accents, recover original source gains; no scratch when the soundtrack was inaudible. The existing volume/master bus still governs all scheduled drum accents and scratch.
- **Second fatal crash from a later run:** cancel the older count-in, then start the replacement once (if a usable source exists). Never stack or repeat an effect for the same run ID.
- **AudioContext suspension:** WebAudio time and original transport naturally freeze with the context; no wall-clock catch-up or resynchronization of the physical game is attempted. If source/context unavailable at crash, fail safely to original continuous music.
- **Normal gameplay, `RUN_END`, `RUN_START`, Game Over, initials and Shop:** carry current plan across; no start, stop, or clock reset. Ordinary `RUN_ABORT` (quit/restart intent) cancels pending recovery rather than treating quit as a fatal crash.

## Objective QA, scope and handoff

- Unit tests: `tests/src/fatal-crash-countin.test.js` covers synthetic timeline, 1–3 silent-pulse parameters, rejection of fake release verification, actual original drum source extraction, four scheduled WebAudio one-shots, source transport invariants, missing-source fallback, second-crash supersession, strict `fatal/runId` contract, duplicate-event guard, immediate retry, manual pause and jukebox. Existing vinyl/Gym/music tests must remain green.
- **Real Matter/Chromium/OGG fatal crash**: `tools/music/smoke-fatal-crash-countin-original-ogg.mjs`. Verifies actual BSOD collision, exactly one fatal/release pair, no manual pause event, 4 source accents, scratch, silence, four-drum interval, retry preserving original source/clock/token/count-in generation, full band return at the same original song time. This test does not simply emit a fake crash.
- **Control Friday gameplay contract**: `tools/fatal-death-countin-gameplay-contract-browser-smoke.mjs`: shield save, real fatal BSOD, Game Over, immediate retry new run ID, Gym collision, and a purposely throwing crash observer. Control's run record finalizes despite audio observer failure.
- **Four real original songs**: `tools/music/smoke-fatal-countin-four-songs-ogg.mjs`: source-identity/clock checks for other three songs and first `One More Run` fatal crash; ensures 4 authentic drum excerpts, muted-music cancellation, partial silent-intro handling, no second music transport.
- **Actual rendered PCM**: `tools/music/audit-fatal-countin-real-webaudio.mjs` taps the existing music bus in headless real Chromium and measures real waveform RMS, not merely node scheduling. On original `One More Run` test: scratch RMS ~0.0101, silence RMS ~`7.5e-8`, four consecutive source drum pulses RMS ~0.054–0.056, and same original full band restored to RMS ~0.0376 at the research tempo. It verifies four audible hits above silence and no stuck silent band. This is **not** a subjective listening approval or final mastering/true-peak certification.
- The feature branch is built directly over Control's two published event-contract commits; **Control Friday can cherry-pick the final MUSIC commit only** onto her gameplay branch (those gameplay changes already exist there). She owns final branch integration and gameplay/audio cross-tests. No `main` merge or deployment by Music Friday.

**Next musical-review blocker:** source-hash-bound, section-aware listener-perceived **quarter-note** beat grids across all four songs, including *One More Run* 81/161 BPM ambiguity, independently reviewed actual original drum accents and possible more natural 4-hit variations. Preserve the synthetic case as a test fixture until approval. Marvin's ears can review the scratch/count-in character later; do not claim a final approved musical mix before that review.
