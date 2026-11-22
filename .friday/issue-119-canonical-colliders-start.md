# Issue #119 follow-up: canonical terrain colliders (owner-approved physics-identity break)

Owner: Team B. Base: origin/main b51bee72.

Owner decision (2026-11-22): YES. "Pre-release, fewer than 3 players; now is the time for all breaking changes."

Scope:
- Terrain colliders are built identically regardless of history (no dependence on the body pool at the bit level).
- TerrainMesh `_bodyPool` removed.
- Test first: the same chunk built fresh vs after pool reuse must give bit-identical static geometry.
- Physics identity bumped per Replay Contract v1.1 (SIM_REVISION), coordinated with #140 / PR #160 (also bumps to 2).
- Game feel preserved: no visible terrain change. Snapshot size and perf measured before and after.

Files: src/entities/TerrainMesh.js, src/systems/replay/ruleset.js, tools/ruleset/**, src/systems/replay/fingerprintSchemas.js (one NON_CAUSAL entry), tests/determinism/terrain-collider-canonical.test.js, CHANGELOG.md, package.json.
