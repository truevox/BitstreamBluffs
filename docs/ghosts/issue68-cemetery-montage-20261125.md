# P0 #68 — Owner-approved Cemetery Montage pilot (2026-11-25)

## Retention and player control

- **Canonical decision:** Marvin chose **5 past attempts per exact seed + selected biome mask by default**; Team B owns the player-facing finalization/review. The Settings → **PAST ATTEMPTS** 0–24 arrow-key/pointer stepper changes the per-course count one at a time. **0 OFF/ERASE** prevents new captures and prunes this separate pose archive only. Lowering a nonzero value discards oldest independent history entries immediately; raising it does not resurrect previously evicted runs.
- The bounded history is independent of the five visible GhostLibrary roles (Latest/Best/Favorite A/B/C), and independent of private protected evidence/leaderboard records. It never alters their contents or their capacity. Guest practice and Gym runs cannot enter this archive. Capture requires a completed crash-labeled run and matching native tape/record IDs.
- Separate IndexedDB database: `bitstream-cemetery-poses` schema v1. **Maximum 24 per course, 128 stored records globally, at most 8 MiB conservative estimated UTF-16 payload/metadata footprint globally**, and no more than 180,000 base64 trace characters (~135 KB binary) in one record. Actual browser quota can reject earlier; quota or missing IndexedDB is a visible fail-closed capture result and must not interrupt Game Over.
- FIFO is enforced using an **atomic transaction-local insertion ordinal**, not timestamp alone; simultaneous tabs and multiple runs in one millisecond cannot evict the newest by lexical ID order. Retention and deletion are atomic IDB transactions. All history entries are unprotected; clearing never touches actual favorite, Best, pinned replay, or protected evidence.
- **Course-only CLEAR:** press CLEAR twice within 4 seconds in the Cemetery view to remove this course's pose rows. The panel remains reachable even with Settings at 0, allowing explicit clean-up after a failed automated trim. Clearing all browser site storage also erases this private archive.

## Playback and privacy

- Each record contains only exact course seed, mask, opaque run ID, timestamp/insertion order, terminal tick/distance, run mode, and native 30 Hz `{x,y,angle}` pose samples. **Not retained:** frame input commands, checkpoints, full simulation state, ledgers, authoritative hashes, names, profile, rewards, account/analytics data. It does not upload or share anything. No pose-only artifact is trustworthy proof of a human performance.
- Game Over → Course Ghosts keeps both SHARE LINK and LOCAL EVIDENCE and adds CEMETERY. The longest distance among retained entries is included and highlighted. The renderer draws at most **12 noncolliding small rider markers** even if 24 are stored, caches decoded Float32 arrays/background paths, and throttles marker repaints to ~14 Hz. Reduced motion always stops autoplay; left/right scrub remains available.
- The UI's visual timeline is presentation-only. It never joins Matter world, modifies scored run state, alters official rankings, or mints new gameplay entitlements.

## Verification

1. `npm test -- --runInBand tests/replay/cemeteryArchive.test.js`: tests five-default, 0–24 controls and sanitization, malformed inputs, exact-course isolation, atomic FIFO under wall-clock ties, byte-budget eviction, lowering/zero/prune/raise policy, explicit course clear, quota and IndexedDB failure/recovery, and final pose mapping.
2. `GAME_URL=http://127.0.0.1:18371/ node tools/ghosts/test-cemetery-browser.mjs`: real source-built Phaser Chromium with a labeled *synthetic fixture copy* of a historical pose trace, not invented human results. Verifies 0 disables writing, 24 upper-bound retention, actual nonoverlapping Ghost UI, 12 rendered markers, scrub and reduced motion, two-press clear, Settings numeric row 24→5→7→0 with immediate pruning, and setting persistence after page reload. Zero page exceptions or mutating HTTP.
3. Existing replay corpus, deterministic source attestation, production PWA build and strict Chromium savestate gates must stay green at the current PR head. Real Chromebook memory, power and sustained frame-time remain **unverified**, and Team B must review the presentation with Marvin before public release.

## Remaining before P0 close

- Independent Team B exact-head review and physical ChromeOS render/storage/playtest (including 24 long native tapes under constrained storage, not merely QA copies of one trace).
- Confirmation that the per-course count and 12-on-screen performance compromise are acceptable; coordinate stack #369 → #370 → #373 before any production merge. No Netlify discretionary build.
