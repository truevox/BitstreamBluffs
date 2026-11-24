# Manual gameplay pause → turntable scratch contract (Control Friday)

Date: 2026-11-18. Owner approval: short descending record-drag scratch on
intentional gameplay pause, companion rising scratch on resume, soundtrack
transport frozen at the original source position. Both for normal runs and
BSOD Gym; **never** for death/crash. Music Friday owns sound and transport.

## Gameplay-owned event contract (implemented)

Events use the existing global emitter and preserve their original names.
All changes to event payloads are **additive**; existing subscribers can
ignore the new fields.

```js
// Once per intentional pause. Emitted BEFORE Phaser RunScene pauses.
EVT.GAME_PAUSE, {
  runTimeMs: 1234.56, runId: '...', reason: 'manual',
  pauseToken: '<runId>:<manual-pause-sequence>', gym: false,
}

// Exactly once when the player explicitly selects RESUME, after RunScene
// resumes. The runId and pauseToken MATCH the preceding GAME_PAUSE.
EVT.GAME_RESUME, {
  runTimeMs: 1234.56, runId: '...', reason: 'manual',
  pauseToken: '<same-token>', gym: false,
}

// From PauseScene RESTART or QUIT; DOES NOT emit GAME_RESUME.
EVT.RUN_ABORT, {
  runId: '...', reason: 'restart' | 'quit',
  pauseToken: '<same-token>', gym: false,
}
```

`pauseToken` is a per-run monotonic session identifier: `runId` plus an
incrementing sequence. Duplicate or re-entrant `pauseRun()` calls while a
manual pause is already pending are discarded, avoiding duplicate scratch
start events. Each subsequent pause in the same run obtains a new token.

**No other event represents an intentional turntable pause.** Genuine
`EVT.CRASH`, `EVT.RUN_END`, Gym collision retry (`EVT.GYM_ATTEMPT_RESET`),
level exits, ordinary TitleScene music and browser-visibility suspension
MUST NOT trigger the two manual scratch transitions. Restart or quit from a
paused menu aborts an existing pending pause session; there is never a
synthetic resume or an attempt to start a new scratch.

## Music Friday ownership (not implemented on this branch)

- On `GAME_PAUSE {reason:'manual',pauseToken}` when music is actually audible,
  record source position, play a modest 150–250ms descending scratch,
  **freeze the actual six-stem transport**, then silence. Use the existing
  shared WebAudio graph / StemMusicDirector; no second music player.
- On the matching `GAME_RESUME`, produce the complementary rising scratch
  and resume the existing recording at the saved source position. Gameplay
  resumes immediately; music processing must never block RunScene or Gym.
- If music is muted, disabled, unavailable, or explicitly stopped, skip
  the scratch and do not start music against the user's wishes.
- If the pause-menu jukebox is used to play/skip/select/pause a track,
  treat that as explicit transport intent: cancel obsolete pending
  scratch/restart operations and **do not restore the prior track** on
  `GAME_RESUME`. Honor the chosen track/state.
- Rapid toggles, seeking, and late async decodes must not leak or stack
  scratches, voices or stale generation callbacks. `pauseToken`, `runId`
  and the music player's transport generation are available to reject them.
- `RUN_ABORT {reason:'quit'|'restart', pauseToken}` must cancel an in-flight
  scratch and any old resume intent, without playing the rising scratch.
- Preserve user volume/mute/accessibility preferences. In particular,
  keep the fourth wind/hiss slider independent of music and SFX.
- Existing Gym beat sync remains **fail closed**. If a pending beat wait is
  manually paused, Control Friday discards the advice and issues unsynchronized
  GO on resume; the music layer must not reintroduce that wait.

The music-owned implementation should retain its own music transport tests,
including real OGG playback, pause/seek/track-swap and silent behavior, and
send back the branch/commit and any necessary callback adjustments.

## Browser validation (gameplay only)

`tools/manual-turntable-pause-gameplay-browser-smoke.mjs` runs real Phaser
scenes in Chromium. It verifies matched tokens and reasons in normal/Gym
runs; rejects duplicate PAUSE events; checks QUIT and RESTART send abort
without a fake resume; and uses an actual fatal BSOD death to prove there
is no manual-pause event. It **does not claim any scratch audio has been
implemented or heard**. Audio success needs a separate combined smoke after
Music Friday's implementation lands.

## Fault isolation

The four scene transitions now catch exceptions raised by synchronous
`GAME_PAUSE`, `GAME_RESUME` and `RUN_ABORT` observers; an audio bug must not
strand the player in a half-paused scene. This guarantees the **gameplay
scene transition** continues, not that all remaining event subscribers run
after a throwing callback (the shared EventEmitter may stop dispatch at the
throw). **Music Friday's listener should therefore contain its own failures**
and avoid throwing from event handlers. The browser smoke deliberately injects
faulting event observers and checks Pause, Resume, Restart and Quit still work.

## CRITICAL: Feature-branch merge base and continuous soundtrack

The Music Friday branch `feature/music-vinyl-pause-20261118` was forked
from `03c50fd` (ancestor `17aaad9`) **before** Control Friday's combined
Gym integration and the independent continuous-soundtrack/menu-shuffle
changes reached this gameplay branch. In its inherited baseline,
`AudioSynth` handles `RUN_END` and `RUN_ABORT` by calling `stopMusic()`.
On the current Control integration branch, those events instead call
`_enterMenuMusic()` so the *same song keeps playing through real death,
Game Over, new runs and menus*, unless the user explicitly pauses the
soundtrack. This difference **predates** Music Friday's vinyl patch; it
must not be accidentally reintroduced by merging the older `AudioSynth`.

**Integration requirement:** Transplant the *vinyl-specific* state machine,
WebAudio scratch synthesis and tests onto Control's up-to-date AudioSynth.
Preserve `_enterRunMusic` / `_enterMenuMusic` and every existing continuous
music/menu/biome listener. Do **not** copy an entire older AudioSynth as the
replacement. The root event names remain unchanged.

Music Friday should consume the additive `reason`, `runId` and `pauseToken`
fields on manual `GAME_PAUSE` / `GAME_RESUME` and `RUN_ABORT`, checking that
a `GAME_RESUME` matches the pending manual pause session. This prevents a
stale or synthetic event from resuming a prior track. Legacy event payloads
may be supported by explicit compatibility policy, but must not silently
override a newer session. Event handlers must catch their own exceptions;
Control has a catch around scene navigation, but a throwing EventEmitter
subscriber can prevent later subscribers from seeing an event.

Test compatibility *before* promotion with
`tests/src/continuous-soundtrack-menu-shuffle.test.js` and the new real
OGG `tools/manual-turntable-death-soundtrack-continuity-browser-smoke.mjs`.
The browser test plays original six-stem `One More Run`, causes an actual
fatal BSOD collision, and verifies `RUN_END`, playback continuity, stable
WebAudio clock anchor, and zero manual-pause events. These checks are
**separate** from the vinyl scratch's own sound quality and user-initiated
pause semantics. They apply equally to normal Game Over and music re-entry.
