# v2.22.2 — PWA device-readiness refinements

This small additive follow-up builds upon the public, root-scoped v2.22.1 PWA described in [the production release](production-release-20261124.md). It does **not** change runtime physics, replay schemas, seed/ghost scores, waveform source URLs, or the 33-song immutable R2 release. It makes the prealpha PWA more usable and resilient on phones/Chromebooks while actual physical-device certification remains open in GitHub issue #172.

## Protect Offline Files (explicit, optional)

The **Offline Music** menu now includes **Protect Offline Files — Lower Eviction Risk**. Opening the menu only reads the browser's `navigator.storage.persisted()` status; that query cannot request permission or transfer media. The browser's `navigator.storage.persist()` is called synchronously from the player's explicit menu activation, not at startup and never as a side-effect of choosing a music tier or opening Settings. The UI distinguishes `granted`, `denied`, `unsupported`, and API failure, and allows a later retry after denial. Protection is scoped to the browser **origin** and reduces eviction risk; it does **not** guarantee permanent data or constitute a backup. The browser may silently grant/deny this request and some mobile browsers do not support it. Importantly, the action does not delete, rewrite, or fetch any music, save, or ghost data.

## Recoverable storage-full behavior

`R2DownloadControls` already checks browser quota before transfer. A device can still reach its limit during a verified `CacheStorage.put` (the estimate is not a reservation). A thrown `QuotaExceededError` / Firefox's `NS_ERROR_DOM_QUOTA_REACHED` is now reported as **Not Enough Storage**, with a post-failure estimate and deep recheck of missing bytes where available, rather than an ambiguous network/verification failure. Incomplete groups never receive valid completion markers; previously verified CacheStorage objects are kept. The player must free space and explicitly confirm **Download / Repair** again. Other failures, including bad audio hashes, remain ordinary failures and are never mislabeled as quota problems.

## First-install user instructions

A fresh, unowned service worker cannot forcibly take over an existing tab. Until the safe install completes and the player reopens/refreshes, **Settings → Manage Sound** now displays **“OFFLINE: REOPEN APP TO ENABLE”**. After the next load acquires a controller, the hint disappears and the usual Offline Music action appears. This is a small, nonblocking first-install hint; no forced reload, update banner, media download, or new telemetry is introduced.

## Verification / rollback

- **145/145** focused PWA/music/UI tests passed in 22 suites, including denial/unsupported/grant/no-consent persistence and mid-transfer quota/retry.
- Real compiled desktop Chromium denial and simulated phone-landscape *touch* approval: exactly one persistence request after a real pointer/touch event; none beforehand; no derivative downloads or browser errors. UI bounds remain entirely within the game panel.
- Real first-install/reopen Chromium acceptance: hint present on first unclaimed tab and replaced with functional Offline Music action after safe refresh.
- Real two-tab A→B SW update: original clients remain on previous shell; new client receives new bundle only after both close, with unchanged saved sentinel and caches.
- Real audio/ghost A→B update: same committed SIM9 166m score, original audio digest, 636-frame rendered ghost and persistent data after offline reopen; zero errors.
- Pages workflow runs persistent install, offline gameplay, first-install hint and storage-protection browser tests for **both PR previews (subpath)** and **main releases (custom-domain root)**. Netlify's default build remains PWA-disabled. All commits use `[skip netlify]`.
- Safe rollback remains the existing versioned retiring worker toggled via `tools/pwa/production-rollout.json`; no browser storage deletion.

**Not claimed complete:** native physical Android/iOS/Chromebook touch/install/low-space behavior, browser-specific persistence guarantees, or seamless Lite→Full promotion in the middle of a continuing crossfade. The latter deliberately remains stopped-boundary-only to avoid mixing already decoded different-quality segments; changes to transport pinning need independent timing/audio QA.
