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

## Until the new audio implementation is complete

The currently reviewed build still preserves the **continuous soundtrack**
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
analysis and suggested reusing the same stems. This file does not assert that
any crash transition has been coded, tested, or deployed.
