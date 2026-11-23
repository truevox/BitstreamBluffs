# SIM_REVISION 7 conformance preflight — issue #249

**Status: EXPERIMENTAL / DRAFT, not frozen golden evidence.** SIM7 is the unmerged, owner-playtest-pending AirBrake balance candidate from [[GitHub PR #248](https://github.com/truevox/BitstreamBluffs/pull/248)]. This leaf is stacked on that PR, not on main. **Do NOT commit final fixture tapes or claim cross-engine parity until the owner has accepted the numeric feel settings and an exact clean source has been pinned and reviewed.**

## What is implemented for preliminary QA

- `CE_FIXTURE_SET=sim7` selects a new **11-case** fixture definition list, based on the nine v6 diagnostic cases plus two explicit AirBrake exercise patterns. Neither the old original `FIXTURES` nor the complete `FIXTURES_SIM6` are changed, and the existing immutable `cross-engine-sim6` tapes and browser reports are untouched.
- `airbrake-pulse` actively alternates short 200ms AirBrake holds/releases after takeoff on the deterministic `CE120-CHUTE` course. `airbrake-canopy-overlap` presses both AirBrake and finite-fuel canopy at the same time. Same seed is deliberate; their recorded inputs differ. The browser hook counts **actual physics-tick active** AirBrake, canopy and simultaneous overlap, NOT merely desired keyboard presses.
- The recording command **rejects** the new fixtures if the actual live `Sled.airBrakeActive` count is under 35 or total airborne ticks under 100; the overlap case also demands 35 live canopy ticks and at least 25 ticks where both controls are active. This avoids false success when the course crashes before the button was truly actuated.
- Recording is still allowed only in a brand-new absolute directory outside *all* versioned/historical tracked fixtures; each tape/metadata is created exclusively (`wx`) and tied to a clean committed source, exact build, ruleset revision, served build index and SHA-256. The read-only `sim7` fresh/matrix/positions commands reject unknown/cross-version/mismatched metadata and tape hashes before any browser is started. In particular a valid SIM6 tape cannot be silently treated as a SIM7 run.
- Existing sim6 source pinning/reader behavior and historical fixture semantics remain unchanged. The page JS instrumented one more **diagnostic-only** count. This does not alter production AirBrake physics, scoring or input.

## Experimental recordings (do not commit as final goldens)

Run from an **isolated, clean, pinned** SIM7 build worktree after `npm run build`. The preview must serve the exact local `dist/index.html` bytes.

```bash
# Separate terminal: same clean worktree, local 127.0.0.1 host
npx vite preview --host 127.0.0.1 --port 8492 --strictPort

# NO output in tools/conformance/fixtures; a new unique external directory:
CE_FIXTURE_SET=sim7 FIXTURES=airbrake-pulse,airbrake-canopy-overlap \
CE_TAPE_DIR=/srv/friday-audio/bsb-qa-v7-preliminary/record-UNIQUE \
GAME_URL=http://127.0.0.1:8492/ PLAYWRIGHT_BROWSERS_PATH=/home/hermes/.cache/ms-playwright \
node tools/conformance/cross-engine.mjs record

# Once a full prospective set is recorded, replay it using exact current build:
CE_FIXTURE_SET=sim7 FIXTURES=airbrake-pulse,airbrake-canopy-overlap \
CE_TAPE_DIR=/srv/friday-audio/bsb-qa-v7-preliminary/record-UNIQUE \
ENGINES=chromium-headless-shell FRESH_HZ=120 GAME_URL=http://127.0.0.1:8492/ \
PLAYWRIGHT_BROWSERS_PATH=/home/hermes/.cache/ms-playwright \
OUT=/tmp/bsb-sim7-preliminary-fresh.json node tools/conformance/cross-engine.mjs fresh
```

## Still required before merging #249

Owner accepts a numeric AirBrake version; PR #248 independently reviewed and merged (the physics needs a new sim revision). Rebase this draft on **main** after that; issue its own versioned QA release metadata. Capture every new SIM7 tape under a new immutable, source-stamped directory. Record real contact/hazard, all 11 (or expanded) paths, and cross-engine Chromium/Firefox/Playwright WebKit (not Safari) fresh and 30/60/120/144 Hz matrix. Pin byte hashes, source/build IDs, checkpoint comparisons, replay/date/session outcomes; retain the raw external evidence. Validate physical AirBrake lift profile beyond input counts, upgraded AirBrake Lift and vacuum/low-atmosphere/biome cases, and actual touch/gamepad paths separately; the two new fixtures by themselves do **not** establish these cases.

This is a recording safety and exercised-control preflight, not an announced SIM7 compatibility certificate or completed production replay implementation. Full-game playthrough inherited failures remain #241 and are not waived.

## Preliminary real-browser receipts — 2026-11-22; not immutable golden certification

The first AirBrake QA pass on source `a060ce9` exposed a concrete **same-session repeat-run terrain digest mismatch** at tick 1150–1153 on all four display cadences: 8/12 Chromium rows clean, 4/12 repeated-pulse terrain mismatches. Diagnostic delta showed a speculative *queued* third chunk (generator `activeList` three chunks vs two, pending queue one vs zero), with identical joined Matter bodies and same RNG/hazards/pickups/outcomes. Root cause was the product's BEST/DIED HERE display marker using a mutating `TerrainGenerator.heightAt(marker.x)` on a future unjoined chunk. A **marker-disabled diagnostic counterfactual** made the 120Hz sequence 3/3 identical; **that counterfactual is NOT the fix**. Source change #253 commit `221f7d6` now guards both real markers against out-of-bounds lookahead via `joinedMarkerHeight` and defers their placement until the terrain is physically joined, while preserving actual user-visible marker functionality. A focused test asserts this presentation read does not pre-generate future physics and allows the identical ground height once joined.

**Reran everything with the actual BEST/DIED HERE markers ENABLED** (no diagnostic suppression) on the corrected source-stamped branch Git HEAD `8085f6a737fc6eb3a98fdfb262ee8029a739238d` (stacked on the fixed #248 `221f7d6`). All source bundles are candidate v2.19.22, SIM_REVISION **7**, ruleset SHA `0dcb4d59cf6c2e9ceb6cdfa0a885d90c5f6f284aaba7684e0f0fbe9bfe668a92`, exact build ID `sha256:5cd303eff81dc0a91524ab165cdd6b4ee25ef55f50ed19e5adddf16e82ff7d4e`. Source-metadata SHA `24500a2c9ff7c6cef8b2b805142198ac38dd3e237a5a85d5d652b0b8adaa8830`. Both actual new tapes recorded live with positive control-exposure checks and passed a fresh-context replay and moved-date replay: AirBrake pulse **441** real active ticks and 14 checkpoint captures; canopy-overlap **1,157** real simultaneous AirBrake+canopy ticks and 30 checkpoint captures, no false input-only simulated activation.

| Real execution environment | Cadences (Hz) | Rows including repeat | First causal/derived/telegraph divergences | Tape desync | Verified checkpoints |
| --- | --- | ---: | ---: | ---: | ---: |
| Chromium headless shell (host) | 30/60/120/144 | **12/12 clean** | 0 | 0 | 232 |
| Firefox 159 under Xvfb (host) + Chromium reference | 30/60/120/144 | **24/24 clean** | 0 | 0 | 464 |
| Playwright WebKit 27.2 Linux container (official `mcr.microsoft.com/playwright:v1.65.0-noble`) + Chromium reference | 30/60/120/144 | **24/24 clean** | 0 | 0 | 464 |

**Overall:** 60 reported rows, 1,160 checkpoint evaluations, 0 divergent/desynced rows; **36 unique** (3 engines × 4 display cadences × 3 run positions) after removing 24 duplicated Chromium reference cells across runners. Every cell executed `airbrake-pulse`, then `airbrake-canopy-overlap`, then repeated `airbrake-pulse` **in the same browser session** to detect exactly the previously failing cross-run terrain contamination. The actual marker-enabled fixed code passed all 4 cadences and all 3 engines. Linux Playwright WebKit is NOT real Safari/iOS, and these headless test results are not touch/controller or player-authenticated trust certificates.

**Source-pinned external JSON receipts on CT223, outside any historical tracked fixture:**

| Artifact (under `/srv/friday-audio/bsb-qa-v7-preliminary/`) | SHA-256 |
| --- | --- |
| `record-issue249-8085f6a-markers-on/record-meta.json` | `24500a2c9ff7c6cef8b2b805142198ac38dd3e237a5a85d5d652b0b8adaa8830` |
| `matrix-issue249-8085f6a-markers-enabled-all-hz.json` | `fe77519280836844d065d05b4249e47cbebb89ddbc09a02fad40bef6d637be73` |
| `matrix-issue249-8085f6a-firefox-allhz.json` | `776320d0e0bb51341a10147cc593be261df8175da6a0084fd522e91b12014cdd` |
| `matrix-issue249-8085f6a-webkit-allhz-gitpinned.json` | `6d70d7c46b9383858683ac03c7e08317f7ffea39a7ebd999ba2b83ffb855f378` |

The WebKit container used read-only mounts of the actual Git common directory, worktree and pinned `node_modules`, and wrote reports to the external QA dataset. Its exact source SHA is **not `null`** (the earlier exploratory container lacked a `.git` mount, was preserved but excluded from these authoritative preliminary counts). Previous unpatched and marker-disabled counterfactual records are retained with their own distinct filenames. No historical SIM6 JSON/tape files modified.

**Scope limit and remaining release gate:** This verifies *two newly defined AirBrake behaviors* with no cross-engine divergence and the corrected session-marker bug, NOT the complete 11-case SIM7 golden suite, upgraded/stock lift, all eleven biomes, touch/gamepad, low-atmosphere/vacuum, two independent sessions, old exact-build verifier archive, or human enjoyment. The numeric AirBrake model is not owner-frozen; this page will need a new exact-current-head source-stamped final run after Marvin's feel feedback, then independent exact-head review and separate QA release. No silent fixture certification or merge from these preliminary results.
