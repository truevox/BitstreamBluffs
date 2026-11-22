# Issue #121 - Portable Deterministic Math (Phase A: evidence)

Owner: Team B. Date: 2026-11-22. Base: b51bee72 (origin/main at start).

Scope: tools/determinism/portable-math/** (experiment tooling, diagnostic), tests/determinism/portable-math.test.js, docs/determinism/portable-math.md,
docs/determinism/results/portable-math-*.json. No runtime/gameplay change in Phase A; no `src/` edit.

Plan (Phase A only, then STOP for owner confirmation): (1) inventory transcendental Math calls on the sim path incl.
Phaser's bundled Matter; (2) leave-one-out / minimal-set replay experiments across chromium, firefox, webkit on the nine #120
fixtures; (3) compare (a) a localized portable implementation, (b) a pinned canonical verifier runtime, (c) deterministic
WASM, with per-tick cost; (4) how to apply it to Matter without forking it (scoped Math substitute vs patching specific
Matter functions). Digests are diagnostic and non-authoritative; to be replaced by the #152 Replay Contract fingerprints.
