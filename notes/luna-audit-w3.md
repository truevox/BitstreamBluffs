# Luna W3 audit — round 3 (final)

Audited `feature/progression-w3-biomes` head **`6dcff75`** against SPEC.md §5 W3 gates and review-loop
steps 2–4 in §8, then re-verified at **`03f81d1`** after Home independently landed the same import fix.
Work was done in an isolated detached worktree (`wt-w3-audit`), not the shared `wt-w3` tree, because
that tree was being edited concurrently by another worker while this audit ran (I watched
`src/scenes/GameOverScene.js` change and `tests/sim/` appear and vanish inside one minute).

**Verdict: PASS on the W3 gates at `03f81d1`, after two blocking repairs.** The branch as it stood at
`6dcff75` was not shippable: `GameOverScene` called `shareableSeed()` without importing it, which throws
on the first frame of Game Over for **every** finished run — and 678 green tests did not notice. My
round-2 repairs had also never reached the branch: they were committed to a detached worktree and
orphaned, so findings 4 and 6 were still live.

**Convergent confirmation on defect 1.** I found the missing import independently and proved it RED→GREEN
in this worktree; Home found the same defect independently and committed it at `03f81d1` with a
stronger built-game gate (`tools/sim/gate-playthrough.mjs`, which boots `dist/` and drives
Title→Run→GameOver→Retry→Title). Two workers reaching the same one-line fix from different evidence is
the strongest signal available that it was real and not an artefact of my probe.

What I could not close is recorded below rather than smoothed over: one reproducible HUD regression
against `main` that is outside W3's named gates and not safely fixable by an auditor, and the
`getDailyStats` disagreement which remains a product decision.

The previous round's note is kept as `notes/luna-audit-w3-round2.md` rather than deleted, so what I
claimed then stays auditable next to what turned out to be true.

---

## Gates I ran myself

Every number below is from my own run on the repaired tree (`6dcff75` + this audit's commit).

| Gate | Result |
|---|---|
| `npm test -- tests/src` | **33 suites / 681 tests pass** at `4c6b1ac` (32 / 678 at `6dcff75`; the delta is my regression test) |
| `npm run build` | clean, exit 0, 110 modules, 1,782.60 kB bundle (444.33 kB gzip) |
| 8 named W3 suites + my new one | **9 suites / 105 tests pass** — `terrain-golden-mask0`, `biomes`, `biome-mask`, `biome-palette`, `biome-mission-gate`, `biome-background`, `title-biome-start`, `gameover-biome-actions`, `gameover-build` |
| Golden mask-0 terrain | **13 / 13** (unchanged by my repairs) |
| `npm run gate:playthrough` (Home's built-game gate, `03f81d1`) | **5 passed, 0 failed, 0 skipped** — real `dist/` build, Title→Run→GameOver→Retry→Title, zero page errors |

That last gate is the one I would have wanted and did not build: it boots the production bundle and
drives the actual screens, so it fails on a missing import in a way no unit test can. I re-ran it at my
repaired head rather than trusting the commit message, and it is green.

Harness note, so nobody repeats my wasted hour: `npx jest <file>` fails with a transform error because
it drops the project's `node --experimental-vm-modules` runner. Use `npm test -- <paths>`. That is a
harness quirk, not a failing test.

### Prohibited actions (§6) — all clean

| Check | Result |
|---|---|
| `STORAGE.saveVersion` | **1** at `origin/main` and **1** at head — unchanged |
| `computeLedgerHash` | body unmodified; no `biomeMask` term added (`git diff` shows only a comment line) |
| Deleted / skipped tests | none (`.skip`, `xit(`, `xdescribe(` all absent) |
| New dependency | none (`package.json` / `package-lock.json` identical to `origin/main`) |
| Legacy `js/`, legacy `tests/`, `netlify.toml` | untouched |
| `biomeMask` in `sanitizeRun` | present at `SaveStore.js:171`, and absent from the hash — exactly as §5 requires |

---

## Blocking defect 1 — Game Over threw on every run (**repaired**)

`src/scenes/GameOverScene.js` called `shareableSeed()` at **4** sites but its `ui/Format.js` import line
did not include it. There was no local declaration to shadow it. `_buildStats()` is called
unconditionally from `create()`, so **every** finished run — mask 0 legacy runs included, not just
biome runs — hit `ReferenceError: shareableSeed is not defined` on the first frame of Game Over.

**Why the suite was green.** `gameover-biome-actions.test.js` imports `shareableSeed` *from Format*
and asserts its return values. It tests the helper, never the scene's call path. So the one thing that
could break — the binding inside the module that calls it — was untested. A regression test for a
helper's semantics is not a regression test for its use.

**How it got there.** `225fe8a` (Home's original) had the same missing import. `6dcff75` rewrote the
two `shareableSeed` call sites but not the import. The W3 "COPY dropped the mask" fix therefore
replaced a working two-line expression with a call to a function the file could not see.

**Repair.** Added `shareableSeed` to the existing named import — one line, no behaviour change
intended, and the behaviour it restores is the one §5 asks for.

**Proof, not inference.** A test drives `_buildStats()` through the real module scope:

- at `6dcff75` untouched → `ReferenceError: shareableSeed is not defined` at line 162, on both the
  mask-31 and mask-0 branches → **RED**
- with the import bound → **GREEN**

I also checked the shipped artefact, because a unit test and a bundle can disagree: in the `6dcff75`
production bundle the identifier appears as a **free** `shareableSeed(C)` with no definition and no
local binding anywhere in the file (3 occurrences, 0 definitions). After the repair the identifier is
inlined and appears 0 times — which is what a correctly bound import produces.

### A note on my own round-2 report

My round-2 note recorded finding 3 as **FIXED** and verified `shareableSeed`'s return values. That was
true and beside the point: I verified the helper's arithmetic while the call to it was a
`ReferenceError`. The lesson I am recording for the next audit: **when a fix replaces an inline
expression with a call, check the binding, not just the callee.** A helper's unit tests say nothing
about whether its call site can resolve it.

---

## Blocking defect 2 — my round-2 repairs were never on the branch (**re-landed**)

Round 2 was recorded as PASS with repairs at commit `3742ad8`. That commit exists only in a detached
worktree; `git branch --contains 3742ad8` returns nothing, and it is not an ancestor of the branch
head. Measured on `6dcff75` as shipped:

- `PROFILE_PANEL.h` was still **224**, so the toggle-menu/BACK collision was still live
- `src/data/schemas.js` had **no `BiomeDef`**, while `data/index.js:23` imports
  `import('./schemas.js').BiomeDef` — a dangling typedef
- `TerrainModDef.id` still documented a **three-value** union
  (`'highBandwidth'|'compression'|'wirelessBridge'`) while **eight** terrain mods ship, and five of
  the biome mods (`stickyPatch`, `thermalUpdraft`, `powderFlurry`, `slowMotion`, `echoZone`) were
  absent from the union; `physics` and `lengthPx` were both documented as required, which `echo-zone`
  does not satisfy (`"physics": {}`)
- `package.json` was still **2.3.2** with no W3 CHANGELOG section, against the project rule that
  behaviour-changing work bumps semver and updates `CHANGELOG.md`

**Repair.** Re-applied `notes/w3-luna-round2-repairs-3742ad8.patch` onto the real head (it applies
cleanly, which is itself the evidence it had never landed), and added the missing-import fix from
defect 1 on top.

**The collision, measured rather than asserted.** `overlappingPairs(items)` cannot see this bug:
`toggleMenu` is returned as a separate band and the BACK button is created inside `View`, so neither
is ever in the `items` list the helper tests. Reconstructing both boxes from the real constants:

| `PROFILE_PANEL.h` | toggle rows | menu band | BACK button | overlap | panel bottom |
|---|---|---|---|---|---|
| **224** (as shipped) | 5 | y 160–205 | y 202–218 | **YES, 62×3 px** | 246 (fits) |
| **240** (repaired) | 5 | y 160–205 | y 218–234 | none | 262 (fits in 270) |

The regression test walks levels 1/4/7/10/13/16/29 and asserts the last toggle row clears the button.
It is RED at 224 and GREEN at 240. Its fixture was also corrected to derive `pendingBiomes` from the
real per-biome `unlockLevel`s: the old hardcoded slice made the five-row worst case unreachable, so the
test could not have failed.

---

## Gates I re-verified at runtime, not from a commit message

Each was checked with my own probe against shipped content.

| §5 W3 requirement | Measured |
|---|---|
| Ordinary run uses only **earned** bits | L1/3→1, L4→3, L7→7, **L12→7**, L13→15, L16→31, L29→31; mask 0 never widened. (Crystal Cavern is L16, Underwater Mountain L13 — my round-1 note wrongly said L12 unlocked all five. Corrected here.) |
| `seed@mask` round-trip | `{alpha,0}→"alpha"`, `{alpha,31}→"alpha@31"`, `{alpha}→"alpha"`, `{"",5}→""`; `daily-2026-11-13@21` re-enters at mask **21** through `parseSeedMask` |
| Sectors 0–1 always base | **0 / 800** sector draws across 400 seeds at mask 31 |
| Biomes do appear from sector 2 | **264 / 400** sector-2 draws at mask 31 (the gate is not dead) |
| Determinism | 50 seeds × 8 sectors identical twice; mask 0 → **0 / 2000** draws; one bit set admits only its own biome |
| Toggles reflect earned bits | L7 → 3/5 toggleable; `sanitizeProfile` preserves `biomeMask: 21` |
| Daily mask independent of time of day | same date key at 00:00 and 23:59 → **8** both |

### Per-biome screenshots in both palettes — **now evidenced by me**

Round 2 left this to Seeking. I ran it: `node tools/sim/shots.mjs biomes` captured **10 fresh frames**
at the repaired head, all reporting the biome and sector the driver intended.

But a screenshot is not evidence of a tint, which is the trap that bit this branch twice. Home's
original ten frames differed only because the *global* palette was switched, and every file still
contained base-palette colours. So I sampled pixels, and my first attempt was also wrong: an exact-hex
search fails because scanlines and the backdrop composite over every pixel, so a declared `#5fe8c0`
never appears verbatim. Exact matching reported 2 of 5 biomes as "untinted", which was my probe's
fault, not the code's.

The check that actually holds is **cross-biome comparison at one fixed palette**:

| palette | distinct dominant colours | verdict |
|---|---|---|
| default | **5 / 5** | distinct worlds |
| colorblind | **5 / 5** | distinct worlds |

`crystal-cavern #220f34`, `debumont #0b0f21`, `garbage-dump-glacier #0e251e`, `pyramid-peak #311d0d`,
`underwater-mountain #08263f`. Five biomes, five different worlds, in both palettes. As a secondary
signal each dominant is nearer its own biome's declared colours than the base palette's for 4 of 5;
`debumont`'s `bg` (`#070a18`) is simply close to base `bgAlt` (`#0c1024`) by design — it is the
original slope, and its frame is still clearly distinct from the other four.

### Per-biome sim table — **now re-derived by me**

Round 2 trusted `t_4cbda86d`'s numbers. I re-ran the table myself with the documented command:

```
node tools/sim/run.mjs --seeds 8 --policy hop --maxM 2500 --biomeMask {0,31}
```

| mask | mean dist (m) | vs base | mean max speed | vs base |
|---|---|---|---|---|
| 0 (base) | **1624.6** | — | 962 | — |
| 31 (all five) | **1531.7** | **−5.7 %** | 970.5 | +0.9 % |

Reproduces the published −5.7 % exactly, against the stated 15 % tolerance. Two limits I confirm
independently and that should stay in the PR body: with `--policy handsOff` at `--biomeMask 31` all
three seeds die at **311–398 m**, before biome terrain begins at 1000 m, so `hop` is the only policy
that exercises a biome at all; and Debumont's effect stays within noise on a hop run because its mod
is ground drag and a hopping sled is mostly airborne. That is a harness limit, not evidence the biome
is cosmetic — its multipliers are separately proven to reach `PhysicsTuner`.

---

## NOT repaired — recorded for escalation

### HUD text overlaps are worse at W3 head than at `main`, reproducibly

The W2-family HUD probe (`node tools/sim/shots.mjs hud`, 13 scenarios) is clean at `main` except one
pre-existing `touch` collision, and reports **8** colliding scenarios at the W3 head:

| scenario | overlap | size |
|---|---|---|
| `landing-boost`, `landing-boost-later`, `hint-banners-keyboard`, `hint-banners-gamepad` | `0.9 S…` × `PERFECT LANDING +20` | 48×5 |
| `landing-combo-flow` | `0.9 S…` × `BANKED +123,456` | 48×16 |
| `milestone-best-miss` | `SECTOR 12  +1,500` × `BACKFLIP x1.5 +640` | 174×14 |
| `milestone-best-miss-2` | `NEW BEST DISTANCE` × `BACKFLIP x1.5 +640` | 174×14 |
| `touch` | 3 collisions incl. the pre-existing one | — |

This is stable, not flaky: `main` gave 1 colliding scenario on 4 consecutive runs, W3 head gave 8 on 4
consecutive runs (`hud.json` in `evidence/w3-audit-luna/`). The probe script is byte-identical between
the two heads, so the delta is in `src/`.

I did **not** fix it, and I want to be explicit about why rather than hiding behind "out of scope":

- **HUD overlap is not a W3 named gate.** §5's W3 gates are golden mask-0, determinism, mask-scoped
  stats, the per-biome sim table, and per-biome screenshots. This was a W2 gate.
- **My first two hypotheses were both wrong**, and I have the probes to prove it. I guessed the cause
  was the strip leaving `stackY`'s slot list; direct arithmetic on the shipped helpers showed the strip
  lands at y 73–90 and the popup at 100–108, no collision. I then bisected commits and found `8dd866e`
  clean / `6dcff75` regressed, but those two commits have **identical `UIScene` layout code**, so the
  cause is elsewhere. An auditor who has disproved two theories and not found the third should not
  commit a speculative rewrite of the HUD stack.
- **The fix is not safe or unambiguous.** Re-stacking the centre HUD is exactly the kind of change that
  produces another invisible overlap; the task's instruction is to repair only what is safe.

**Smallest decision needed:** whether this ships to Marvin as a known cosmetic limit on PR #18 with a
follow-up ticket, or blocks the merge. My read: the collisions are text-on-text in transient popups
(never on a fixed HUD row), no player-visible label is permanently obscured, and W3 did not add the
affected elements — but 8-versus-1 is a regression, and "cosmetic" is Marvin's call, not mine.

### `getDailyStats` still does not filter by mask (D6) — unchanged, deliberately

Unchanged from round 2 and still recorded rather than reversed. I re-measured the disputed claim: for
`2026-11-13` (date-derived mask **8**), one daily seed string is playable at **three** masks — DAILY
RUN → 8, bare ENTER SEED → profile mask 0, `daily-2026-11-13@31` → 31. So the code comment's invariant
("the seed already scopes the mask") is **false**, and D6's requirement is genuinely not met.

The counter-argument the standing ruling rests on is real and I measured it too: across 730 days,
**324 (44.4 %) derive mask 0** and 406 (55.6 %) non-zero, so filtering would hide every pre-W3 daily
record on the non-zero days.

CC Friday ruled on 2026-11-13 that daily stays unfiltered. Reversing a lead's decision is not an audit
repair, so it stands, and it is written into the CHANGELOG under "Known disagreement" so it ships
visible rather than silently.

**Smallest change if the ruling is revisited:** one line in `getDailyStats` passing
`{biomeMask: DailyPatch.biomeMaskForDate(d)}` into `getSeedStats`, plus updating the two tests that pin
the opposite behaviour (`savestore.test.js` "getDailyStats uses the UTC day seed"; `biome-mask.test.js`
"daily stats are scoped by the daily seed, which already fixes the mask").

### Crystal Cavern's `scoreMul` versus D2's "bounded physics mod" — Marvin's call

Genuine spec conflict, not a defect: W3 asks for the *existing* terrain-mod schema **and** specifies
Echo Zones ("tricks landed inside score a combo bonus"), which `frictionMul`/`gravityMul`/`bounceMul`
cannot express. The branch resolves it with an additive `scoreMul` clamped `>= 1`, applied to banked
trick points only. I documented the field in `TerrainModDef` but did not rule on whether D2 permits it;
`data.test.js` enforces that a mod declares at least one of `physics` or `scoreMul`, so no mod can be a
zone the player cannot feel.

**Decision needed (design, D2):** keep `scoreMul` as a schema extension, or re-express Crystal Cavern
as physics-only and lose the spec's stated mechanic.

---

## Files I changed

Commit **`340b345`** on `feature/progression-w3-biomes` (rebased onto Home's `03f81d1`, which already
contains the `shareableSeed` import — so this commit does **not** re-apply it). Portable patch:
`notes/w3-luna-round3-repairs.patch`.

| File | Change |
|---|---|
| `src/scenes/GameOverScene.js` | bind `shareableSeed` in the `ui/Format.js` import (**blocking fix**; landed by Home at `03f81d1` — not re-applied here) |
| `src/ui/ProfileLayout.js` | `PROFILE_PANEL.h` 224 → 240, with rationale |
| `src/data/schemas.js` | add `BiomeDef`; correct `TerrainModDef` (`id` union of 8, optional `physics`, `scoreMul`, optional `lengthPx`, camelCase `mod` note) |
| `tests/src/profilelayout.test.js` | toggle-clears-BACK regression test; fixture derives `pendingBiomes` from real `unlockLevel`s |
| `tests/src/gameover-build.test.js` | **new** — drives `_buildStats()` so a missing binding fails loudly |
| `package.json` | `2.3.2` → `2.4.0` |
| `CHANGELOG.md` | `v2.4.0` section incl. the ReferenceError fix and the recorded disagreement |
| `notes/luna-audit-w3.md` | this note (round 2 kept at `notes/luna-audit-w3-round2.md`) |

I did **not** touch `TitleScene.js`, `Missions.js`, `MissionsService.js`, `ProfileStore.js`,
`SaveStore.js`, `UIScene.js` or `HudLayout.js`. Home's fixes in the first five are correct and I
verified them independently; the last two are where the unresolved HUD regression lives, and touching
them speculatively is what I argued against above.

## Evidence

`evidence/w3-audit-luna/` — `named-tests.log`, `shots/` (10 fresh biome frames + `biomes.json`),
`hud/` and `hud-main/` (the 8-vs-1 overlap delta, with `hud.json` for each), `sim-mask0.json`,
`sim-mask31.json`, and the four `probe-*.mjs` scripts so every number above can be re-run.
