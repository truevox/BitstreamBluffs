# Issue #115: fair input timestamps

Status: implemented on `friday/issue-115-teamb-fair-input-20261121` (Team B), draft PR #162. Base `main` b51ab36.

## Problem (proved, not assumed)

The fixed 120 Hz tick (#59) made one input tape replay identically at any display rate, but live input
still reached the ticks through ONE poll per display frame:

| Finding | Status on main | Evidence |
|---|---|---|
| (a) one poll fanned to N ticks: a press is applied to the frame's first tick wherever it fell in the frame | **Proved.** At 30 Hz a press is applied up to 3 ticks (25 ms of simulated time) *before* the key went down; 60 Hz up to 1. A double tap inside one 30 Hz frame merges into one hop. | `tests/determinism/fair-input.test.js` (legacy block) |
| (b) held-only buttons (push, tuck, tilt, brake) tapped and released inside one frame are lost | **Proved.** A 20 ms push tap is lost in 87 of 240 phase-swept presses at 30 Hz (36 %). | latency sweep, below |
| (c) 0-tick frames (> 120 Hz, e.g. 144 Hz: 24 of 144 frames run no tick) carry edges forward but drop held state | **Proved.** A brake tap spanning a 0-tick frame is lost; the hop edge survives. | `(c)` tests |
| (d) a hop edge can arrive with `pad.hop` false | **Proved** for every sub-frame Space tap. Harmless to the jump itself (`TUNING.hopMinimumHoldMs` already gives a minimum hold) but the pad is self-contradictory. | `(d)` tests |
| (e) blur / visibilitychange release keys but not latched edges; tab suspension | **Confirmed, kept.** An edge latched before a blur is delivered once on the next frame. After a stall the resume frame runs the 6-tick cap (backlog dropped) and input from before the stall lands on its first tick: stale but never lost, never fast-forwarded. Unchanged by this PR (open question below). | `fair-input-edges.test.js` |
| (f) gamepad sampled per frame only | **Platform limitation, documented.** The Gamepad API has no per-button event timestamps; changes are seen when polled (prestep / poll). They keep exactly the pre-#115 schedule (first tick of the frame). | `(f)` test |

## Fix

* `InputRouter` passes each keyboard event's `event.timeStamp` (the `performance.now()` clock, the same
  clock as the rAF time Phaser hands to `RunScene.update(time)`) to `VirtualPad.setButton(..., timeStamp)`.
  A timestamp not on that clock (legacy epoch values, synthetic events, jsdom) is treated as untimed.
* `VirtualPad` journals every aggregate hold change since the last poll; `poll()` returns it as a
  non-enumerable `timeline` (snapshot shape unchanged; capped at 256 entries between polls).
* `SimClock.padsFor(pad, ticks, { frameTime, timeline, normalize })` gives each change to the tick whose
  real-time window contains it. This frame's ticks end at `frameTime - accMs - (ticks-1-i) * tickMs`.
  * Clamped into **this frame's ticks**: older than the first window (stall, untimed gamepad/touch/blur)
    -> first tick (= old behaviour); newer than the last window (sub-tick remainder) -> last tick. So no
    input is ever shown a frame later than before, and no tick that already ran is rewritten.
  * Arrival order is never changed (an untimed change never lands before an earlier timed one).
  * A button that went down inside a tick's window is held on that tick even if released before the
    window closed: a tap is at least one tick. Edges are rebuilt from the rises (so the hop edge tick
    always has `hop` held).
  * A 0-tick frame carries its timeline forward intact; a poll consumed in between (pause frame) is
    bridged with untimed changes so no hold goes stale.
  * Without a timeline (`TapePlayer` replays, probes that stub `poll`), `padsFor` is the old fan-out.
* `RunScene.update` passes `time`, the poll's timeline and `normalizePad` (re-run per tick).

## Measurements

Phase sweep: 240 W presses held 20 ms, 100 ms apart, each at a different phase of the frame
(`measureLatency`, `INPUT_TIMING_REPORT=1`). Tick lag = first tick holding push minus the tick whose
window contains the keydown (negative = applied to simulated time before the key was pressed).
Frame lag = render frame first showing it minus the first frame that could poll it.

| Rate | Path | Lost taps | Press tick lag min/mean/max | Release tick lag | Frame lag max |
|---|---|---|---|---|---|
| 30 Hz | main | 87/240 | -3 / -2.27 / -1 | -2 / -0.73 / 0 | 0 |
| 30 Hz | #115 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| 60 Hz | main | 0 | -1 / -0.49 / 0 | -1 / -0.51 / 0 | 0 |
| 60 Hz | #115 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| 120 Hz | main | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| 120 Hz | #115 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| 144 Hz | main | 0 | -1 / -0.35 / 0 | -1 / -0.31 / 0 | 1 (0-tick frames) |
| 144 Hz | #115 | 0 | -1 / -0.35 / 0 | -1 / -0.31 / 0 | 1 (0-tick frames) |

**Display latency added: none.** For every press the main path delivered, the #115 path shows it in the
same render frame (asserted per press at all four rates). Simulated-time lag goes from "up to 3 ticks
early" to exact.

### Real game (Chromium, built bundle, `tools/fair-input-browser-probe.mjs`)

Real `KeyboardEvent`s with pinned timestamps, loop asleep, exact frame schedules, seed FAIR115, 720
ticks, 18 key events including a 2.4 ms hop tap, a tuck tap, a brake tap and a sub-frame double tap:

| Build | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| main b51ab36: tape rows / end x | 16 / 2593.688 | 16 / 2593.688 | 16 / 2593.496 | 16 / 2596.174 |
| #115: tape rows / end x | 20 / 2602.739 | 20 / 2602.739 | 20 / 2602.739 | 20 / 2606.021 |

#115: identical ghost-tape input rows and identical sled state at 30/60/120 Hz. main: three different
tapes, three taps dropped at every rate (16 rows vs 20).

## Limits and trade-offs

* **144 Hz (any rate that does not divide 120)** cannot be exact without adding latency: an event in
  the sub-tick remainder of a frame (after the last tick boundary it simulates, before the frame) is
  applied to the last tick, at most 1 tick early (35 % of presses in the sweep, exactly as before).
  Deferring it to its own tick would show it one display frame (6.9 ms) later. Not done; open question.
* Phaser's `smoothStep` may make a frame's simulated time differ slightly from its wall interval; the
  mapping is per frame and clamped, so this only moves events between that frame's own ticks.
* Gamepad and touch overlay changes are untimed (first tick of the frame, as before). Touch pointer
  events do have timestamps; wiring them is a small follow-up.
* Edges latched before a blur or a tab suspension are still delivered on resume (unchanged).

## Replay / tape compatibility

* Ghost tape format, header, `GHOST_TAPE_VERSION` and `GHOST_PHYSICS_VERSION` unchanged; `GhostTape.js`
  untouched. Existing tapes replay tick-for-tick identically (`TapePlayer` does not use `padsFor`).
* **Live recordings change**: for the same physical input, the per-tick pads recorded from now on are the
  fair ones (taps kept, presses on their own tick). This changes what a player's live run does, not how
  any stored tape replays. Flagged for #152 (Team A).

Diagnostic tooling only (`tests/determinism/*`, `tools/fair-input-browser-probe.mjs`): digests there are
non-authoritative and to be replaced by the #152 contract when published.
