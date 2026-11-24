# Fatal-crash scratch → silence → four drum beats → full band: implementation approved

Recorded: 2026-11-18. Source: Marvin's discussion with Music Friday,
relayed to Control Friday in the same day's project coordination.

**Current status (superseding clarification, November 18, 2026): Marvin explicitly WANTS THIS IMPLEMENTED.** This affirmative instruction supersedes the earlier temporary "don't implement this yet" hold. Music Friday owns the death-sequence audio/music implementation; Control Friday owns event and lifecycle integration, QA and the separate integration branch. **Not implemented in the reviewed code as of this update.** The independently completed manual **PAUSE/RESUME** vinyl feature is not the fatal-death sequence.

**Decision history:** The prior status was "design approved, implementation on hold" while the manual vinyl feature was being finished. That previous hold was real *at the time*, but is no longer the controlling instruction. Preserve this chronology; do not present it as Marvin's current preference. Authorization to implement is **not** authorization to mark unreviewed beat grids verified, merge into `main`, or deploy without validation.

## Decision (Marvin)

For a **fatal crash/Game Over**, the favored future music scene is:

1. Short vinyl scratch / dramatic record interruption.
2. A short silence lasting approximately **one to three actual musical beats**.
3. **Four beats of drums alone**, using the already playing song's drum stem.
4. The rest of the **same recording** rejoins together on a musically correct cue.

**No part of this sequence delays any UI, physics, retry, score count-up,
initials entry, or shop access.** The musical transition is independent of
play-state navigation. A player who instantly starts the next run should hear
the existing count-in carry straight across the scene transition, then the
full band return when its cue arrives. No second player, duplicated audio
streams, resetting the song, or another crash scratch on retry.

The four drum beats refer to **listener-perceived regular pulse**, not
unverified detected onsets, offbeats, a guessed BPM, or necessarily beat one
of a measure. Music Friday's independent source-bound beat-grid verification
is a prerequisite to a real music-synchronized design. The `~81` vs `~161`
BPM half-time/double-time interpretation of *One More Run* remains open;
no synthetic or machine-proposed grid should be marked release-verified.

## Lifecycle and user experience to preserve

The normal crash animation is ~950ms before Game Over. Score animation,
qualified initials entry, and possibly a shop prompt can occupy several more
seconds, so a sequence lasting several seconds can accompany those screens.
Nevertheless, immediate retry is possible. Therefore **audio must not own
or block the death-to-retry timeline**, and the sequence may finish in the
next live run. A second fatal crash while an earlier count-in is pending,
manual Pause/Resume, user jukebox choices, mute, track changes, or a suspended
audio context need a carefully defined precedence policy *during*
implementation. Music Friday should propose and test those rules without
blocking the approved feature on additional gameplay questions.

## Historical pre-implementation baseline (superseded by integrated commit)

At this earlier stage, the reviewed build preserved the **continuous soundtrack**
across death, Game Over, menus, and retries, using the existing
`_enterMenuMusic()` and `_enterRunMusic()` contracts. The approved fatal-crash
sequence should *modify the musical arrangement on that same uninterrupted
transport* while it runs, never reset/recreate the song. Fatal crashes do not
emit `GAME_PAUSE`, and this sequence must not use the intentional manual-pause
state machine. The separate manual-pause feature can ship independently.

## Later listening / A-B gate

The earlier research options remain useful: (A) uninterrupted music,
(B) brief crash-scratch accent with no stop, (C) full scratch/silence/drums/
band recovery. Test across several rapid fatal crashes, immediate retries,
short Game Over visits, long initials/shop visits, and tracks with ambiguous
or changing pulse. Record subjective preference and frame/music timing before
promoting option C. Implementation is now explicitly approved; **release remains gated on
regression tests, source/pulse confidence, and human listening**.

**Provenance:** Marvin proposed the crash scratch + 1–3 silent beats + four
drum-only beats + band return; Marvin explicitly approved carrying the
count-in into an immediate retry. Music Friday supplied pacing/implementation
analysis and suggested reusing the same stems. This original decision record did not claim implementation at the time;
the subsequently completed, tested branch integration is documented below.
There has still been no production deployment.

## Control Friday's death-event contract (isolated branch, November 18)

The existing global `EVT.CRASH` signal now carries **additive**, unambiguous
`runId` and `fatal` fields. It remains **exactly one original event name**,
not a new soundtrack transport event:

```js
// A saved collision, continuing the same run:
EVT.CRASH, {negated:true, fatal:false, runId:'<current-run>', /* prior fields */}
// Genuine run-ending death:
EVT.CRASH, {negated:false, fatal:true, runId:'<current-run>', /* prior fields */}
EVT.RUN_END, {record:{id:'<same-run>',cause:'crash', /* existing record */}, biomeVisits}
// Later, on immediate retry, a new run is allowed immediately:
EVT.RUN_START, {runId:'<different-run>',gym:false, /* existing fields */}
```

**Ordering:** on a genuine fatal collision, `CRASH` fires once **before**
`RUN_END`. After approximately 950ms of crash animation the Game Over screen
opens; the user can retry immediately, producing a fresh `RUN_START` with a
different run identity. Game Over and the next `RUN_START` must **not** cancel,
restart, or rewind the audio count-in. Music must not wait for Game Over to
begin its sequence or depend on a UI timer. No new score/ledger fields are
added by this change; the original `RunRecord`/ledger hash is untouched.

**Exclusions:** an absorbed shield hit emits `CRASH {negated:true,fatal:false}`
and **no** `RUN_END`; a non-ranked Gym BSOD catch emits
`EVT.GYM_ATTEMPT_RESET` and emits neither `EVT.CRASH` nor `EVT.RUN_END`.
Manual Shift respawns, intentional Pause/Resume, restart/quit, and ordinary
menu navigation also do not emit a fatal crash. Music Friday may bind the
state machine to `CRASH {fatal:true,runId}` and use `RUN_END` as supporting
identity, not as a competing second scratch trigger.

**Control browser regression:**
`tools/fatal-death-countin-gameplay-contract-browser-smoke.mjs` validates
shield impact, an actual fatal BSOD physics collision, the real crash-to-
GameOver transition, immediate scene retry, a new `runId`, and a real Gym
reset. This is a **gameplay event test**, not an audible assertion that the
new musical audio itself works. The subsequent real-OGG browser integration
tests described below separately prove the musical stages and cross-run carry.

**Fault isolation:** `RunScene` catches exceptions from synchronous
`EVT.CRASH` observers so record finalization and `RUN_END` still execute.
Music Friday's optional count-in listener should independently contain its
own exceptions; a throwing EventEmitter handler may prevent other listeners
from receiving that same event. The Control browser smoke injects an audio
observer failure and proves a fatal record still completes.

### Verified integration gate — actual Game Over retry, not a simulated event

Control's `tools/fatal-death-countin-real-retry-audio-browser-smoke.mjs`
**PASSED** against the integrated Music Friday `bfd7778` code, cherry-picked
as `e3d88a9` onto the isolated combined branch. The old pending status
was accurate before integration but is now superseded. The integrated code
contains `getFatalCountInStatus()` and the original-OGG drum controller.
The script plays the actual original six-stem OGG, causes a genuine fatal
Matter/BSOD collision, waits through the real `GameOverScene`, invokes
`GameOverScene.retry()`, and verifies the next live `RunScene` uses a different
`runId` while the **same recovery generation, four original drum cues, song,
clock anchor and transport token** continue. It then observes the full band
return in the new run. No collision/death-count-in timing changes are staged
in this script, and no release beat grid is marked verified.

This is intentionally stronger than the music-owned real-OGG smoke's
synthetic `bb:runStart` emission for retry: it exercises the actual scene
lifecycle and prevents future accidental Game Over music cancellations.
Both browser tests passed. The real Game Over retry preserved the original
`runId` transition, count-in generation, four scheduled drum accents,
original track/token/clock anchor, and full-band recovery inside the next
live RunScene. This **validates mechanism only**: 0.5-second synthetic pulse
remains unverified and cannot qualify the sequence for a production release.


## November 18 — Combined fatal-count-in verification (newest status)

- **Music source:** published GitHub `bfd7778` (Music Friday); combined isolated
  branch `integration/turntable-pause-continuity-20261118` cherry-pick `e3d88a9`.
- **Control verification:** `tools/fatal-death-countin-real-retry-audio-browser-smoke.mjs`
  PASSED using the real Matter fatal collision, GameOverScene and actual retry,
  then WebAudio recovery. It confirmed four original drum-cue source starts,
  same musical recovery generation and original song clock/transport, and
  full band return after the next RunScene started. No delayed gameplay.
- **Original source tests:** `tools/music/smoke-fatal-crash-countin-original-ogg.mjs`,
  `tools/music/smoke-fatal-countin-four-songs-ogg.mjs`, and
  `tools/music/audit-fatal-countin-real-webaudio.mjs` PASSED in Chromium;
  verified waveform scratch/silence/drum excerpt/full-band gating and the
  three other shipped track drum-source choices. Manual vinyl, jukebox
  overrides, Gym, shielded crashes and the five-Bluff flight also passed.
- **Unit tests:** targeted 82/82 across eight suites; independent repository
  run **150 passed suites, seven pre-existing failed suites** (2,371 passing
  tests, nine failed), with **identical seven failing suite names** to the
  prior combined baseline. Production Vite build passed. The source-based
  implementation is tested but not yet rhythmically approved.
- **Remaining release blockers:** the currently playing recovery uses a
  synthetic **0.5s pulse** and two silent pulses, not source-verified musical
  beat timestamps. *One More Run* has unresolved ~81 versus ~161 BPM
  pulse interpretation; independently review the true perceived beat and
  phase across all four songs, audition four-hit feel, and replace the
  synthetic pulse with verified source-specific cues before shipping.
- **Safety:** No main merge, deployment, or claim of final musical approval.
  No changes to the original OGG assets or release beat-grid catalog.

Implementation ownership: Music Friday wrote the audio engine; Control
Friday integrated it and independently checked gameplay/audio interactions.
Marvin approved the behavior, not the synthetic pulse as verified rhythm.
