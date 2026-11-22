# #172 — Non-deployable offline prototype, original music only

**STATUS: experimental developer tooling.** The game **does not** register this worker or call the music downloader. This worktree is intentionally separate from #173 (install manifest/icons). Do not claim the game is an offline-ready PWA, and do not deploy the worker before a separate review and runtime integration PR.

## Owner's soundtrack requirement (2026-11-21)

- Never replace a selected real song with fallback/synthesized music just because the player is offline.
- The offline **required set** is every song that is **both unlocked and enabled**. Other songs need not download until requested online.
- If a player unlocks or enables a missing song while offline, retain their setting and show **DOWNLOAD REQUIRED WHEN ONLINE**; continue with other available real tracks or silence. A previously downloaded/cached song can play even when re-enabled offline.
- A full offline-ready indicator is **false** when an enabled/unlocked song is missing or incomplete; a user who deliberately turns all tracks off can play without downloading music.
- **Owner clarification: upcoming unlock bonuses should be prefetched BEFORE the unlock, not only once the player unlocks them.** When online and the player has consented to music downloads, opportunistically stage the next-to-unlock biome's real music assets for enabled songs. Current playable music gets priority. These advance/bonus downloads **must not be required** for the current "offline-ready" status and must not fetch music for OFF songs. The initial Debutmont menu lead is already required, so the next prefetch target is the first other upcoming biome.
- If an upcoming bonus does not finish preloading and unlock happens offline, give the honest download-required state; never silently substitute fake music.
- For today, all four soundtrack songs are available and **enabled by default**; current progression unlocks *original vocals* separately, not songs. A future song unlock needs a distinct entitlement input. Do not wrongly gate a song on `musicVocals`.
- Only after explicit metered-data/storage consent should we fetch large offline song packs. Do not auto-download a 429 MiB soundtrack merely because a PWA was installed. The device must explain storage and quota risks.

## Real published asset inventory (current repo)

Source: `public/music/catalog.json`, actual normalized `pack.json` and their exact referenced Ogg files, biome/adaptive sources and caption asset. Checked on CT223 using full-media checkout, not merely the sparse review worktree:

| Song | Files (incl. pack manifest) | Exact bytes | MiB |
|---|---:|---:|---:|
| Pope Leo Wants the AI Root Password | 1,315 | 118,992,984 | 113.5 |
| One More Run | 1,096 | 110,195,263 | 105.1 |
| Every Hacker (Runs Out of Code) | 1,242 | 118,136,679 | 112.7 |
| Varmont Is Saved | 1,096 | 102,241,295 | 97.5 |
| **All on, all available** | **4,749** | **449,566,221** | **428.7** |

This excludes unrelated unreferenced music review files, master FLAC and alternative performance experiment JSON. Song caches are *per song*, not one monolithic app cache. Because normal playback accesses segment and adaptive variant filenames, the first conservative candidate inventory includes **all referenced real recordings within a selected song**. Later per-feature optimisation must preserve the original audio mix and pass equivalent offline playback tests.

## Prototype modules and safety bounds

- `tools/pwa/build-offline-worker.mjs`: hash-pins the small built shell (HTML, JS, menu icons, music catalog); rejects mismatched byte content and does not mix game versions. It has **no game registration path**. The browser proof used an **explicit, manual test-only registration** and confirmed offline title launch; that is not a complete music-offline claim.
- `tools/pwa/music-download-plan.mjs`: chooses only unlocked+ON catalog tracks, resolves their complete original audio and adaptive assets, and builds real SHA-256 integrity/version inventories. The song unlock list is an explicit *future* parameter; null means all current songs available.
- `tools/pwa/music-groups.mjs`: selects mandatory real base stems, menu/available-biome melodies and Dynamic Orchestra alternates only when enabled; it also returns a **low-priority bonus lookahead for the next locked biome** before the unlock. Prefetch remains optional, current offline readiness stays independent.
- `tools/pwa/music-cache-prototype.mjs`: only when deliberately called by a future download UI, checks hashes and stores song bytes in a per-song CacheStorage namespace; partial transfers are resumable but never carry a complete marker; missing or corrupt files make `isRealSongDownloaded` false. Cached but temporarily disabled tracks are retained rather than silently destroyed.
- **No live audio routing yet.** The current `StemMusicDirector` still fetches song assets over standard URLs. Future versioned SW routing must only serve a song from its verified complete cache, and must avoid procedural fallback for missing selected tracks. This is an outstanding acceptance criterion, not delivered behavior.
- **No automatic worker activation or old-cache eviction.** Do not call `skipWaiting`, `clients.claim` or delete older version caches while an older client could be running. Define safe-boundary cache cleanup after the replay contract is stable. Cache quota/eviction must never remove saves or corrupt scores.

## Verified now

- Jest: installability, offline worker and song-selection/integrity/cache-downloader tests.
- Full-media source inventory: 4 real songs, **all 4,749 referenced files found**. A first-song version inventory hashed all 1,315 files and produced version `0e06c275cab122f7df3d`.
- Real Chromium: developer-only worker manually registered against locally built Vite preview; title scene reached after disconnecting the network, with no JS errors. This verifies the small shell only; no false audio claim.

## Remaining before actual PWA deployment

1. Independent review of #173 and of this experimental logic, then land safe additive slices.
2. Install/download UX with explicit 100+ MiB per-song size, consent, progress, cancellation and quota handling.
3. Offline-ready indicator from current enabled/unlocked set, per-song full hash verification and download-required messaging. Wire **existing real soundtrack engine** to verified cached Ogg/pack assets through a safely scoped service worker; preserve original stem mixing/adaptive audio. Do not use synth fallback for a selected missing track.
4. Release upgrades retaining old code/asset versions until live runs finish, and retaining the downloaded song cache across game updates.
5. On actual Android/ChromeOS/desktop/iOS devices: complete one or more required song downloads **online**, disconnect, boot, play a full run with **actual audible song stem audio**, switch ON an uncached track offline and verify explicit warning/no fake music, restore network and download, then update and retest saves/ghosts and recordings.

The parent issue **#172 remains OPEN** after any foundation slice merges.
