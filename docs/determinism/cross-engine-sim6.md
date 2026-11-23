# SIM_REVISION 6 replay fixture rebaseline — #236 / PR #240

**Status:** new source-stamped diagnostic evidence, **not** a statement that every browser, gameplay mode, or live leaderboard replay is conformant. Full post-recording verification and independent exact-head review are release gates. Historical evidence is retained unchanged.

## Original historical evidence remains immutable

- `tools/conformance/fixtures/cross-engine/record-meta.json` was recorded at `1e0e52469a7574893349b3f9afa8f0c90ccebe31` (SIM_REVISION **1**). Its tapes predate the current simulator and have no `simRevision` field.
- `tools/determinism/fixtures/*.tape.json` contain older unversioned inputs, while the separately preserved `tools/determinism/portable-math/fixtures/record-meta.json` pins an earlier revision (SIM_REVISION **5**). They are historical testing artifacts, **not** quietly reassigned to revision 6.
- `tools/qa/fixtures/trick-baseline-sim11.json` is pinned to `8dd230bfc7db8f3eed7e73bb0a0b0fb92bfa982b`, its original compiled entry hash and an exact keyboard trace. It is intentionally untouched; rebaseline requires a separately identified, current-build comparable experiment.
- Existing historical-airtime checks use the old `collision-heavy.tape.json` intentionally in its own pinned environment. Do not overwrite their inputs to get a green test result.

## Versioned new evidence

The **nine new recordings** live in `tools/conformance/fixtures/cross-engine-sim6/`, separately from historical tapes. Their `record-meta.json` is schema v2 and contains **per-tape SHA-256**, clean committed source, exact build/physics identity, browser, fixed date, deterministic seed, replay checks and outcome. `provenance-v1.json` pins and verifies the files independently. The full recording was run from clean commit `35ad8ac36d4f05a5866a81bf305aee2d600544cc`, game **2.19.21**, SIM_REVISION **6**, ruleset `sha256:03c7d7c987c2523ae61c1e4dc4c47699b21069d2355bdabdedcf3d0fb85bcb6b`, build ID `sha256:a3f069ee7d73e5229fdafd374b6ccc5e53d6342ff8255e66b152556c72a74d41`. Provenance is from the **recording source**, which is intentionally pinned even if later test/docs-only commits are added to this PR.

All nine runs passed Chromium live-vs-fresh-context replay, changed-calendar-date replay, and no page errors. The inherited original `CE120-KODIAK` route in revision 6 crashed at 432 m before the first 450 m Kodiak encounter. The explicit `CE_FIXTURE_SET=sim6` definition instead uses `CE120-KODIAK-B`: **4,800 ticks, 1,192 m, 1,292 ticks with active Kodiaks**, clean replay. This demonstrates **pack activity, not a measured bear-to-sled collision or shove**. All eight other fixture definitions preserve the original seeds; their causal tape data matched the earlier re-recording after removing volatile recording timestamps/run IDs.

## Actual browser results and supported claims

Fresh-context 120 Hz replays from the same nine versioned tapes were run in Chromium headless shell, Firefox under Xvfb, and Playwright WebKit 27.2 in the official `mcr.microsoft.com/playwright:v1.65.0-noble` container. **27 of 27** fixture/engine rows matched the 120 Hz Chromium reference with **zero causal digest divergence, zero tape checkpoint desync, and identical final outcomes**. Each row used a fresh browser context; the original captured input tape, not an autopilot, drives the replays. A separate old v2.19.20 preliminary set and earlier tests were retained only as preliminary evidence, not substituted for this v2.19.21 claim.

The Playwright version was **1.65.0**. Chromium was **158.0.8127.18**, Firefox **159.0**, and Linux Playwright WebKit **27.2**; host Node **22.22.3** and container Node **26.13.1**. This is **not real Safari/iOS**, not hardware GPU equivalence, and not a certification of touch/gamepad, all biomes, or player-authenticated replays. GPU raster draw is skipped by this diagnostic harness by default; the JS/render-frame simulation paths still run.

Additional multi-cadence, session, and repeat-run tests exercise `chunk-biome-boundaries`, `daily-practice-rule`, and the actual v6 Kodiak encounter at **30, 60, 120, 144 Hz**, **2 sessions per engine**, repeating the first fixture after intervening runs. These check session leakage as well as rate invariance. **All 128 reported matrix rows were clean**: each of two separate browser runners (host Chromium/Firefox and Docker Chromium/WebKit) produced 64 rows. The two runners duplicated 32 Chromium reference cells, leaving **96 distinct engine/cadence/session/run cells**. All had zero causal divergence and tape desync, and the same final outcome. This is a bounded three-fixture matrix, not a complete nine-fixture matrix at all cadences.

**Actual browser reports are preserved** in `tools/conformance/fixtures/cross-engine-sim6/browser-results/` and pinned byte-for-byte by `manifest.json` (SHA-256 for each result); `tests/conformance/cross-engine-browser-results.test.js` validates every row and all 96 distinct cells. There are two fresh 120 Hz reports (18 Chromium/Firefox, 9 WebKit) and two multi-cadence reports (64 rows each). The tests also check that all four reports used the same source, built `index.html` fingerprint, page harness and tape hashes. **These are actual recorded browser outputs, not generated green fixtures.** Raw journal files and working browser profiles remain local diagnostic artifacts under `/srv/friday-audio/bsb-qa-v6-20261122/`; the checked-in JSON reports contain only synthetic fixture/test metadata.

## Reproduce without destroying evidence

```bash
npm ci
npm run build
node tools/ruleset/build-ruleset.mjs --check
node tools/ruleset/build-ruleset.mjs --check-identity
npm test -- --runInBand tests/conformance tests/determinism

# Read committed v6 evidence (no writes to tapes):
export CE_FIXTURE_SET=sim6
export CE_TAPE_DIR="$PWD/tools/conformance/fixtures/cross-engine-sim6"
export GAME_URL=http://127.0.0.1:8412/
npx vite preview --host 127.0.0.1 --port 8412
# In a second terminal, with those same environment variables:
ENGINES=chromium-headless-shell,firefox FRESH_HZ=120 OUT=/tmp/ce-v6-fresh.json \
  xvfb-run -a node tools/conformance/cross-engine.mjs fresh

# To make *new* recordings, start with a clean source checkout and matching
# preview, select a brand-NEW nonexistent absolute output directory:
CE_FIXTURE_SET=sim6 CE_TAPE_DIR=/tmp/bsb-sim6-new-unique \
  node tools/conformance/cross-engine.mjs record
```

The command refuses recording to the checked-in fixture collection, a symlink into it, or any existing directory. `CE_FIXTURE_SET=sim6` refuses a missing input path or a metadata/build mismatch and verifies every selected tape's SHA-256 before browser launch. Older fixtures remain replayable using the default `historical` definition set. No automatic upconversion, authentication, or migration is implied.

## Explicit outstanding limits

- The committed historical fixtures were *not* overwritten or deleted; older tape behavior is an archival rather than a claim that they match the current revision.
- `trick-baseline-sim11` is still pinned to a historical build. No new trick-baseline evidence is claimed here.
- Targeted conformance and determinism tests pass. The **full** repository Jest run at v2.19.21 produced **250 passing suites and 7 failing suites (9 failing individual tests)**. Every failed suite was reproduced on the *identical current-main v2.19.20 tree* (`8db2620` and `3b2498e` have identical Git tree IDs): `tests/tricks/e2e/input-playback`, `tests/performance/e2e/memory-usage`, `tests/tricks/integration/combo-scoring`, `tests/config/unit/env-detection`, `tests/terrain/e2e/multi-chunk-terrain`, `tests/ui/unit/start-scene`, `tests/terrain-interaction.test.js` (CommonJS `require` with ESM test runner). These are **inherited failures, not fixes or newly green tests**; leave their original owners/semantics unchanged, and track independently if necessary. The exact-head independent reviewer remains required before issue closure.
- A built-game playthrough/canary gate and independent exact-head reviewer must still verify the absence of gameplay regressions. Any unavailable or failed gate must be recorded without pretending a pass.
- Runtime provenance captured in a sparse worktree omits large audio media; the local emitted-asset manifest (83 files) is **not** a full all-media parity proof.
