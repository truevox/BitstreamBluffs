# #172 experimental downloader controller — owner-quality selection

**Status:** additive, opt-in, developer-facing infrastructure. Stacked on draft #188; not yet enabled in the production game. The original stereo master recordings are immutable; neither downloader nor cache policy removes originals or previously downloaded Lite/Full assets.

## User-approved modes

- **HIGH / UPGRADE:** first download *all required Lite* groups for unlocked/ON songs and current biome, then *all required Full* groups, then optional lookahead. Do not change the existing stem audio engine's physical quality until every required Full group verifies and an actual transport boundary authorizes promotion.
- **SPACE SAVER:** download/use Lite only, but don't delete existing Full assets when changing the choice.
- **NO MUSIC:** stop soundtrack in AudioSynth (already done in #188), abort in-flight downloader operations, schedule zero further media downloads, and preserve all downloaded caches and the player's individual ON/OFF song selections.

## What this follow-on implements

`tools/pwa/music-download-controller.mjs` is a consumer of the existing source-bound, source-hashed group manifests and completion marker protocol. It provides:

- `musicPolicyForPlan`: validate the two derivative qualities belong to the same exact song/group, keep required groups only for readiness, and preserve stable order; never require bonus prefetch groups to play.
- `postMusicPreference`: an explicitly provided **already controlling** service-worker instance receives the preference via `MessageChannel` and returns success only after the SW commits it to CacheStorage; errors and timeout are surfaced, never optimistic.
- `MusicDownloadController.setMode`: serialize policy persistence, use an `AbortController` to cancel a previous in-flight queue, and only start the new queue after the new policy write is acknowledged. No auto-download until caller explicitly invokes this method.
- `_download`: use the same integrity-checked, resumable `downloadRealSong` from #188, with callback-only progress/status reporting. When a download fails (network/quota/hash), future groups are not scheduled and previously finished Lite groups stay usable.
- `atVerifiedBoundary`: revalidate **every required Full group**, synchronize policy writes against preference changes, and change future URL routing only after the provided caller asserted that a genuine song/segment boundary happened. There is **no automatic boundary event hook** in this PR, so it cannot silently claim gapless runtime upgrade; already-decoded WebAudio buffers are unaffected by a policy change.

### Additional fail-closed guard

The original asset downloader now checks an abort signal **after the last asset completes, before writing the manifest, immediately before writing the ready marker, and immediately afterward**. An operation cancelled at the end of a transfer must never report an entirely new offline-ready group. Previously verified data remain reusable.

## Explicit current limits

1. **The shipped Settings control is not wired to this controller.** There is no production SW registration, automated music download, long-term storage permission, consent/progress/repair UI or mobile installation claim. This is an orchestration module with browser APIs injected by its caller, plus unit/integration tests against mock CacheStorage and the existing real-song build-time helper.
2. `atVerifiedBoundary` is an **honest caller-owned contract**, not an independent test that the WebAudio scheduler actually reached a boundary. The future runtime integration must synchronize its command with real song metadata, invalidate queued/decompressed old-quality segments and verify no seam artifacts or phase drift in the actual game.
3. Future production integration must derive source-bound manifests from the exact release music catalog and selected/unlocked biome mask, and package optional Lite and Full assets for real CDN deployment. The prior #188 demo's Ogg derivatives reside in ephemeral `/tmp` only.
4. Device listening approval, autoplay policy, Android/ChromeOS/iOS browsers, quota/eviction, honest offline failures, source-rev upgrades and multiple tabs are open release blockers.
5. **Never delete or overwrite original stereo masters.** New versions and qualities are additive. User choice is not a media garbage-collection permission.

## Focused verification

Run:

```sh
npm test -- --runInBand tests/src/pwa-music-download-controller.test.js \
  tests/src/pwa-music-cache.test.js tests/src/pwa-tiered-music.test.js
npm run build
```

The tests exercise actual source hashes in downloaded fake assets, required-first ordering, bonus-last scheduling, explicit Full promotions, simulated interruption and single-file repair, OFF cancellation, ack failure, and a race between an in-progress Full promotion and a later OFF preference. These tests complement, **not replace**, #188's full original-song Chromium tests.

**Do not merge this draft before #173 → #175 → #179 → #182 → #188 have been independently approved/landed in order.** Keep issue #172 open until a real user can install, choose quality, download authentic selected songs and play offline on device.
