# Luna W4.1 audit — the shop autoprompt

Audited the shop autoprompt against the task's five checks, CC Friday's three notes
(`cc-friday-shop-popup.txt`, `-2.txt`, `-ready-3f9890e.txt`) and the running campaign rules.
Independent verification, not a reread of Home's claims: every number below is from my own run.

The branch moved under me while I audited it. I started at `a20d432`, CC Friday committed `3f9890e` and
`83b0a4b` to `main` mid-audit, and W6 then merged to `e0ae90f`. So this note is anchored to
**`e0ae90f`** (current `main`), with the earlier tips kept for the record. All my work is in an isolated
worktree (`wt-w41-luna`), never the shared `wt-shop-popup` tree, because that tree was being written by
another worker throughout.

**Verdict: PASS on the branch's own gates, after one repair that is still needed on `main`.**

Two defects found. CC Friday fixed one upstream before I finished (`83b0a4b`). The other was still live on
`main` at `e0ae90f` when I stopped: the affordability helper and the shop panel disagreed about what the
shop sells. I repaired it on `luna/w41-shop-affordability-agrees`, with a negative control proving the
defect is real and the repair closes it.

---

## 1. Gates, re-run by me

| Gate | `83b0a4b` (pre-repair) | `e0ae90f` + repair |
|---|---|---|
| `npm test -- tests/src` | 47 suites / 927 tests pass | **50 suites / 964 tests pass** |
| `npm run build` | clean, exit 0 | clean, exit 0 |
| `gate-playthrough.mjs` | 12 / 12 pass | **15 / 15 pass** (W6 added two, I added one) |
| CC's amendment cases A/B/C/E | 4 / 4 pass | 4 / 4 pass |

Logs in `evidence/w4-1-gates/`: `test-src-e0ae90f.log`, `build-e0ae90f.log`,
`playthrough-e0ae90f.log`.

Harness note for the next auditor: unqualified `npm test` also picks up the legacy `tests/` suites, which
have pre-existing failures unrelated to this branch. `npm test -- tests/src` is the campaign gate. And
`npx jest <file>` breaks because it drops the `node --experimental-vm-modules` runner.

### Prohibited actions — clean

No new dependency (`package.json`/lock untouched), `saveVersion` still 1, no new ledger field, no test
deleted or skipped (no `.skip`/`xit`/`xdescribe` in the new suites), legacy `js/` untouched.

---

## 2. The five cases from CC's amendment

Cases A, B, C and E were driven against the **built game** via Playwright (`dist/`, real scenes, real
`GameOverScene`), not unit tests — `evidence/w4-1-gates/probe-shop-cases.mjs`.

| Case | Result |
|---|---|
| Stockpile grows, crosses nothing new → no popup, hint yes | PASS |
| Run crosses a price → exactly one popup | PASS (case B: two prices crossed, `panels: 1`) |
| Level-up unlocks something the bank already covers → popup | PASS (case A: level 6, popup after entry cleared) |
| Broke → neither | PASS (gate: `broke: no hint, no popup`, bank 0) |
| Two prices crossed in one run → exactly one popup | PASS (case B) |

Case A is the one that was genuinely broken at `a20d432` and it is worth recording precisely, because it
was a **reachable, high-value** bug rather than a corner:

`_buildShopAccess` armed a timer to open the shop; if the run also qualified for initials entry, the
timer fired, saw `this.entry` set, returned early — and was never re-armed. The popup was dropped for the
whole Game Over screen. Because Game Over opens entry when `qualifies && worthy && !already && score > 0`,
and `worthy` is `board.length >= 3 || score >= 200`, this hit **every scoring run on a device with 3–9
stored runs** — i.e. the runs that matter most. CC Friday's `_resumeShopAutoprompt` fix at `83b0a4b`
re-arms it after `_leaveEntry`, and case A passes there and at `e0ae90f`. I re-read the fix; it is sound
and covers the shutdown path too (case C).

---

## 3. Retry precedence

All pass in the built game. `confirm` inside the open shop closes it and starts the run; any input before
the timer cancels the popup; no timer or view survives scene shutdown (case C: `viewLeft: false`,
`hintLeft: false`, `overActive: false` after shutdown, no page errors).

---

## 4. Does the affordability helper agree with the shop? — **No. This was the live defect.**

This is the check the task asked for explicitly, and the answer at `e0ae90f` was still no.

`canAffordAnything`/`newlyAffordable` judged the raw `SHOP_ITEMS` catalogue. `shopLayout()` (the panel)
filtered titles out of it with `i && i.slot !== 'title'`. Titles are in `SHOP_ITEMS` deliberately:
`title-rookie`/`title-static` must resolve for `shopItem()`, `equip()` and `isOwned()`, because a level's
title reward and a W5 achievement title both land in `profile.equipped.title`, and titles are equipped
from PROFILE rather than sold by the shop.

So `title-static` (220 shards, `slot: 'title'`) was counted as affordable but never drawn. The failing
state is an ordinary endgame, not a contrived one: **a level-1 player who has bought every item the shop
sells them** (ember 120, warm glow 90, mint rider 100, mono theme 250) **holding 220+ shards**. The helper
says something is affordable; the panel has nothing to sell.

Reproduced in the built game at `83b0a4b` and again at `e0ae90f`
(`evidence/w4-1-gates/probe-title-gap-built.mjs`, logs `title-gap-prefix-e0ae90f.log` /
`title-gap-postfix-e0ae90f.log`):

```
bank 258, flag true, hint shown, popup opened over 9 rows — 0 purchasable (all EQUIP or LVL-locked)
```

That is the exact failure mode CC's note ruled out in as many words: *"anything called affordable must be
genuinely buyable, and a fully-refused shop must yield false."* The equivalence tests believed they pinned
this, but their oracle was `purchase()` over the whole catalogue — and `purchase()` accepts `title-static`,
so the oracle agreed with the helper and both were wrong together. A control test now keeps that
asymmetry on the record: those very shards *do* buy that title if you call `purchase()` directly, which
is why `purchase()` cannot be the oracle.

### What I changed

One predicate, read by both sides, so they cannot drift apart again:

- `soldInShop(item)` in `ProfileStore.js` — the single answer to "can the panel sell this".
- `ShopLayout.js` — the catalogue filter now calls it instead of repeating `slot !== 'title'`.
- `ShopPrompt.js` — `buyableHere()` rejects non-shop items and `price <= 0` before the owned/level/bank
  checks.
- `tests/src/shop-prompt.test.js` — both equivalence directions pinned against `soldInShop`, plus the
  bought-out endgame and a "a run that only crosses a title price does not pop the shop" case.
- `tools/sim/gate-playthrough.mjs` — a built-game "bought-out" case, so the shipped gate would catch a
  regression here without anyone re-running my probe.

Fixing only `canAffordAnything` would have left two independent definitions of "sold" in the codebase,
which is how this happened.

### Negative control

The repair is proven in both directions, not just "tests are green now":

| Tree | Built-game bought-out probe | Gate |
|---|---|---|
| `e0ae90f` (current `main`, unpatched) | **FAIL** — flag true, hint shown, popup over 0 purchasable rows | **FAIL** (14 passed, 1 failed) |
| `luna/w41-shop-affordability-agrees` | **PASS** — no hint, no popup, B inert | **PASS** (15/15) |

Counts differ per base because W6 added two gate cases of its own between `83b0a4b` (12) and `e0ae90f`
(14); the failing case is the same one in both.

The new tests fail against the old helper (verified by stashing only `ShopPrompt.js`) and pass with it.

---

## 5. The flagged departure — boosts

Home declined to treat "boosts not yet owned" as purchasable. **I agree with Home.** Boosts have no price
in this economy: they are level rewards toggled in the shop, not bought. There is nothing for that clause
to match, and inventing a price would be Marvin's economy decision, not an implementation gap. Recorded in
`ARCHITECTURE.md` so the next reader does not re-litigate it. If Marvin wants boosts to be *bought*, that
is a new economy feature, not a fix to this branch.

---

## 6. Screens

The `SHOP: B` hint is right-aligned at x 441..476 on the footer line (y 261..270). Measured with rendered
`getBounds()` in the built game, both palettes:

| State | Footer | Gap to hint left edge |
|---|---|---|
| stockpile + hint, default & colorblind | `...` retry footer, right edge 348 | **93 px** |
| initials entry, default & colorblind | `TYPE INITIALS - ENTER SAVE - SPACE SAVE + RETRY`, right 365 | **76 px** |
| popup open | (no hint drawn) | n/a |

No overlapping text bounds in any state, either palette (`probe-bounds.mjs`: 0 overlaps / 0 failures). The
popup does not cover the score or the awards line. A first attempt at this used pixel-threshold ink
boxes and was defeated by the scanline overlay; rendered bounds are the right tool and are what the
numbers above come from.

---

## What I did not do

No merge, no force-push, no branch deletion — Marvin merges, per the task. My repair is on
`origin/luna/w41-shop-affordability-agrees`, rebased onto `e0ae90f`: `6e0b69d` is the fix and `1ba35d8` the
v2.4.1 CHANGELOG/bump; everything after them is documentation (this note, plus two stale-comment/commit
-reference corrections). Tip `eb72d28`; gates re-run on it — 50 suites / 964 tests, build clean,
playthrough 15/15.

I did not fix W5 audit finding 1 (`creditRun` double-counts trick lands against `metricsFrom`). It is not
in this branch, does not block it, and is recorded separately in `notes/w5-audit-findings-verified.txt`.

## Disagreement left open, not fixed

None on this branch. The one product-level question — whether boosts should become purchasable — is
Marvin's, recorded above.
