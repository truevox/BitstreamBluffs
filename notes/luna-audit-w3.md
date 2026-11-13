# Luna W3 audit — round 2

Audited head `6dcff75` (branch `feature/progression-w3-biomes`) against SPEC.md §5 W3 and review-loop
steps 2–4 in §8. Work was done in an isolated detached worktree `wt-w3-luna`, not the shared `wt-w3`
tree, because task `t_4cbda86d` was capturing gate evidence there concurrently.

**Verdict: PASS, with one residual repair and one recorded disagreement.** The gates are green on my own
runs. Four of my round-1 findings were fixed by Home at `8dd866e`/`6dcff75` and I re-verified each one
independently rather than reading her commit message. Finding 4 was not fully fixed — the toggle menu's
last row still collided with the BACK button — and I repaired that. Finding 2 is an explicit, reasoned
disagreement with CC Friday's ruling and is recorded, not changed.

## Gates I ran myself at `6dcff75`

| Gate | Result |
|---|---|
| `npm test -- tests/src` | **32 suites / 679 tests pass** (678 before my regression test) |
| `npm run build` | clean, exit 0, 1,782 kB bundle |
| Named W3 suites (`terrain-golden-mask0`, `biomes`, `biome-mask`, `biome-palette`, `biome-mission-gate`, `biome-background`, `title-biome-start`, `gameover-biome-actions`) | **8 suites / 103 tests pass** |

Note: invoking `npx jest <file>` directly fails with a transform error because it drops the project's
`node --experimental-vm-modules` runner. Use `npm test -- <paths>`. That is a harness quirk, not a
failing test.

## Round-1 findings, re-verified at `6dcff75`

Each was checked with my own probe against the shipped content, not by trusting the new tests.

**1. Ordinary START RUN ignored the profile mask — FIXED (Home, `8dd866e`).**
`TitleScene.startRun` now resolves mask in the order explicit override (Daily) → `@mask` suffix →
`enabledBiomeMask(profile)`. Measured: level 12 / profile mask 31 → run mask 7 (only earned bits 1+2+4,
since crystal-cavern is level 16 and underwater-mountain is 13 — the fixture in my round-1 note said
level 12 was enough for all five, which was wrong). Mask 0 still yields 0, so no legacy seed changed
meaning. Level 3 / mask 31 → 0, i.e. unearned bits are dropped rather than trusted.

**2. `getDailyStats` is not mask-scoped — NOT CHANGED, deliberately (see below).**

**3. COPY dropped the mask — FIXED (Home, `6dcff75`).**
`shareableSeed()` is now the single source for both the panel text and the clipboard, and mask 0 stays
suffix-free. Verified: `{alpha, 0} → "alpha"`, `{alpha, 31} → "alpha@31"`, `{"", 3} → ""`.

**4. Profile signature toggles covered the biome names — PARTIALLY FIXED, residual repaired by me.**
Home moved the band into `ProfileLayout` so it is unit-tested and stopped listing playable biomes twice.
That fixed the names being covered and the panel overflow. But she sized the menu against the *panel
floor* while the BACK button occupies the panel's bottom strip at local `y = h - 22`, and `toggleMenu` is
returned separately from `items`, so `overlappingPairs(items)` never covered it. With all five
signatures unlocked at h=224 the fifth ON/OFF row overlapped BACK by 62×3 px. **Repaired** by raising
`PROFILE_PANEL.h` 224 → 240 (BACK moves to 218, menu ends at 205, 13 px clear; panel bottom 262 inside
the 270 px canvas) plus a regression test that walks levels 1/4/7/10/13/16/29 and asserts the last toggle
row clears the button. Proven RED at h=224 and GREEN at h=240.

**5. Biome-tied missions were unofferable — FIXED (Home, `6dcff75`).**
`isOfferable` now resolves earned biomes against the shipped defs (`earnedBiomeIds`) and reads the bit
from content instead of the never-set `profile.biomeOrder`. Verified at the real unlock levels: level 16 /
mask 31 draws 64 biome missions per 500 three-slot draws; level 16 / mask 0 draws 0; crystal-cavern
switched off is refused (`false`), earned and enabled is offered (`true`); level 13 (not yet earned)
is refused even with the bit set.

**6. `schemas.js` had no `BiomeDef`; version/changelog missing — REPAIRED by me.**
`data/index.js` referenced `import('./schemas.js').BiomeDef`, a type that did not exist. Added the
`BiomeDef` typedef and corrected `TerrainModDef`: its `id` union was a stale three-value list
(`'highBandwidth'|'compression'|'wirelessBridge'`) that omitted `stickyPatch`, `thermalUpdraft`,
`powderFlurry`, `slowMotion` and `echoZone`; `physics` is optional (echo-zone has `{}` and carries
`scoreMul` instead); `lengthPx` is optional. Documented that `mod` is a camelCase terrainMod id, not a
kebab-case file name. Bumped `2.3.2 → 2.4.0` and added a `v2.4.0 - unreleased (W3 Biomes batch 1)`
CHANGELOG section, per the project's commit/version rule. Every claim I wrote into that section was
re-verified by probe: `sanitizeRun` keeps `biomeMask`; the ledger hash ignores it; sectors 0–1 never
resolve to a biome across 400 draws; `biomeForSector` really forks under `'biome'`; and all five mods
carry a felt effect.

## The one disagreement: `getDailyStats` and D6

D6/§5 says `getSeedStats`/`getDailyStats` compare only records with the same mask, and that records
without the field count as mask 0. `getDailyStats` does not filter. Its code comment justifies this by
asserting "the seed already scopes the mask; that is the invariant."

**That invariant is false.** The seed field accepts a `@mask` suffix, so one daily seed text is playable
at several masks. Measured for `2026-11-13` (date-derived mask 8):

| Entry | Resulting mask |
|---|---|
| DAILY RUN menu → `startRun(seed, biomeMaskForDate())` | 8 |
| ENTER SEED, bare `daily-2026-11-13` → profile mask | 0 or the profile's own |
| ENTER SEED, `daily-2026-11-13@31` → suffix wins | 31 |

Three distinct masks under one seed string. So the daily board genuinely can compare different terrain,
which is the thing D6 forbids.

The counter-argument the ruling rests on is real and I measured it: across 730 days, 44.5% derive mask 0
and 55.5% derive non-zero. On a non-zero day, filtering to the derived mask does hide every pre-W3 daily
record (they count as mask 0). That is not a bug in the filter — those runs genuinely were not played at
that day's mask, and no player could have played one, because the date-derived mask did not exist before
W3. Keeping them is what compares two different terrains.

I have **not** changed this. CC Friday ruled on 2026-11-13 that daily stays unfiltered, after seeing the
same code, and reversing a lead's decision unilaterally is not an audit repair. The disagreement is
recorded in the CHANGELOG under "Known disagreement" so it ships visible rather than silently. **The
decision needed is Marco's/CC Friday's, and it is a product call, not a code call:** either accept that a
daily board can mix masks, or accept that pre-W3 daily runs do not appear on non-zero-mask days. The
smallest code change if they choose the second is one line in `getDailyStats` to pass
`{biomeMask: DailyPatch.biomeMaskForDate(d)}` into `getSeedStats`, plus updating the two tests that
currently pin the opposite behaviour (`savestore.test.js` "getDailyStats uses the UTC day seed",
`biome-mask.test.js` "daily stats are scoped by the daily seed, which already fixes the mask").

## Items left to Seeking / not evidenced by me

- **Screenshots in both palettes per biome.** I inspected the palette merge and the repaint path and the
  geometry by probe, but I did **not** re-run the screenshot gate on this head. The existing ten
  screenshots predate `3753e52` and are not proof of biome tint. Home's cluster in `evidence/` should be
  re-taken at `6dcff75` or the final head.
- **Per-biome sim table.** `tools/sim` has the `--biomeMask` option; task `t_4cbda86d` re-derived a
  worst deviation of 5.7% against a 15% tolerance from its own raw JSON. I did not re-derive it myself.
- **Crystal Cavern `scoreMul` vs "existing terrain mod schema" (D2).** W3 asks for the existing
  terrain-mod schema *and* specifies an echo scoring bonus. Those conflict; the branch resolves it as a
  new `scoreMul` field. I documented the field but did not rule on the conflict — that is a design
  decision, not an audit repair.
- **Home's round-2 tests themselves.** I treated them as claims to verify, and verified the behaviour
  they assert. I did not audit their assertions line by line for vacuity beyond the two cases where a
  stub fixture made my own probe misleading (level 12 vs 16, noted above).

## Changes I made (isolated worktree `wt-w3-luna`, detached at `6dcff75`)

- `src/ui/ProfileLayout.js` — `PROFILE_PANEL.h` 224 → 240, with rationale.
- `src/data/schemas.js` — added `BiomeDef`; corrected `TerrainModDef` (`id` union, optional `physics`,
  `scoreMul`, optional `lengthPx`, camelCase `mod` note).
- `package.json` — `2.3.2` → `2.4.0`.
- `CHANGELOG.md` — new `v2.4.0` section including the recorded disagreement.
- `tests/src/profilelayout.test.js` — regression test "the last toggle row clears the BACK button";
  also corrected the fixture to derive `pendingBiomes` from real per-biome `unlockLevel`s instead of a
  hardcoded slice that made the five-row worst case unreachable.

Suite after these changes: **32 suites / 679 tests pass**, build clean.

I did not touch `src/scenes/TitleScene.js`, `GameOverScene.js`, `Missions.js`, `MissionsService.js`,
`ProfileStore.js` or `SaveStore.js`: Home's fixes there are correct and verified, and duplicating them
would only create merge conflict on a branch she is actively working.
