# W4 audit — Luna

**Verdict: PASS with conditions.** The W4 logic is sound and its own defect repairs are real. Two
screen defects survived the shipped gate: one I repaired here, one is a wording/priority call I've left
to Seeking. Nothing in the workstream needed rewriting, and D1–D6 are untouched.

| | |
|---|---|
| Branch | `feature/progression-w4-bank-shop-boosts` |
| Target head | `d32ad95aa7d0593244fc68527fed791eca9fc7ea` |
| Base | `c8caf02` (W3, on `main`) |
| Audit head | `be77f2b` (my two repair commits on top) |
| Worktree | `/home/hermes/campaigns/bitstream-progression/wt-w4` |
| Superseded, not audited | `3bc06e2`, `5b9f88a`, `24e6d4d`, `5108270` |

## Independent gate numbers

Run on `be77f2b`, in this worktree, after a fresh `npm run build`. Not copied from the operator's evidence.

| Gate | Result |
|---|---|
| `npm test -- --runInBand tests/src` | **43 suites / 791 tests passed** (was 16/338 at the W3 baseline) |
| `npm run build` | clean — 115 modules, `dist/assets/index-D65bi6lF.js` 1,799.03 kB (gzip 449.75 kB) |
| `node tools/sim/gate-playthrough.mjs --with-boosts` | **17 passed, 0 failed, 0 skipped — GATE PASS** |
| `tests/src/terrain-golden-mask0.test.js` | **13 passed, 13 total** |
| `MODDED_RUNS_RANKED` | `false`, still read only in `Ranking.js` |
| `STORAGE.saveVersion` | `1`, unchanged (`src/constants.js:198`) |
| `computeLedgerHash` body | byte-identical to base (`md5 1a221eb5…` both sides) |
| `js/`, `tests/` (pre-existing), `netlify.toml`, deploys | untouched |
| `package.json` / `package-lock.json` | **no new dependency**; `playwright ^1.65.0` was already in the base's devDependencies |
| Skipped / focused tests | none — no `.skip(`, `.only(`, `xit(`, `xdescribe(` anywhere in `tests/src` |

The operator's claimed 42/785 is accurate for `d32ad95`; 43/791 is that plus my six new layout tests.

## Probe 1 — `GameOverScene` `saveEntry()`/`skipEntry()`: CLEAN

Traced by driving the real built game in Chromium, not by reading the file. Every path that reaches
`_showBoard()`:

| Path | Result |
|---|---|
| Non-qualifying boosted run → `_showBoard()` direct | `MODDED // TOP 10`, rec.modded true, clean board 0 rows |
| Entry shown, then `skipEntry()` | `MODDED // TOP 10`, `this.modded` true |
| Entry shown, then `saveEntry('LNA')` | `MODDED // YOU ARE ON THE BOARD`, colour `cyan`, record in modded board with initials, **not** in clean board |
| `retry()` after save | next `RunScene` has `modded: true`, `shieldCharges: 1` |
| `retry()` **while the entry is still open** | pending initials committed to the modded board (`initials: "LNA"`, `modded: true`), next run `modded: true`, shield 1, clean board still 0 |

The defect the operator described is genuinely fixed at `d32ad95`: `_showBoard(highlightId, modded)`
takes the board as an argument and `this.modded` is assigned from it, so no caller can omit it silently.
`skipEntry()` passes `boardsModded(this.rec)`; `saveEntry()` computes it once and reuses it after the
`await`. There is no path where the flag is recomputed from a mutated record.

`boardsModded()` reads `record.modded !== true` first, so a record whose `modded` field was lost would
read as clean — but `sanitizeRun` whitelists `modded` on load and `RunScene` writes it conditionally, so
the field is either present or the run was never boosted. Verified both directions in the browser.

## Probe 2 — `gate-playthrough.mjs` Title block: the exclusions are justified

The Title block's `skip` set (`t.logo[].t` by identity) is legitimate. I walked the TitleScene myself,
tagging logo letters by identity rather than trusting the gate's own set, and found:

- 56 visible NeonText labels: 15 logo letters, 41 everything else.
- Overlaps among the **whole** set: exactly one — `E` ↔ `S`, both logo letters, at y 10 and y 41.
- Overlaps among the **non-logo** set: **zero**.

So excluding the wordmark is not hiding anything. The `E`↔`S` pair is real in the naive measurement and
is an artefact of the 4x art, exactly as the comment claims: two stacked lines of letter-by-letter
bitmap glyphs kerns 32px of ink into a 32px advance, so the boxes touch, and each letter waves ±2px on
the sine. With `count < 30` the step also cannot pass while measuring nothing — I confirmed the walk
reads 41 non-logo glyphs (56 total), well clear of 30, and the dedupe is legitimately needed because
`NeonText` draws each string twice (glow outline + main) with slightly different metrics.

The Game Over block's `ghostA`/`ghostB` exclusion is the same shape and is also legitimate: those are
the chromatic-aberration shadows of the CRASHED header, drawn at ±2–5px deliberately.

**One gap found and closed**: the `<30` guard was on the Title block only. I extended the same
read-the-drawn-rects treatment to the leaderboard board, where the glyph-count guard and the overlap
assert did not exist at all — and that is where the real overlap was living (below).

## Probe 3 — `MODDED_RUNS_RANKED` is a single decision point: CONFIRMED

Grepped `wt-w4/src` for `MODDED_RUNS_RANKED|moddedRanked|isModded|countsOnBoard` and for every bare
`.modded` field read (13 sites in total):

- `MODDED_RUNS_RANKED` is imported in exactly one module (`Ranking.js`) and read in exactly one function
  (`ranksModded`). Elsewhere it appears only in comments and in tests that assert the invariant — and
  `tests/src/modded-ranking.test.js` greps the tree to keep it that way, including a check that catches a
  conditional spread writing the field.
- The bare `.modded` reads are all writes or plumbing, never ranking decisions: `RunScene` sets
  `this.modded` from `boostFx` and spreads it into the record; `Boosts.js` is the single source of the
  field; `SaveStore`'s sanitiser whitelists it; `GameOverScene` stores it for display.
- Every ranking surface routes through the helpers: `_board()`, `getModdedLeaderboard()`,
  `qualifiesForModdedTop10()`, `qualifiesForTop10()`, the seed-best scan and the daily-streak scan all
  call `isRankable`/`isModdedOnly`. No surface tests the field itself.

## Defects I repaired

### 1. `f5baa51` — ledger footnote drawn underneath the MODDED/CLEAN tab (both boards)

**The defect.** W4 added a tab `Button` at panel-local `x = w - 148` (272) on the footer line and left
the footnote at its pre-W4 wording, 329px wide, drawn from `x = 12`. Measured on the built game:

```
footnote  x 32 → 362   y 200 → 208
tab       x 328 → 396  y 197.5 → 206.5
          30px horizontal overlap, 5.5px vertical
```

The tab's border ran through the footnote's last word ("ACTIVE.") on **both** the clean and the modded
board. The shipped `gate-playthrough` step for this view read only `view.tabBtn.label.main.text` — the
tab's label — so nothing ever measured the drawn rects, and the overlap passed a green 17/17 gate. This
is precisely the failure class the Title and shop steps were written for; the leaderboard simply never
got one.

**The repair.** New Phaser-free `src/ui/LeaderboardLayout.js` computes the footnote's start, its maximum
width (`tabLeft - 12 - 8`) and the tab's box from one set of constants, so the two cannot drift.
`fits` compares the **intended** text against the bound rather than the ellipsized result, because
ellipsizing would hide a regression behind "..". Wording shortened to
`MAGENTA = DAILY PATCH. MODDED = BOOSTED RUNS.` (241px), which drops only "ONE LEDGER PER DEVICE" — the
panel title already says "TOP 10 ON THIS DEVICE", so nothing is lost. `Views.js` now positions both the
footnote and the tab from the layout module.

Verified after: footnote ends at x 273, tab starts at 328, gap 55px, zero overlapping pairs on both
boards, screenshots captured before/after.

### 2. `f5baa51` — both empty leaderboards said "NO ENTRIES YET"

`LeaderboardView._loadBoard()` computed `this.emptyText = "NO CLEAN RUNS RECORDED YET"` (or MODDED) with
a comment explaining that an empty modded board must say WHY it is empty. It never drew it:
`LeaderboardTable` hardcoded `NO ENTRIES YET`. So the modded board, the whole point of which is that a
boosted run went somewhere, gave the player no way to tell it apart from an empty clean board.

Repaired by passing the label into the table (`setEntries(entries, highlightId, emptyLabel)`) and
ellipsizing it to the table width so a longer label cannot run off the panel. `emptyText` is kept on the
view for compatibility.

### 3. `f5baa51` — the leaderboard gate step and a flaky Game Over wait

The step now scans drawn rects on both boards, requires a glyph count (`< 8` fails, so it cannot pass
while measuring nothing), asserts no overlapping pairs, and asserts each empty board names itself.

Separately, `playToGameOver()` waited a fixed `3000ms` for the Game Over hand-off. It flaked once in six
runs under load ("Game Over never built: scene inactive") — a false failure that says nothing about the
game. It now waits on the scene's own `isActive() && rec` condition, bounded at 8s: 4/4 green after.

### 4. `be77f2b` — W4 shipped with no CHANGELOG entry and no version bump

`git diff c8caf02..d32ad95 -- CHANGELOG.md` was empty and `package.json` was still `2.4.0`, both of
which the repo rules require for a behaviour-changing workstream. Added the v2.5.0 entry and bumped the
version. No code touched by this commit. `package-lock.json` still records `2.3.2` from before W3 and
was deliberately left alone — that drift predates W4 and `npm ci` is not part of any gate here.

## Defects NOT repaired, and why

**1. `GameOverScene` reuses the clean-board title string for the modded board's empty state.**
`_showBoard('MODDED // TOP 10')` is correct, but the table beneath it still renders the shared
`FINISH A TOP-10 RUN TO CLAIM A SPOT` sub-line, which is clean-board language on a board no clean run
can enter. Cosmetic, ambiguous (arguably "top-10 run" covers both boards), and a copy decision rather
than a defect — left to Seeking rather than guessed at.

**2. `getDailyStats` still does not filter by the date-derived mask.** This is W3's known disagreement,
recorded in `notes/luna-audit-w3.md` and unchanged by W4. Not mine to relitigate here; flagging only
because W4's modded exclusion now touches the same daily surface and the two should be ruled on together.

**3. `LeaderboardTable`'s row pitch (`rowH = 9` on Game Over) squeezes ten rows into 90px.** All ten
rows fit and none overlap — asserted. But the last row's ink bottom lands within 1px of the mission
block's top on a 480x270 canvas, so a longer initials string or a wider score could collide. No current
data reaches it; I did not change a layout that passes, and I am not claiming it is safe for future
wider content.

**4. `Boosts.js` exports `isModdedRun` while `Ranking.js` decides ranking.** Two modules can answer
"is this run modded?" — `isModdedRun(loadout)` (from the loadout) and `record.modded` (from the
record). They are consistent today because `RunScene` sets the record field from that one call, and
`modded-ranking.test.js` pins the single-decision rule for RANKING. But the duplication of the concept
itself is a wart. Not repaired: collapsing them would change the W4 API surface, which the project
rules forbid without being asked.

## Nothing here is un-evidenced

Every number above came from a command I ran in `wt-w4` on `be77f2b`, or from a browser probe against
`dist/` built from that commit. The operator's two evidence files
(`evidence/w4-gates/W4-SCREEN-GATES.txt`, `W4-KEYS-GATE.txt`) are consistent with what I measured,
except that `W4-KEYS-GATE.txt` is labelled head `24e6d4d` — one of the four superseded commits — and
reports 41/782. It is stale evidence; `W4-SCREEN-GATES.txt` (head `d32ad95`, 42/785) is the one that
matches the audit target.

## Screenshots

`lb-clean-before.png` / `lb-modded-before.png` (overlap present) and `lb-clean-after.png` /
`lb-modded-after.png` (clear), captured at 960x540 @2x from the built bundle, in the scratch dir of this
run. The gate now asserts the geometry directly, so the screenshots are corroboration rather than the
evidence.
