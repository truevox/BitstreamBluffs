# Bitstream Bluffs v2.22.0 — PWA / melody-only GitHub Pages release

## Scope and authorization

This release bundles original-source melody-only 33-song R2 audio (PR #337), selective user-consented offline Lite/Full/No Music (PR #335), and a **Pages-only** opt-in offline app shell. It does not alter the SIM9 physics/ruleset or the signed local run/ghost storage layout. On the public GitHub Pages host `https://simulate.sledhead.ing/`, the game registers a scoped service worker when loaded in a secure context. Music recordings require a separate explicit user confirmation in **Settings → Manage Sound → Offline Music**; nothing starts a recording download without consent. The first installation does **not** force reload or take over an active run; refresh/reopen the site after the service worker finishes installation to access offline controls. Install from the browser menu on supported platforms.

## Reproducible build (no upload credentials)

`node tools/pwa/build-pages-site.mjs / dist` with `tools/pwa/production-rollout.json` mode `pwa` (delegates to the pinned `build-pwa-release.mjs`).

* `tools/pwa/releases/melody-only-748a0670/offline-melody-index.bin` is the SHA-256-pinned **1.82 MB** compressed derivative index produced from the fully published immutable R2 manifest; it contains public recording descriptors, never audio masters, login information, or upload credentials.
* Builder fails if the local index, release identity, group count, or **remote R2 catalog bytes/hash** do not match the pinned release. Then builds Vite with exact digest and catalog release, copies index, and generates `sw.js` from SHA-256-indexed shell assets.
* Install refuses incomplete/mismatched assets. The new worker **waits** for old clients to close and never force-takes control (`skipWaiting`/`clients.claim` not used). Old shell caches remain available to old tabs. User saved data, ledger, IndexedDB ghosts, and verified original recording caches are never deleted during SW upgrades.
* GitHub Pages uses the PWA builder and runs a real Chromium offline local-gameplay test after building. **Netlify** still runs its existing `npm run build` and never registers the new worker. Every implementation/release commit contains `[skip netlify]` to protect the discretionary build allowance.

## Release and verification

1. Create a **single bundled merge** on main after the owner-approved release checks pass. Main's Pages workflow builds for the configured Pages base (root `/` on the public custom domain) and deploys. No intermediate PR deployment to Pages.
2. Verify the deployment's GitHub Actions Pages workflow succeeded, then fetch `/`, `/manifest.webmanifest`, `/sw.js`, and `/offline-melody-index.bin` from the **actual public host**. Compare the published index SHA-256 with `a22dcf90efc2dfd58531efb6130acd7379e127b9e883252a266af91df4210ade` and confirm the root-scoped service worker.
3. Open the public game in a persistent Chromium profile, refresh once after initial installation. Verify Manage Sound includes Offline Music with High, Space Saver and No Music choices, storage estimate, cancel/repair. Confirm an offline local run, actual seven-buffer mono playback after consent, and persistent saved run/ghost on reload. Do **not** remove public music originals or R2 version URLs.
4. Run a separate **Second Look** on the live host: network-off launch, two controlled tabs, interrupted download/repair, and local record/ghost persistence, noting browser limitations. Physical Chromebook/Android install/touch/space-constrained tests remain needed; this is a staged prealpha PWA release, not an announcement of complete native-device certification.

## Rollback (no data loss)

Record the preceding release commit before merging. For emergency disablement, change **only** `tools/pwa/production-rollout.json` from `{ "mode": "pwa" }` to `{ "mode": "rollback" }` in a reviewed `[skip netlify]` commit/PR on main. Pages then builds the ordinary Vite game (no offline controller or auto-registration) **plus a tiny safe retiring `/sw.js`**. That worker waits for any active old-version clients to close, activates, then unregisters itself. It deliberately does **not** wipe CacheStorage, IndexedDB, audio, profile, ghosts, or game saves. The original immutable R2 release remains public and playable online. This is an **online rollback**; installed clients cannot expect offline launch after the retirement takes effect. Return to `pwa` mode for a new pinned offline release. Do not just delete `/sw.js`: already installed clients would remain controlled by the previous offline build indefinitely. Verify both the rollback worker state transition and live restored game on the actual host.

## Evidence from pre-release Chromium gates

* Root base `/`: zero persistent-profile installability errors, service-worker control and actual disconnected Matter physics with real audio and PauseScene resume.
* User-consented Lite and Full on immutable public R2; 100-source all-33-song SHA-256 sampling and separately audited full published inventory.
* Native seed `sim-05@0` run crash to a valid, committed 166 m / score 166 ledger and SIM9 ghost; offline close/reopen restores same record and visibly renders matching Best/Latest ghost.
* Two different compiled app versions: waited through two live tabs, retained exact music SHA-256, native scored run, ghost tape and playback after cold offline update.
* Two-song original-source offline crossfade (14 overlapping audio nodes), cancelled R2 Lite download after 22 responses resumed using 20 already-verified entries, corrupted stem fails closed (503) and repair finds it.
* Latest focused suite 213/213 passing, earlier broad Jest suite failures independently reproduced on base. Root-build Pages CI and actual deployed-host Second Look are additional release gates.

## Verified emergency rollback test

`node tools/pwa/build-pwa-rollback.mjs / <rollback-dist>` builds the normal online game plus a safe retiring `sw.js`; `node tools/pwa/test-real-pwa-retirement-browser.mjs <published-pwa-dist> <rollback-dist> /` tests the real change. Chromium validated that the retiring worker waits while two PWA clients are open, then unregisters after both have closed, returning a fresh online tab to the normal non-PWA game. The saved localStorage sentinel and **all three actual R2 recording/catalog caches** and prior versioned shell cache survived intact. There were zero JavaScript errors. Release mode is controlled by the single `tools/pwa/production-rollout.json` file; flipping its `mode` to `rollback` produces the tested retiring worker through the same Pages workflow, without a manual destructive cache operation. Netlify stays unchanged.
