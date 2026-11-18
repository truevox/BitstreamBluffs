# Crash scratch → drum count-in → full band: approved DESIGN, not implementation

Recorded: 2026-11-18. Source: Marvin's discussion with Music Friday,
relayed to Control Friday in the same day's project coordination.

**Status: DESIGN APPROVED, IMPLEMENTATION NOT AUTHORIZED / NOT STARTED.**
This is distinct from the approved-and-in-progress vinyl effect for the user's
intentional **PAUSE/RESUME**. The earlier explicit instruction **not to
implement crash scratching yet** still applies. This note must not cause any
new crash audio code, event subscription, or release beat-grid promotion.

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
audio context need a deliberately designed precedence policy *before*
implementation. No such policy is approved merely by documenting it here.

## Current default remains unchanged

Until explicitly approved for implementation, ordinary crashes preserve the
**continuous soundtrack** across death, Game Over, menus, and retries, using
the current `_enterMenuMusic()` and `_enterRunMusic()` contracts. They do not
emit `GAME_PAUSE` or the intentional-pause scratch. The manual-pause feature
is separate and should ship independently after real-browser validation.

## Later listening / A-B gate

The earlier research options remain useful: (A) uninterrupted music,
(B) brief crash-scratch accent with no stop, (C) full scratch/silence/drums/
band recovery. Test across several rapid fatal crashes, immediate retries,
short Game Over visits, long initials/shop visits, and tracks with ambiguous
or changing pulse. Record subjective preference and frame/music timing before
promoting option C. Design approval alone is **not** release approval.

**Provenance:** Marvin proposed the crash scratch + 1–3 silent beats + four
drum-only beats + band return; Marvin explicitly approved carrying the
count-in into an immediate retry. Music Friday supplied pacing/implementation
analysis and suggested reusing the same stems. This file does not assert that
any crash transition has been coded, tested, or deployed.
