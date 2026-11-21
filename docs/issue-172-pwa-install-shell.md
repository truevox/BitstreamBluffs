# #172: Installability foundation — phase 1

**Status:** This slice adds *install metadata and icons*. It is not an offline game yet, and it makes no promise about offline functionality. The service worker, atomic asset cache, safe updates, and persistent save/ghost upgrade testing remain in issue #172.

## Included

- `public/manifest.webmanifest`: same-origin app identity, standalone landscape presentation, name, color and first-party icon locations.
- `public/icons/bitstream-192.png`, `bitstream-512.png`, `bitstream-512-maskable.png`, and `apple-touch-icon.png`. They are generated from the game's own menu logo and sled-rider sprite layers, not third-party assets.
- `index.html`: manifest link, browser theme color and supported Apple home-screen tags.
- `tools/pwa/make-icons.mjs`: optional local regeneration command. Uses already-installed Playwright and first-party SVG sources; **not** part of build or game startup.
- `tests/src/pwa-install-shell.test.js`: manifest, icon dimensions, safe same-origin paths, Apple metadata and unchanged game boot wiring.

Regenerate after updating the menu art (requires locally installed Playwright Chromium):

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium node tools/pwa/make-icons.mjs
```

Validate the slice:

```sh
npm test -- --runInBand tests/src/pwa-install-shell.test.js
npm run build
npm run preview -- --host 127.0.0.1 --port 8293 --strictPort
```

On the local preview, inspect `/manifest.webmanifest`, all `/icons/` assets and the `index.html` manifest link. On supported mobile and desktop browsers, the manifest may enable an install option. This is not an assertion that all browsers will offer install UI: installation depends on browser and platform rules.

## Deliberately deferred

**No service worker is registered or added in this PR.** That means no offline shell, precaching, background fetches, update prompts or cache manipulation yet. The existing `main.js` entry and game runtime remain unmodified.

Follow-up implementation should be developed only after Teams A/B have stabilized the replay and browser-conformance contracts. The service worker must be opt-in for production and explicitly absent from local Vite dev, Netlify deploy previews and deterministic test harnesses. Release versions must not mix HTML or hashed assets across service-worker upgrades; activation must wait for safe game boundaries and preserve IndexedDB/localStorage saves, rankings and ghosts. Optional music and external services must degrade gracefully offline, rather than being naively preloaded. See the full acceptance matrix in issue #172.

**Parent issue #172 stays open after this additive slice merges.**
