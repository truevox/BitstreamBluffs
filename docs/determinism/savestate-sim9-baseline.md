# SIM9 diagnostic fresh-world restore baseline — 2026-11-24

Refs #242 and #119. This is an experiment refresh, NOT a production trusted snapshot implementation or admission of a saved run to the leaderboard.

Exact normal compiled game baseline: main 0229045d1c51a8351df7d0119f407562ccba407f, v2.20.1, SIM9. Two independent fresh Chromium contexts per fixture. The historical experiment failed closed on six unclassified RunScene fields. The six are now classified as presentation only, matching the current shipped fingerprintSchemas.js inventory: bridge look ID, veil, span cache, scratch look result, BiomeFx, and joined-mesh marker height closure. No runtime edits. The launcher uses Playwright's installed default headless browser unless CHROMIUM_PATH is explicitly supplied.

Quick-mode results, with the same old diagnostic harness and these two portability/inventory changes:

| Fixture | Capture tick | Suffix | Evidence at capture |
|---|---:|---:|---|
| contact | 600 | 300 ticks | 2 active non-sensor pairs; 264 bodies |
| hazard | 480 | 280 ticks | 2 hazards hit, 2 Kodiaks, 1 active pair; 304 bodies |

Both had zero reported diagnostic divergence, zero exact sled-state divergence and zero positional error; no capture audit or page errors. Neither case crashed during its checked suffix. Hazard fixture had zero moving hazards at capture, so do not claim moving-hazard proof. The historical generic capture kit skips some fields and does not fully bind alias identity, tick-zero tape history, canonical build/layout identity or actual canonical fingerprints; the old comparison also omits direct tick/score/crash comparisons and telegraph digest. This is diagnostic feasibility evidence only, not acceptance of #242.

Raw JSON: tools/savestate-experiment/results/sim9-0229045d-quick.json
SHA256: 3c29192ace795474e20a8d98994c9924db5cf21a402c14e009e9bcba4aa8163c

Reproduce on the above exact source with only these diagnostic changes: npm run build; serve the build locally via Vite preview. Set GAME_URL to that local origin, EXACT_ONLY=contact:full,hazard:full, then run node tools/savestate-experiment/browser-experiment.mjs --quick --json /tmp/new-unique-report.json. Existing output files cause cached case reuse; use a new path.

Next acceptance slice: source-bound fresh isolated world, canonical per-tick fingerprint and direct score/crash/tick checks, strict complete suffix coverage, explicit class/Matter schemas, versioned envelope and corruption negatives, exact recorder input prefix. Do not close either parent or publish player-facing suspend/load on this evidence.
