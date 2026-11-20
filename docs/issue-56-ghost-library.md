# Issue #56: ghost library and replay tapes (spec draft)

Status: **specification only, no code.** The issue says no implementation is authorized yet,
and the tape format depends on #59's fixed tick (`engine/fixed-tick-59`, not merged). Nothing
here is a permanent storage format until #59 lands and a cross-session replay is proven.
Items marked **[Marvin]** are owner decisions that are still open.

## Owner decisions this spec follows (2026-11-20)

- A ghost belongs to an exact **course**: the seed plus the selected biome mask. Ghosts never
  race across seeds.
- A course shows **at most five** ghosts: Latest, Best, and Favorites A, B and C. Each one can
  be toggled separately. A run that holds several roles is drawn once.
- Ghosts have no collision, scoring, hazard, Daily-ranking or award effects.
- The repeatable **Ghost Library / Course Archive** upgrade raises how many *courses* keep their
  ghosts. It never raises the five-per-course limit.
- Replay works from the initial state plus a compact tick-indexed input tape, with sparse
  checkpoints to detect desync.
- Ghosts are local and offline by default. Publishing to the Brain Bazaar happens only when the
  player explicitly asks (#58).

## Data model

```
CourseKey   = "<seed>|<biomeMask as 8 hex digits>|gen<generatorVersion>"
CourseEntry = { key, seed, biomeMask, generatorVersion,
                latest: runId|null, best: runId|null,
                favorites: [runId|null, runId|null, runId|null],
                show: { latest, best, fav0, fav1, fav2 } (booleans, default true),
                lastPlayedAt, bytes }
GhostTape   = stored once per runId, referenced from any number of roles
```

- **Best** is the furthest distance on that course. Ties go to the earlier run. Gym practice
  attempts don't count (this is the proposed default) **[Marvin]**.
- **Latest** is the most recent finished run on the course.
- A tape is deleted only when no role on any course references it any more.

## Replay tape v0 (provisional)

**Header:**
- `format: 'bb-ghost-tape'`, `version`;
- `simTickHz`, `physicsVersion`, `generatorVersion`, `runRandomVersion`, `actionSchemaVersion`;
- `seed`, `biomeMask`, `mode` (normal, Daily or Gym) plus the Daily rule ID;
- the frozen loadout (boosts, upgrades and cosmetics that affect physics);
- the initial pose and velocity;
- the `runRandomState()` snapshot and the attempt-start tick (Gym retries continue the tick
  counter);
- `runId` and `recordedAt`.

**Inputs:** one entry per tick on which the normalized pad changes, recorded as `[tickDelta,
changedFieldMask, values]`, run-length encoded and stored as base64 bytes:
- held fields: push, tilt (−1/0/1), tuck, brake, divebomb, corkscrew, parachute and airBrake;
- one-shot edges, recorded on the tick that consumed them: hop, reset, parachute and airBrake.
  Pause is never recorded, because the run clock doesn't advance during it.

**Checkpoints:** about once a second (every 120 ticks). Each holds the tick, x, y, angle, vx,
vy, angular velocity and score as float32, plus a 32-bit checksum.

**Size:** a 3-minute run has about 1,000 input changes (≈4 KB) and 180 checkpoints (≈6 KB), so
roughly 10 KB per tape. One full course is about 50 KB, and 200 courses about 10 MB. Tapes
belong in IndexedDB (the `runs` store already lives there), not localStorage.

**Playback:**
1. Re-simulate the tape once, off-screen, on a hidden Matter world when the course loads.
2. Verify each checkpoint and cache the resulting pose trace.
3. Draw up to five ghosts from their traces each frame, without running five live physics
   simulations.

On a checkpoint mismatch or a version mismatch, the tape is labelled **incompatible** and is
not drawn. The game never invents a path. Verified pose traces may be kept as a fallback for
older engine versions **[Marvin]**.

**Separation:**
- Tapes live in their own store, keyed by `runId`.
- `RunRecord` and the run-ledger hashes don't change.
- Ghosts are drawn by a visual-only entity outside `simTick`, with no Matter bodies and no
  event emission.

## Archive capacity

The number of courses kept is `includedCourses + purchasedSlots`. Several values are still
open **[Marvin]**:
- the starting count;
- the price curve;
- the currency.

The proposed eviction rules:
- When a run would create a new course entry and the archive is full, the
  least-recently-played course *without favorites* is replaced, after a one-line notice.
- If every course has favorites, the player is asked to manage the archive. Favorites are
  never deleted silently.
- Latest and Best on the current course always update in place.

## UI (proposal)

- A per-course ghost panel on the pre-run screen: five rows (Latest, Best, A, B, C), each with
  an on/off switch, the run's distance and its date, and *Save as favorite* / *Replace* on the
  results screen.
- A global *Hide ghosts* switch exists only as a convenience over the per-ghost switches.
- Ghosts are translucent, tinted by role, with no trails that could be read as hazards. They
  honour reduced motion.

## Test plan (when implementation is authorized)

1. **Same build, same tape:** the replay matches the recorded checkpoints, at 30, 60 and
   120 Hz, with scramble, slow-mo and hit-stop, through a crash and a Gym retry. The base for
   this is `tools/replay-determinism-browser-probe.mjs`.
2. **Desync detection:** a corrupted tape, a mismatched version, or a tape for the wrong course
   is rejected and not drawn.
3. **Library rules:**
   - the five-per-course limit, with duplicate roles drawn once;
   - favorite pin, unpin and replace;
   - Latest and Best updates;
   - the archive-full flow that never deletes favorites;
   - quota exhaustion in IndexedDB.
4. **Gameplay isolation:** with ghosts visible, a run's physics checkpoints, score and
   `RunRecord` hash are identical to the same tape with ghosts hidden.
5. **Privacy:** no network request happens on save, favorite or slot purchase. Publishing
   (#58) is a separate, explicit action.

## Order of work

#59 stage 2 is merged and checked by hand →
tape recorder plus off-screen re-sim (behind a flag) →
library store and UI →
archive capacity, once the economics are decided →
#58 publishing.
