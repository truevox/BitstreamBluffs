# Issue #115 - Fair Input Timestamps (start)

Owner: Team B
Base: origin/main b51ab36
Branch: friday/issue-115-teamb-fair-input-20261121

## Scope (provisional)
- src/systems/InputRouter.js, src/systems/VirtualPad.js (timestamped key journal)
- src/systems/SimClock.js `padsFor` (map timestamped events to the tick whose window contains them)
- RunScene.update input glue only (pass frame time + timeline into padsFor)
- tests/determinism/** and tests/src/input-audio-glitch/**, tests/src/sim-clock.test.js
- docs/issue-115-fair-input.md

Out of scope: GhostTape format/header (Team A, #152), touch timestamping, gamepad event timing.

## Plan
1. Deterministic Jest harness: fixed timestamped DOM key sequence at 30/60/120/144 Hz render cadences -> per-tick pad tape.
2. Prove/disprove: frame-quantized press timing, lost sub-frame held taps, 0-tick frames, hop edge without hop held,
   blur with latched edges, suspension/6-tick cap, gamepad per-frame sampling (platform limitation).
3. Minimal fix: event.timeStamp -> tick window, clamped to this frame's ticks (no retroactive changes, no added frame latency).
4. Measure event->tick latency before/after; full `npm test`, ghost-tape browser smoke + replay probe (port 8413).
