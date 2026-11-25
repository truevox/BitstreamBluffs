# #244 — Game Over LOCAL EVIDENCE screen (stacked DRAFT)

This is the third **stacked draft** in the local-first chain: protected-references PR #347 → explicit local actions PR #349 → actual user interface here. The two prerequisite PRs must pass review first. No public verification, player tracking, auto-upload, telemetry, reward, wallet operation or Netlify build is introduced.

## User experience

After a finished run, open **GHOST FAV** from Game Over, then choose **LOCAL EVIDENCE**. The Game Over report remains behind a dim layer. All UI actions are explicit and local:

- **KEEP** durably pins the exact finished run's `bb-replay-evidence` bundle to the device's protected evidence registry; it requests browser persistence only after the user's choice. **UNPIN** releases the role but does not delete the bytes. Browser site-data clearing can still erase all saved data, so export separately for backup.
- **EXPORT** prepares the canonical bytes for the run and requests a local download named `64-lowercase-hex.bbreplay`. The filename carries the independent expected digest; SHA checks byte integrity, not who played or entitlements. Nothing is sent to a server.
- **IMPORT** opens the browser file chooser only on explicit user interaction, rejects non-matching names and files larger than the canonical 16 MiB limit before reading, and imports only when the bytes match the filename's digest and canonical grammar. Import does not auto-pin, trust the source as a verified current build, or award a public rank. It displays **UNVERIFIED**.
- **REFRESH** checks the current run's asynchronous evidence capture status; capture results must include the exact `runId`, preventing an older run's digest being offered for Keep or Export. Save failures, non-durable storage and unavailable evidence are visible, not quietly treated as success. A validated run bundle that survived a quota failure in session memory remains EXPORTABLE after verifying its exact bytes; KEEP/UNPIN is disabled until the database truly confirms a durable entry. The button is disabled while checking existing pins, and a visible KEEP choice never silently executes UNPIN based on a stale cache.

Keyboard/gamepad actions: Ghost Favorites Up/Down now includes a selectable LOCAL EVIDENCE entry; arrows move among four archive buttons, Enter/A activates (Back/Escape/G returns). Import is backed by an actual native, transparent browser file input aligned to the Phaser button: mouse, touch and native Tab/Enter have a trusted file-picker gesture. Gamepad attempts focus that native input and show clear instructions instead of hanging on a blocked synthetic chooser. The DOM input and resize listeners are removed when the panel closes. The existing five-ghost display rules and separate favorites storage remain untouched.

## Verification and remaining scope

`tools/replay/test-local-evidence-ui-browser.mjs` exercises the live Phaser-rendered overlay using real Chromium IndexedDB: theme-ready boot, Keep/Unpin, actual browser download, **native trusted file chooser** import, stale run mismatch, simulated quota failure with recoverable exact memory-only download and disabled Keep, and keyboard/gamepad Ghost Favorites → Local Evidence → Ghost Favorites navigation and DOM input teardown. The browser smoke injects a known legacy replay bundle after boot and does not claim a full authored run to Game Over acceptance or physical Chromebook testing.

Still pending before claiming #244 complete: real-player multi-run archive selection (the first screen exposes current run and import, not full browsing), exact-build/ruleset replay compatibility admission, browser quota/resource pressure across realistic full current-production bundles, other browsers and Chromebook hardware, and required independent exact-head reviews + patch version release gate. Local storage never authenticates honest play; eventual public score verification remains separate.
