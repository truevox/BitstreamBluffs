# #172 — Real Opus offline routing proof (developer-only)

**Status: experimental draft; no production registration, player download UI, or shipped offline promise.** This branch stacks on the independent offline-cache prototype (#175), which itself stacks on manifest/install shell (#173). No `src/**` production gameplay, soundtrack engine, replay, score or save code is changed. This work adds only developer tooling, a generated test-only worker, tests, and documentation.

## What was proved

- Generated a selected soundtrack inventory from `public/music/catalog.json` and the original `pack.json` files. The inventory honors enabled songs, actual currently usable biomes, Dynamic Orchestra OFF/ON, and opportunistic pre-unlock next-biome bonuses. It fingerprints the **original Opus/Ogg compressed recording bytes** with SHA-256; no transcription, synth substitute, re-encode or remote API is involved.
- The existing selected-real-song downloader caches original pack metadata and stem recordings in per-group CacheStorage namespaces. **Manifest containing exact URL/length/hash is written before the final completeness marker.** Offline readiness additionally requires the integrity manifest, marker and all verified byte contents to exist.
- The manually registered test-only service worker intercepts the **unchanged same-origin music URLs** used by the existing `StemMusicDirector`. It serves only whole, verified group caches. A missing/incomplete/corrupt cache group returns a clear 503 when offline instead of emitting substitute audio; it does not synthesize or cache live network responses. Other music is fetched only when online. Existing service-worker code retains safe versioning/no `skipWaiting`/no early cache deletion.
- **A real Chromium end-to-end test** launched a production build, manually registered the worker, selected *One More Run* only, downloaded the full original base-stem and Debumont-lead groups (**10.06 MiB / 121 real referenced files**), severed browser networking, and reloaded the actual game. The actual `AudioSynth`/`StemMusicDirector` was initialized and reached **playing** with seven decoded original buffers (six stems + Debumont lead), running Web Audio context and **no active procedural fallback music timer**. Two independently fetched real Ogg files matched their SHA-256 and decoded as 12-second stereo audio. An uncached OFF song returned 503. Deleting one of the lead group's cached files invalidated that entire group; another previously cached lead file also returned 503 until repaired. **Zero page errors.**

This is stronger than a standalone codec test: the actual game's music engine could use the original offline sources without modifying its transport. It is not yet a complete user-friendly production-ready offline music system. Automated audible waveform or multi-biome full-run checks, browser/device coverage, persistent settings UX, quota handling, version-upgrade and save/ghost retention all remain open.

## Reproduce on CT223 or a developer machine

A full-media checkout is required because CT223's developer worktrees intentionally sparse-exclude `.ogg` files. The test-only Node HTTP server maps `/music/packs/*.ogg` to the full-media source tree and serves the built app and its generated service worker from the isolated worktree. Nothing is installed on the Netlify site or production origin.

```sh
npm run build
BSB_MEDIA_PUBLIC_ROOT=/path/to/full-checkout/public CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  node tools/pwa/test-real-offline-audio.mjs
npm test -- --runInBand tests/src/pwa-music-integrity-groups.test.js \
  tests/src/pwa-music-cache.test.js tests/src/pwa-offline-worker.test.js \
  tests/src/pwa-music-groups.test.js tests/src/pwa-music-download-plan.test.js \
  tests/src/pwa-install-shell.test.js
```

Do **not** manually register this worker against a production origin. The test uses a fresh ephemeral localhost port and isolated browser context, whose test caches go away when Chromium closes.

## Hard remaining integration gates

1. **Consent-first per-song/per-biome download UI** for the already-selected original music, with progress, estimated bytes, cancellation, interrupted-resume, storage quotas, and honest no-music state. Never silently prefetch 429 MiB; unlocked+ON songs and currently usable real biome leads are mandatory, next pre-unlock biome is a low-priority, opt-in bonus.
2. **Production-only worker lifecycle** with deterministic-playback/conformance, preview and developer-test isolation. The full song must stay on the existing real stem engine; missing selected songs may not trigger the fallback synthesizer. Do not interrupt active run or break save/replay contracts on a worker update.
3. **Real devices and failure tests:** offline gameplay across segments and biomes, source and mix continuity, enabled song switching while offline, optional Dynamic Orchestra arrangements, cache eviction/repair, iOS storage policies, battery/data usage, ChromeOS/Android, uninstalled/reinstalled web app, and persisted progress/ghosts.

**Parent issue #172 remains open; this PR does not authorize a production deployment or closure.**
