# Cemetery Montage / Graveyard Swarm (#68)

Owner decision (Marvin, 2026-11-25, recorded in #68): keep **5 past attempts per course by default**, player-chosen
in Settings, **0 = keep none**, in a **separate local-only store**, never touching the five-role GhostLibrary.

## What the player sees

- **Game Over → MONTAGE (M).** A lime button over the RUN REPORT panel, shown whenever the run recorded a ghost tape
  and the montage is not switched off. On a new distance best it reads **NEW BEST M** (it pulses briefly unless motion
  is reduced). It never opens by itself.
- **Montage style** (default): the most recent ≤ 8 past attempts, numbered `#1..#n` in chronological order, ride with
  the run that just ended (`NEW BEST` / `THIS RUN`, lime). A follow camera keeps that run a third of the way across;
  every past self that falls leaves a **headstone** where its trace ends. When the last past self has fallen (plus a
  2 s beat) the view cuts to the **overview**: every trajectory, every grave, the whole course.
- **Swarm style**: every kept attempt (deterministically sub-sampled to the device's rider budget, always including the
  oldest and newest), unlabelled, thinner, fainter.
- Controls: Enter play/pause/replay, ←/→ step time (24 instant steps), ↑/↓ follow ↔ overview, Esc/M/BACK close,
  Space still retries. Legend: this run's distance, how many past attempts are shown of how many kept, the furthest
  past distance, and how many stored traces were skipped as incompatible or damaged.
- **Reduced motion** (Settings ON, or AUTO with the OS `prefers-reduced-motion`): opens on the still overview at the
  final frame; never autoplays, never follows, no pulsing button. ←/→ still step time instantly.

## Data sources (read only)

1. The **attempt history** (below) for this exact course (seed + biome mask).
2. This course's existing **GhostLibrary** roles (Best / Latest / Favorites), read through `ghostsFor()`, deduplicated
   by run id. This makes the montage useful before any history has accumulated. The library is never written.

Only traces whose format, tape version, tick rate, physics version, Kodiak ruleset and **terrain revision
(`SIM_REVISION`)** match this build are drawn. Damaged or missing pose rows are skipped and counted, never drawn.
The run being celebrated is excluded from the past list by run id.

## Attempt history store

| | |
|---|---|
| Module | `src/systems/ghost/AttemptHistory.js` (no Phaser), service hook `attemptHistoryService.js` |
| Storage | IndexedDB database `bitstream-attempt-history` (v1): `meta` (small rows, loaded at start) + `poses` (ArrayBuffer, read on demand in one transaction). Memory fallback when IndexedDB is unavailable (Settings says *THIS SESSION ONLY*). |
| What is kept | The 30 Hz Float32 `[x, y, angle]` pose trace and: run id, course key, seed, mask, terrain revision, tape/physics/tick/Kodiak versions, mode, distance, score, cause, end time, end tick, byte size, insertion sequence. **No** input tape, checkpoints, fingerprints, initials, profile, wallet or ledger data: an entry cannot be replayed into the simulation and is not score evidence. |
| When | On `RUN_END`, when `REG.LAST_GHOST_TAPE` belongs to that record. Gym, replay and guest-practice runs record no ghost tape, so they are never kept. `RunScene` is unchanged. |
| Count budget | `attemptHistoryKeep` per course: default **5**, range **0..40**. 0 records nothing new. |
| Byte budgets | ≤ **256 KB per attempt** (~12 min of riding; longer attempts are not kept) and ≤ **12 MB for the whole store**. |
| Eviction | FIFO by insertion sequence: oldest first within the course, then oldest across all courses if the byte budget is exceeded. Only this store's rows are ever deleted. |
| Lowering the limit | Trims at once (oldest first). Raising it cannot bring evicted attempts back (Settings says so). |
| Quota | If the browser refuses the write, the store frees the oldest half of **its own** rows and retries once; if it still fails, nothing is half-written and the in-memory index matches disk. |
| Damage | Malformed rows are dropped and deleted at start; a pose row whose size or values are wrong is skipped. |
| Clear | Settings → PAST ATTEMPTS → CLEAR HISTORY, two presses within 4 s. Deletes every kept attempt; nothing else. |
| Privacy | Device-local only. No upload, sync, share, analytics or network request (the browser test asserts zero non-GET requests). |
| Never touched | GhostLibrary courses/tapes (Best, Latest, Favorites A/B/C), replay-evidence archive, leaderboards, save store records, physics, RNG, score. |

## Settings → PAST ATTEMPTS

A new action row in Settings (17 rows; the panel still ends at y = 264 of 270) opens:

- **MONTAGE STYLE**: MONTAGE / SWARM / OFF (OFF hides the Game Over button).
- **PAST ATTEMPTS TO KEEP**: `0 (OFF)`, 1 … `40 (MAX)`. The maximum is written on the stepper and in the help text.
- **CLEAR HISTORY**: two-press confirmation.
- A live readout: attempts stored, courses, size, and whether it is saved on the device or this session only.

## Rendering budget

- No `GhostRider`, no Matter body, no collision, no event, no RNG, no score: riders are vector strokes drawn from the
  recorded poses with the shared `tracePose()` interpolation.
- The overview's trajectories and graves are painted **once** into a RenderTexture (trajectories decimated to screen
  resolution, so cost does not grow with run length). Per frame, one Graphics object draws only the riders, their short
  tails and (in follow view) the hero's ridge line, with no per-rider allocation.
- **Rider budget, independent of storage:** 40 riders on a standard device, **16** on Chromebook-class devices
  (≤ 4 cores, ≤ 4 GB, or ChromeOS). A `DensityGovernor` halves riders and tails after ~30 smoothed frames over 26 ms
  (never below 4; the hero and the newest past attempts survive) and restores them slowly after sustained fast frames.

## Measured cost (real Chromium, SwiftShader WebGL, this repo's harness)

See `tools/ghosts/cemetery-montage-browser.mjs` (`PERF_ONLY=1 CPU_THROTTLE=n`). Numbers are filled in by the PR that
ships this document; see the PR description for the exact run.

## Why 40 is the maximum

- **Storage.** Realistic 20–80 s attempts cost ~16–17 KB per 50 s; 40 attempts on one course measured ~0.7 MB. The
  12 MB global byte budget then allows roughly 17 fully loaded courses before cross-course FIFO eviction, far below
  browser quotas (hundreds of MB to GBs on ChromeOS) and safe for the 2.5 s IndexedDB open timeout used elsewhere.
- **Display.** Retention is decoupled from drawing: the swarm never draws more than 40 (16 on a Chromebook) riders, so
  keeping more would not show more on the devices we target. 40 is the standard-device rider budget: everything kept
  can be seen at once there.
- **Open time.** Opening reads and decimates every kept trace of the course once; it grows linearly with the count and
  is the cost that a higher maximum would make worse on low-end hardware.

Physical Chromebook frame-time acceptance is still owed (this container has no real GPU).
