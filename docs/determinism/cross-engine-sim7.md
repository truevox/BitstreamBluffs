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

## Extended 11-fixture / 3-engine provisional source-pinned evidence — 2026-11-23

The preceding 2026-11-22 receipts tested only two new AirBrake fixtures. **This follow-up expands the PRELIMINARY QA evidence to all eleven SIM7 fixture definitions** and multiple sessions on a critical four-fixture subset. This still is **NOT final goldens** and **NOT approval for PR #248/#251**: Marvin has not frozen numeric AirBrake feel, and the future upgraded-AirBrake/airless/low-atmosphere cases remain to be implemented.

### Exact recorded source and fixture exposure

- Source `374c3a7860ff2d1652a20af89d139965f11cbab1`, proposed game `2.19.22`, **SIM_REVISION 7**, ruleset `sha256:0dcb4d59cf6c2e9ceb6cdfa0a885d90c5f6f284aaba7684e0f0fbe9bfe668a92`, build ID `sha256:5cd303eff81dc0a91524ab165cdd6b4ee25ef55f50ed19e5adddf16e82ff7d4e`. The source has PR #248 marker fix `221f7d6`. A later DOCS-ONLY commit can summarize these results without changing their executable provenance.
- Full, newly created, **external** fixture directory `record-all11-374c3a7-20261123/`, 11 input tapes + source-stamped `record-meta.json`, **11/11 live-vs-fresh matches**, **11/11 date-independence matches**, **11/11 SHA256 tape bytes checks**, zero browser errors, **282 live/fresh tape checkpoints**. No old SIM6 fixture or archive was written.
- The Kodiak route really executed **1,292 active-bear ticks**, with 2,164 airborne ticks and 2,549 contact ticks. The airborne-tricks route really registered helicopter events; the biome-boundary route covered all enabled biome mask bits, crossed sector and chunk boundaries and had actual hazard collision. SIM7 AirBrake pulse recorded **441** true active brake ticks; AirBrake + parachute recorded **1,157** *simultaneously active* ticks, not just input-edge assertions. This is bounded scenario coverage, not all biome combinations or upgrades.
- **Cross-version negative checks re-executed:** genuine source-stamped SIM6 tapes are rejected by the SIM7 build as a DIFFERENT game build; labeling the original SIM6 metadata `CE_FIXTURE_SET=sim7` fails revision-7 validation before any browser launch.

### Actual cross-browser verification (normal BEST/DIED HERE behavior enabled)

| Evidence | Engine(s) | Cases | Result | Tape checkpoints |
| --- | --- | ---: | --- | ---: |
| Fresh-context, 120 Hz, all 11 tapes, one browser context per tape | Chromium shell + Firefox 159 via Xvfb | 22 | **22/22 clean** | 564 |
| Fresh-context, 120 Hz, all 11 tapes | Linux Playwright WebKit 27.2 in the official `v1.65.0-noble` container | 11 | **11/11 clean** | 282 |
| 30/60/120/144Hz, **2 independent sessions per cadence**, replay four fixtures in sequence then repeat the first | Chromium shell + Firefox | 80 | **80/80 clean** | 2,016 |
| Same two-session four-cadence matrix with a separate Chromium reference | Chromium shell + Linux Playwright WebKit | 80 | **80/80 clean** | 2,016 |

Fresh total **33/33 distinct engine/fixture cases** clean; all eleven fixture outcomes, real recorded tape checkpoints and causal, derived and telegraph groups agree with the Chromium 120 Hz fresh reference. The critical matrix runs `chunk-biome-boundaries → kodiaks-on → airbrake-pulse → airbrake-canopy-overlap → repeat chunk-biome-boundaries` in the **same page session**. All **120 unique engine/cadence/session/run-position cases** clean after removing 40 duplicate Chromium reference cells across the two 80-row runner reports. There are **160 reported rows / 4,032 checkpoint evaluations**, of which **120 rows / 3,024 checkpoint evaluations** are distinct. No first causal/derived/telegraph tick differences, no desync, no mismatched final outcome, and no unavailable engine. Firefox ran under Xvfb, and WebKit ran using read-only mounted source + Git metadata in the official Playwright container. **Linux WebKit is not Safari/iOS**.

### Actual production physics trace and live marker smoke

- A separate read-only Chromium per-tick instrumentation (replayed the exact source-stamped two input tapes at 120 Hz, fixed page date) observed the first **AirBrake-only pulse** for **25 simulation ticks (~208 ms)**. Rider `vx` decreased from **530.69 to 401.51 px/s**, `vy` was initially **−75.42 px/s**, briefly increased upward to **−78.29**, and finished at **+4.37** (positive y = down), crossing to descent *within that short pulse*. These are whole-physics net velocities, not a claim that every lost `vx` unit was exclusively spent by the brake. The first sustained AirBrake+canopy segment ran **124 ticks (~1.03 s)** with `vx` dropping **526.79 → 130.50 px/s** and canopy simultaneously active for **106** of those ticks; canopy legitimately sustains lift longer. Both tapes replayed with no checkpoint desync. Exact trace is external.
- Another standalone real Chromium run checked both actual BEST and DIED HERE labels using an intentionally prior best record and matching prior same-seed crash, the harness's **fixed `2026-11-21` clock**, the actual `CE120-CRUISE` seed, and full actual `RunScene.renderFrame`. BEST deferred for **248 frames** while its target chunk was not physically joined; DIED HERE deferred for **247**. Both became actually visible with finite height at **tick 1374**, and **neither called ahead into unjoined active terrain or displayed early**. The 2,400-tick run's **621m/936-point** final outcome matched the unmodified reference and had no page errors. Later label persistence after a marker is behind the rider and its old chunk is streamed away is normal; do not mistake it for premature placement. The earlier unpinned-clock exploratory screenshot is not used for deterministic outcome claims.

### Preserved raw receipts (external CT223, under `/srv/friday-audio/bsb-qa-v7-preliminary/`)

| File | SHA-256 |
| --- | --- |
| `record-all11-374c3a7-20261123/record-meta.json` | `4ab9c1704d0a0b94b17aeb0126411021758f6fd76f1c3ed1c7d1009e5620212d` |
| `fresh-all11-374c3a7-chromium-firefox-20261123.json` | `6c973e015c4e67dc0fdf766ffb414a282904b6135be0fdca7b4746e9668a89b7` |
| `fresh-all11-374c3a7-webkit-20261123.json` | `9990222a57ffb336ca3f1a7fa3c2168d4e327200f7a5ea62c409a3bd572f1475` |
| `matrix-critical-374c3a7-host-2sessions-20261123.json` | `1588ac77d43abbd6190bb5e6b92c2f687704a8ec7c3a4b123214776806a8d4ea` |
| `matrix-critical-374c3a7-webkit-2sessions-20261123.json` | `8f049153fd40ad8ae98c6d3a9fee9f279b1533d0f316b6ff011dd431cbe645bb` |
| `airbrake-physics-trace-20261123.json` | `8c4f184de6f8aafb9ef312b0a4930ea1408188840a02d158d27c85ac92a7811a` |
| `marker-live-deferred-pinned-20261123.json` | `7bb2270e7bcaa5925024f9b6dca4241d34ccd8d900187ba75d992b6c4e17f7ef` |

Original raw journals, all 11 tape files, earlier unpatched/session-divergent JSONs, and the marker-disabled counterfactual are retained outside repo. No raw fixture output has been promoted to final historical goldens. Diagnostic path is not a player-authenticated replay validator or a competitive ranking trust upgrade. Existing inherited built-game failures #241 remain separately red; no source-shipped gameplay code other than PR #248 marker fix is changed by this documentation.

### Final outstanding work (do not waive)

Marvin's **human feel approval** and exact numeric freeze; a separate independent reviewer on latest #248 source including the marker fix; gameplay coverage of upgraded vs stock AirBrake Lift, near-wall, Space Mountain vacuum, underwater/low gravity and meaningful AirBrake response under those conditions; real touch/gamepad and authentic Safari/iOS if desired; final re-record under the **then-final** source if any coefficients change, plus final immutable source-stamped golden storage, independent QA PR review and versioned release. In particular, the critical four-fixture matrix's success is not a claim that **all eleven** fixtures were run in every cadence/session cell, or that the AirBrake scoring (see #157) is balanced.
