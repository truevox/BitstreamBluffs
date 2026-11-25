# P0 #68 — Private Cemetery Montage, technical pilot (2026-11-25)

## Contract

- **Owner scope:** proposed player-visible montage of recent failed selves, with the longest trace in this retained local history highlighted, accurately sampled from native ghost poses. The exact player-facing presentation and permanent retention limits remain adjustable after owner playtest. This is a draft, not approval to publish.
- **Default OFF:** `Settings → CEMETERY: OFF` means no additional pose storage. Turning ON starts *future completed ordinary* attempts only; there is no fabricated backfill of old ghost roles. A Game Over ghost panel gets a third **CEMETERY** button only while enabled.
- **24 recent pose traces per exact seed + biome mask**, and a global cap of 128 locally stored runs, stored in dedicated IndexedDB `bitstream-cemetery-poses` v1. These caps are independent of the five-ghost cache's role count and the unsettled course-archive capacity/price/eviction decisions in #56.
- **Privacy:** records contain only local course seed, mask, opaque run ID, terminal tick, distance for ordering/highlight, original 30 Hz `{x,y,angle}` samples and local insertion time. No input commands, authoritative hashes, checkpoint snapshots, rewards, profile changes, wallet/payment data, names, accounts, network uploads or local replay proof claims. Guest practice/Gym never enters Game Over recording. Refuse malformed or oversized pose data.
- **Explicit destruction:** while ON, press CLEAR twice within four seconds to remove only this course's pose archive. OFF prevents future writes and hides the UI but does **not** delete older pose traces. Clear site data also deletes the archive. Existing protected replay evidence and the five Ghost Library tapes are entirely separate and unaffected by CLEAR.
- **Performance/accessibility:** render paths once, cache decoded Float32 pose arrays once and animate only 24 small rider glyphs at approximately 14 updates/second. Low-motion preference makes playback static and requires manual scrub; all markers are graphics-only, have no Matter bodies, and cannot influence physics, score, timeline, leaderboard or public verification.

## Verification

1. `npm test -- --runInBand tests/replay/cemeteryArchive.test.js`: validates default OFF, malformed inputs, course key isolation, dedup + 24-cap/global bound, tied-time new-run retention, clearing only selected course, memory-only fail-closed and final-tick pose mapping.
2. `GAME_URL=http://127.0.0.1:18371/ node tools/ghosts/test-cemetery-browser.mjs`: real source-compiled Chromium with ordinary historical pose fixture copied under **labeled synthetic QA IDs**; checks no OFF writes, ON recording via GameOver code path, 24 rows, exact course isolation and only pose data, all three nonoverlapping GameOver actions, armed-share cancellation, actual graphics view, interactive scrub, reduced-motion suppression, two-press course-only clear, zero page exceptions or mutating HTTP. QA fixture repetitions do not represent distinct human performances.
3. Source-identity, production build, existing 870+ current replay tests, and strict source-built Chromium savestate gate must remain green. Full physical ChromeOS battery/performance and owner visual acceptance are **not** proven by a desktop Chromium smoke.

## Open before closing P0

- Physical Chromebook render/frame-time test at 24 overlapping traces and an owner playtest of visuals, count, retention and settings wording.
- Independent exact-head review; coordinate any production rollout. Current pull request remains draft.
