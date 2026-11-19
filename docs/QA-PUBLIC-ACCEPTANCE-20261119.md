# Bitstream Bluffs — Public deployment acceptance (2026-11-19)

**Author:** Gal Friday, assistant QA observations, independently of player-reported experience. **Production:** https://simulate.sledhead.ing/ (Netlify HTTP 200), linked from https://sledhead.ing/. **Verified GitHub `main`:** `c20092fab1d6789de2946cb64a1ef45e866365f4` (tree `d8853bb71572bbe30c815e0212bc39114b09a4d7`).

## Real deployment provenance

The public Netlify HTML and emitted JavaScript have the same SHA-256 hashes as our tested production build, **byte-for-byte**. The live HTML and bundle were fetched independently from CT223 via HTTPS, and the repository commit was separately read back from GitHub.

| Artifact | SHA-256 |
|---|---|
| `index.html` | `01e9180c9a681697efddcbef9e27f438d2efbcb88e442bdf78943f7d9ea204e1` |
| `/assets/index-BiIw96XO.js` | `761ba6ededa0388639d63d97af91adfa25443dc4cac185e124d4c1db848dbac0` |

**Repeatable independent check:** after `npm run build`, run `node tools/qa/verify-live-deploy.mjs`. A sparse, code-only worktree can instead point to an existing full production build with `--dist /path/to/full-worktree/dist`. The script is read-only, uses SHA-256 for HTML and JavaScript, and exits nonzero if anything differs or a request fails.

## Actual public Chromium runs

Tested the real deployed game in disposable Playwright browser contexts with `GAME_URL=https://simulate.sledhead.ing/`. No local music assets required, no changes to player data or deployed files. The following tests PASSED:

- `tools/daily-draft-browser-smoke.mjs`: keyboard Daily selection; seven-upgrade Draft editor; credit accounting and persistence across reload; v4 record; Draft-only initials and leaderboards; Classic's refusal of purchased upgrades or boosts.
- `tools/music/smoke-lab-waveform-mixer-game.mjs`: actual source OGG waveform, six-stem mixer, bass duck/boost/solo, gamepad controls, reset, and isolation from the normal soundtrack.
- `tools/fatal-death-countin-real-retry-audio-browser-smoke.mjs`: real BSOD collision, Game Over, immediate retry, the same soundtrack/count-in identity across runs, four drum cues, and full-band recovery without seeking or blocking input.
- `tools/bsod-gym-real-five-flight-browser-smoke.mjs`: five successful uninterrupted Gym Bluffs using actual gameplay/physics.

The first public Daily test falsely timed out despite the menu opening: it compared `view.constructor.name` against unminified class names (e.g. `DailyModesView`). Production Vite renames them (observed `TE`). A dedicated probe confirmed the menu was working. The test now uses **stable menu labels and structural controls**, and the complete public test passed after this test-only correction. No game code changed.

## Historical failing Jest suites, not new-game failures

Seven full-suite failures predate the current release and are identical across the prior combined integration baseline. All are older `tests/` code, largely bound to the archived `js/` implementation that the README explicitly labels read-only and no longer loaded by `src/`:

| Suite | Why it needs separate triage |
|---|---|
| `tests/config/unit/env-detection.test.js` | Self-contained mocked host/window detector, not active runtime |
| `tests/performance/e2e/memory-usage.test.js` | Old `js/` physics/mock benchmark; missing fake FPS and memory metrics |
| `tests/terrain-interaction.test.js` | Uses CommonJS `require` in an ESM Jest suite and archived `js/ModularGameScene` |
| `tests/terrain/e2e/multi-chunk-terrain.test.js` | Legacy `js/` terrain/physics test |
| `tests/tricks/e2e/input-playback.test.js` | Legacy trick/physics playback expectations |
| `tests/tricks/integration/combo-scoring.test.js` | Legacy score/multiplier expectations |
| `tests/ui/unit/start-scene.test.js` | Archived `js/StartScene` expects global Phaser in ESM Jest |

**Do not silently ignore or delete failing tests.** Choose explicitly whether to port each historical behavior to modern `src/` tests or retain it in a separate archived test suite. These failures are not evidence that the public Daily Draft, BSOD, or Music Lab checks failed.

## Draft budget candidate to watch (assistant hypothesis, not owner decision)

At **1,200 Draft Credits**, *Parachute Fuel* rank 12 costs **953 credits**, leaving 247. It unlocks the earned canopy-fuel recovery on a genuine BSOD Bluff. This could be a disproportionately attractive specialist build compared with speed or balanced upgrades; no actual balance advantage has been demonstrated yet. The 1,200 budget was selected provisionally by the assistant, not frozen by Marvin. Don't alter it without evaluating real playtest data and versioning the ranking rules.

## Publication scope

This QA fix and report live on isolated branch `fix/public-browser-smoke-minification-20261119` unless merged separately. No production deployment, mainline change, GitHub settings adjustment, or automatic scheduled monitor was part of this QA pass.
