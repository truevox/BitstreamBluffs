# Official Daily Draft — equal-budget arcade competition

**Owner design:** Marvin explicitly requested two Daily modes: current **Classic**
(no upgrades), and **Draft** (build a fixed-budget sled with upgrades; freely
rebuild whenever you like). **Assistant implementation choice, subject to
balance review:** 1,200 *Draft Credits* under `DRAFT_RULES_VERSION=1`.
The exact budget was *not* specified by Marvin; this number is a first tuning
value, not an owner-locked decision.

## What ships in the isolated feature branch

- Title **DAILY RUN** opens a four-row submenu: `DAILY CLASSIC`, `DAILY DRAFT`,
  `BUILD / REBUILD DRAFT`, and `DAILY DRAFT BOARD`.
- **Classic** preserves the existing date seed, date-derived biome mask and
  Daily Patch rule, and refuses *all* purchased permanent upgrades, boosts,
  and saved Draft ranks. It keeps the legacy v2 clean ledger records and
  leaderboard. Classic is not changed into a second form of modded mode.
- **Draft** uses the very same day seed/mask/rule. Anyone can spend up to 1,200
  independent Draft Credits across the seven published permanent-upgrade
  categories (race speed, hop, flip control, canopy, airbrake, divebomb,
  BSOD grace). Prices use the *cumulative per-rank ordinary upgrade curve*
  for consistent economics; the choices need no purchased ownership.
- The preset is device-local, persisted on the existing v1 profile, separately
  versioned, editable/undoable/resettable at any time in the pre-run editor.
  It **never deducts Data Shards**, changes actual purchased ranks, or
  overwrites the regular upgrade mode flag. Arrow keys/gamepad and mouse/touch
  can edit it. PLAY DRAFT uses the current saved preset.
- At run launch the actual Draft preset is copied into a **frozen run
  snapshot**. Edits after launch cannot affect that run. Daily boosts are
  refused as before; ordinary level-purchased upgrades are ignored.
- Draft's official run identity is `dailyMode:'draft'`, `draftRulesVersion:1`,
  `draftBudget:1200`, and the exact nonzero `upgradeRanks` snapshot. These
  fields are covered by **ledger hash v4**: an outer hash around the existing
  v3 digest, preserving the existing v2/v3 algorithms and historical hashes.
- `Ranking.countsForDraftDailyBest` is the single gate for official Draft
  records: daily seed/mask/rule/flag must match, version/budget must match,
  no standard purchased boosts, active ranks must fit the fixed budget.
  **Draft records cannot rank on CLEAN or standard MODDED boards**. The
  dedicated Draft board lists that day's local initials; Game Over also
  judges and labels Draft runs against this board. Classic daily best remains
  independent. Either official mode counts as one UTC day for the daily
  streak; completing both cannot double-count a day.
- New Seed, typed `daily-*` seed (practice), and stale-date retries cannot
  create an official Draft record. Game Over retries of an official same-day
  Draft preserve that run's frozen Draft loadout and mode, but after UTC
  rollover `RunScene` refuses official status (the old timing protection).
- **Scope of competition:** these are the game's existing device-local
  leaderboards, not a claimed networked global ranking service.

## Validation and release gates

- `tests/src/daily-draft-budget.test.js`: cost curve, 1,200 cap, invalid
  presets, local persistence, no player shard spending or permanent mutation.
- `tests/src/daily-draft-ledger.test.js`: all Draft hash identity fields,
  category isolation, Classic parity, malformed/over-budget prevention,
  same-day streak idempotency.
- `tools/daily-draft-browser-smoke.mjs`: real Chromium keyboard mode picker,
  3-rank canopy editor, save/reload, real official Draft physics, fatal v4
  record, actual Game Over Draft label, saved Draft initials rendered on the
  separate view, and a Classic run that ignores owned upgrades/boosts.

**Do not silently change the budget or price curve.** Any future balance
revision requires a new `DRAFT_RULES_VERSION` and a deliberate decision for
archived/old-rule leaderboards. This feature branch is not a production
release or an authorization to merge to `main`.
