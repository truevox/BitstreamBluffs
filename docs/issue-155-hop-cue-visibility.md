# #155: Ground hop-cue visibility baseline

This developer-only probe demonstrates a visual warning gap in the existing camera/telegraph path. It does **not** change that path, implement Pulp, establish how often live play hits the condition, or validate 100% Pulp. Keep #155 open.

## Run on the pinned compiled game

Use the full game build from commit `47615f9ac21251a3192b1d159ae18ff56e7632f7`, or an equivalent build whose module entry has exactly the hash in the script. Build from that checkout, serve its `dist` over loopback, and run this script from a checkout with Playwright and Chromium installed:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 8455 --strictPort
# In another terminal; omit CHROMIUM_EXECUTABLE to use Playwright's browser.
CHROMIUM_EXECUTABLE=/path/to/chromium node tools/qa/hop-cue-visibility.mjs --url http://127.0.0.1:8455/
```

The runner checks the loaded entry bytes, not just the filename. The commit identifies where this baseline was checked; the one entry hash does not authenticate the entire checkout, dist directory, or public asset set. The browser gets a new disposable context per trial. Only GET/HEAD to the selected loopback origin are permitted; redirects, WebSockets and service workers are blocked. The probe does not save a run or ghost or export any images. Normal boot can initialize disposable settings.

## What it measures

Both fresh stock runs take the normal `sim-11` setup to tick 120, then freeze before fixtures are applied. A synthetic 40×24 ground hazard (not the stock Packet Spike geometry) is passed only through the actual `RunScene.updateGroundTelegraph` call; it is never added to the physics world. Two planner samples move its predicted arrival from the warn range into the hop window. The previous rendered right edge and the current render right edge are independently controlled; the rider remains in frame for the captured case. The injected framing (rider x≈415/437 in the two capture views) is **not** the default follow camera or a Pulp camera path. All arms use zero roll and zoom 1.

The actual `GroundTelegraph` graphic draws the column or the edge badge. The runner captures the real triangle supplied to Phaser, projects it through the camera matrix, and compares the composed WebGL framebuffer with just the telegraph graphic hidden. It checks that the two shown frames bracketing a hidden frame yield exactly the same pixels, that the unhidden frame is not blank, and that the positive controls change pixels inside the expected cue bounds. This is pixel evidence, not just a changed `onScreen` flag. Counts are indicative for the tested Chromium/GPU; assertions require the observed absence or presence, not specific counts across platforms.

| Render case | Cue triangles (screen x) | Observed pixels changed near cue |
| --- | --- | ---: |
| Current 480-pixel viewport, hazard spans x478–518 | Column, x489.75–506.25 | 0 |
| Same viewport, planner's narrower prior edge selects badge (positive control) | Edge, x445.75–462.25 | 140 |
| Camera retreats 64 px after prior frame classified the hazard on screen | Column, x511.75–528.25 | 0 |
| Same retreated viewport, matching planning edge selects badge (positive control) | Edge, x445.75–462.25 | 127 |

Every arm requests the same warn sound at 800 ms and hop sound at 1000 ms, with identical warning marker and predicted arrival (~1329.93 ms). This compares sound **requests**, not audio output. The sampled run tick, clock, sled pose and score stay unchanged; this is not a complete subsystem parity check. The report is emitted only after both fresh Chromium contexts reproduce the same observations.

For a future fix, preserve the existing camera-independent warning and hop schedule. Separately, decide badge versus column from the **current projected cue bounds** in the renderer, not the planner's stale view or whether the hazard's left edge merely overlaps the viewport. A real Pulp comparison still needs real canary runs, moving/rotating framing coverage, and the separately owned #140/#117/#118 work.
