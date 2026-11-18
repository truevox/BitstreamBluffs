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
