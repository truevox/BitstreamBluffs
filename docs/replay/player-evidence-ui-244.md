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

## Reviewer hardening of the player-facing controls

Native file selection is disabled while any Keep/Unpin/Export/Import action is pending, so a chosen file cannot be silently lost to a busy-action guard. After file choice or cancellation, focus is released from the native input to restore global keyboard/gamepad menu routing. `REFRESH` reads the actual persisted protection-reference snapshot (not the current tab's cached map); cross-tab pin/unpin is reflected before offering `KEEP` or `UNPIN`, and the transaction still checks any subsequent race. The real Chromium integration adds browser checks for native input focus restoration, in-flight disabled state, and cross-tab refresh.


## Independent review: refresh ordering, export recovery, native Escape

A canonical bundle that passes `get()` integrity checks remains **Export-enabled** even when the separate persisted pin-reference query fails. In that case Keep/Unpin stay disabled and the panel explains `PIN STATUS UNAVAILABLE — EXPORT WORKS`. Refresh carries a monotonically increasing operation version; any newer user action supersedes an outstanding Refresh, so late IDB results cannot replace user-visible Import success or failure messages. The native file input has an Escape key handler because the game input router intentionally ignores events focused on native inputs; pressing Escape closes the panel and removes the input and listeners. The real Chromium QA suite now has **13 cases** including all three failure paths. The browser fixture remains a legacy full evidence bundle, not exhaustive current-production run coverage.


## Concurrent run capture and recovered quota writes

Evidence-capture results are retained under a bounded in-session `runId → status` map, while the legacy "latest evidence" registry key is updated only by the currently scheduled run. An older asynchronous save finishing after a newer run cannot replace the new run's status. This does not expose player data to any external service. After an originally failed IDB write is retried and persisted, `REFRESH` checks both the bundle SHA and its **current persisted run-ID binding**; a matching run can safely enable local `KEEP/UNPIN` even though the earlier `capture.ok` flag remains false. A mismatch stays export-only. A separate user-selected import that remains memory-only tells the player to **keep the original selected file**; Export on this panel still targets the current run, not an unrelated imported bundle. A real Chromium QA scenario now covers quota failure, recovery, Keep and Unpin on the recovered recording.
