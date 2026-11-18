# Music Friday → Control Friday: manual vinyl scratch without breaking continuous soundtrack

Date: November 18, 2026. Music feature branch **`feature/music-vinyl-continuity-20261118`**, rebased by creating a **new isolated worktree directly from Control Friday's verified `f979810`** (`feature/manual-pause-turntable-gameplay-20261118`). This is the *corrected* audio-ownership branch, **not** the superseded experimental `feature/music-vinyl-pause-20261118`, which inherited an older `AudioSynth` where `RUN_END`/`RUN_ABORT` stopped music.

**Owner-approved request:** a subtle, short vinyl scratch **only for intentional manual pause and resume**, default game-wide (ordinary run and BSOD Gym). The released soundtrack must continue through crash, death, Game Over, Title, shopping, and new runs unless the player explicitly intervenes. The scratch is an original procedural one-shot, not any second music player or sample from the soundtrack.

## Exact event and audio ownership contract

Control Friday owns the gameplay scene transitions, pause-token generation, continuation of physics, and all fault isolation. **Audio never prevents an immediate gameplay Pause, Resume, Quit, Restart or Gym GO.** Music Friday listens to the existing `EVT` names, using the additive payloads documented in `docs/TURNTABLE-MANUAL-PAUSE-GAMEPLAY-HANDOFF-20261118.md`:

```js
// Intentional user pause; before RunScene.pause().
EVT.GAME_PAUSE, { runTimeMs, runId, reason:'manual', pauseToken, gym }
// Exactly one matching user resume; after RunScene.resume().
EVT.GAME_RESUME, { runTimeMs, runId, reason:'manual', pauseToken, gym }
// Quit/restart from pause menu; NO synthetic GAME_RESUME.
EVT.RUN_ABORT, { runId, reason:'quit'|'restart', pauseToken, gym }
```

On a `GAME_PAUSE` event with `reason:'manual'`, the audio handler checks an actual active stem transport and positive master/music volumes with some songs enabled. It calls **`StemMusicDirector.transportPause()` first**, capturing original offset and stopping all existing stem source nodes, and stores the resulting playback-generation token, track index, retained source offset, run ID and pause token. It switches to dry/full menu arrangement without starting a new song; only then emits a short descending 205-ms scratch if the recording *was genuinely audible*. All sound is silent after the scratch completes. With muted/disabled/unavailable soundtrack, freeze it without scratch and never force audible playback.

On the matching `GAME_RESUME`, gameplay resumes immediately. If the player has not overridden the jukebox, the handler emits a 205-ms rising scratch and **then calls the same existing director's `transportPlay()`**, provided the stored source offset, track index and transport generation still match. On mute/unavailable effect, it attempts immediate transport resume without a scratch. An AudioContext suspension defers the resumed music until that existing context is running; it never constructs another player. The optional effect timer is cancellable; an old generation cannot restart the track. No part of physics is blocked by an audio timer.

The public read-only Gym timing API stays **fail closed**: manual pause makes `AudioSynth.getBeatTiming()` untrusted, and Control Friday owns both the 1-second READY period and the optional 300-ms window. A pause invalidates pending prior beat advice; music will never re-run or advance the physics.

`reason:'manual'` is enforced if a reason is supplied; clearly non-manual synthetic pause/resume events are ignored. A resume must have an outstanding manual pause and matching `pauseToken`/`runId` when those fields are present. A stale `RUN_ABORT` targeting an earlier token/run is ignored without clobbering a new pause. Existing older emitters without additive fields remain accepted only as a backward-compatible matched event pair, not as a means to bypass an actual token mismatch.

## Highest-priority compatibility invariants

- **Death / crash / ordinary run end:** `RUN_END` still calls `_enterMenuMusic()` and **does not** call `stopMusic()`. `CRASH` emits the existing crash treatment and sound ducking, **no turntable scratch**. The single original song continues with the same track ID and WebAudio clock anchor through genuine fatal BSOD death, Game Over, menu and normal run changes. This is verified by Control's real-OGG death-continuity Chromium smoke.
- **Quit / restart from PauseScene:** `RUN_ABORT` cancels any scratch or pending auto-resume. If the original manual pause froze a song and the user never changed it, the same director resumes at its saved position for the menu **without an extra rising scratch**. This is distinct from normal run-end music, which was never frozen. Explicit jukebox stop/skip/pause takes precedence over restoring the old track.
- **Pause-menu jukebox:** deliberately Play, Pause, Previous/Next, or choose a different song and the old automatic restore token is canceled. When the player chooses Play, the menu audio remains full-bandwidth (not stuck under the paused-game filter). On returning to the game, **the new song and new transport intent win**, not the song cached by the original Pause event. A new song may be paused and stay paused.
- **Rapid toggles / faults:** generation-checked cancelable 205-ms one-shot noise/triangle layers; no stacks, duplicate stems, stale timesteps, or pending resume from an old run. Scene transitions continue even if an audio handler or WebAudio node fails. Muting music during a scratch immediately cancels it.
- **Exact source offset:** `StemMusicDirector._resumeGateAt` prevents scheduling the first audio segment ~100 ms *before* the retained offset as preparation for decoding; new decoder nodes start at the corresponding source sample position. All stems share the same exact first target WebAudio time and source offset. Explicit seeks and stops clear this gate. Normal continuous playback has no special gate.

## Audio design and sound-level limits

`src/systems/music/TurntableScratch.js` is a procedural single-instance effect on the **existing `musicBus`**. `pause` schedules downward source playback-rate/filter/triangle pitch; `resume` reverses those envelopes. Duration **205 ms**, short front and tail volume envelopes, scratch gain max approximately 0.15 and low triangle support max 0.026 before the music volume/master bus. Designed to respect soundtrack mute/slider, not SFX or wind/hiss controls. It is intentionally restrained rather than an ear-piercing needle squeal. Original WebAudio OfflineAudioContext smoke confirms both pitch/brightness directions, bounded peak amplitude, silence after 260 ms, stereo center, cancellation and muted/disposed paths. **This is signal-based QA, not a listening approval.**

## Verification and deployment boundaries

- Music-scoped `tests/src/audio-vinyl-pause-transport.test.js` checks real pause/resume event semantics via the public engine, no vinyl on crashes, matched tokens, stale aborts, rapid toggles, mute/disable, direct quit, and pause-menu jukebox overrides.
- `tests/src/audio-vinyl-resume-frame-exact.test.js` validates same-time/same-offset six-stem scheduling (via real director method with mock source nodes), early/late decoder behavior and gate reset.
- Existing `tests/src/continuous-soundtrack-menu-shuffle.test.js`, `tests/src/music-gym-beat-timing.test.js`, and `tests/src/jukebox-transport.test.js` must continue passing without weakening legacy assertions. Existing continuous-music menu transition filters keep their original 50-ms ramps.
- `tools/music/smoke-vinyl-pause-real-game.mjs`: **real Chromium + real shipped original OGG**; manual Pause / fixed song position / rising scratch delayed same-song resume / rapid toggle / actual PauseScene jukebox track skip and Play / no vinyl on crash. Uses full Control payloads `reason/runId/pauseToken`.
- `tools/manual-turntable-death-soundtrack-continuity-browser-smoke.mjs` (from Control base): **real fatal BSOD collision + original OGG**; checks the song clock survives and no manual pause event occurs.
- `tools/music/smoke-vinyl-scratch-webaudio.mjs`: exact original scratch module rendered in offline Chromium, objective brightness inversion and silence. Does not play audio through speakers.

This branch is **feature-only**: do not merge into `main`, deploy, or modify Control Friday's current worktree. Control Friday owns creating the final combined integration and browser gameplay testing. The separately discussed **crash-stops-with-scratch → silent beats → four-drum-beat count-in → band** is still an **unimplemented design experiment**; Marvin approved only the rule that if that effect is eventually implemented, its ongoing drum count-in must persist through an immediate retry without delaying gameplay. This project does **not** alter crash audio.
