# Issue #120 - Cross-Engine Replay Conformance Matrix

Owner: Team B. Date: 2026-11-21. Base: b51ab36.

Scope: tools/conformance/cross-engine.mjs (+ fixtures, diagnostic digest), docs/determinism/cross-engine-matrix.md,
docs/determinism/results/. No runtime/gameplay change. Does not edit shared probes, tools/canaries or tests/canaries.

Plan: record fixture tapes once with GhostRecorder (Chromium), replay via TapePlayer on chromium / firefox / webkit at
30/60/120/144 Hz stepping and repeated sessions; compare per-tick isolated, non-authoritative subsystem digests;
report first divergent tick/subsystem and suspected Math op (evidence for #121). Diagnostic only; to be replaced by the
#152 contract when published.
