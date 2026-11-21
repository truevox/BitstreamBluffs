# Issue #140 — Simulation/Presentation Causal Isolation (start)

Owner: Team B
Branch: friday/issue-140-teamb-causal-isolation-20261121
Base: origin/main b51ab36

## Scope
- Diagnostic, non-authoritative per-tick causal-state digest (to be replaced by the #152 contract when published):
  `tools/conformance/**`, `tests/determinism/**`.
- In-browser differential probe on the real built game: baseline vs presentation
  perturbations (camera zoom/shake/scroll, particles/Fx, render cadence 30/60/120/144 Hz with
  a fixed per-tick input tape, audio muted/unmuted/no AudioContext, viewport size/aspect/resize
  mid-run, UI/HUD). Reports first divergent tick + subsystem.
- Known leak `updateGroundTelegraph` -> `this._view.right` is #155's: detect/report only.
- Other proven leaks: minimal fix in `src/**` with a failing-then-passing test.
- Results: `docs/determinism/causal-isolation.md` + PR body.

## Out of scope
- Frames->ticks fan-out / input sampling (#115) — reported, not fixed.
- Authoritative replay format / hash (#116, #152).
- `tools/replay-determinism-browser-probe.mjs`, `tools/canaries/**`, `tests/canaries/**` (not edited).
