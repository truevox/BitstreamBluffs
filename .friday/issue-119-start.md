# Issue #119 — Heavy Mode + Trusted Savestates (Phase 1: feasibility)

Owner: Team B
Base: origin/main b51ab36

## Scope (Phase 1 only — no production savestates)
1. Inventory complete Matter/Phaser + game state needed for tick-boundary save/restore, verified against source.
2. Isolated, non-production experiment: uninterrupted run vs snapshot-at-K + restore into fresh world + replay suffix, contact-heavy and hazard-heavy fixtures.
3. Serialization contract proposal, risks, effort, go/no-go for Phase 2.

## Provisional file scope
- docs/determinism/savestate-feasibility.md
- tools/savestate-experiment/**
- tests/determinism/savestate-*.test.js
- .friday/issue-119-start.md

No runtime (src/) changes. Savestate digests are diagnostic, non-authoritative; Team A's #152 owns replay manifest / canonical hashes.
