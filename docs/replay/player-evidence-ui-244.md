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

A canonical bundle that passes `get()` integrity checks remains **Export-enabled** even when the separate persisted pin-reference query fails. In that case Keep/Unpin stay disabled and the panel explains `PIN STATUS UNAVAILABLE — EXPORT WORKS`. Refresh carries a monotonically increasing operation version; any newer user action supersedes an outstanding Refresh, so late IDB results cannot replace user-visible Import success or failure messages. The native file input has an Escape key handler because the game input router intentionally ignores events focused on native inputs; pressing Escape closes the panel and removes the input and listeners. The real Chromium QA suite now has **21 cases** including all three failure paths. The browser fixture remains a legacy full evidence bundle, not exhaustive current-production run coverage.


## Concurrent run capture and recovered quota writes

Evidence-capture results are retained under a bounded in-session `runId → status` map, while the legacy "latest evidence" registry key is updated only by the currently scheduled run. An older asynchronous save finishing after a newer run cannot replace the new run's status. This does not expose player data to any external service. After an originally failed IDB write is retried and persisted, `REFRESH` checks both the bundle SHA and its **current persisted run-ID binding**; a matching run can safely enable local `KEEP/UNPIN` even though the earlier `capture.ok` flag remains false. A mismatch stays export-only. A separate user-selected import that remains memory-only tells the player to **keep the original selected file**; Export on this panel still targets the current run, not an unrelated imported bundle. A real Chromium QA scenario now covers quota failure, recovery, Keep and Unpin on the recovered recording.

## Exact-head review: native keyboard, memory recovery and generation-bound Unpin

While the browser's native file input is focused, Phaser's separate menu keyboard path is suspended and bubbling key events do not reach the game's Retry hotkey; Escape still closes the panel, and blur restores the original menu handler. Refresh uses `sharedEvidenceStore()` again when a cached actions controller is memory-only, explicitly retrying a once-blocked IndexedDB upgrade and triggering its pending-evidence flush. The visible Unpin button captures the exact protected-reference generation shown by Refresh/Keep; it passes that token to storage and refuses a replacement role even if another tab's re-import updated the cache later. On an imported file whose quota/write failed, the UI explicitly instructs KEEP ORIGINAL FILE rather than suggesting that the separate current-run Export will back up the import. Browser negative tests cover these controls.

## Full replay hashing and explicit retry on Refresh

A subsequent independent review found that refreshing a 16 MiB replay could synchronously hash the whole file three times, and quota-failed captures would only retry after a different successful run. The new `EvidenceStore.inspectBundle()` reports readability, persisted durability and the exact local run-ID binding in **one** atomic IDB snapshot / SHA pass. Game Over Refresh uses it once, then reads only the much smaller protection index. If the current run's original canonical bytes remain pending after a quota error, an explicit Refresh invokes `retryPending()` even while IDB is already open; no new game/run is necessary. The real Chromium regression confirms that releasing the test quota fault followed by Refresh alone enables KEEP/UNPIN, without an unrelated save. This is local evidence lifecycle only; no upload, leaderboards or public verification.


### Final browser-gesture and quota recovery acceptance

The real Chromium/Phaser UI script now emits explicit per-case progress and exercises **21 cases**. A stalled older test had mocked the obsolete `get()` method; the deterministic stale-Refresh race now intercepts the actual `inspectBundle()` call. The quota scenario keeps the injected write failure active through the first Refresh (ensuring export-only, no Keep), then releases the fault and verifies that the **next Refresh alone** restores the persisted run binding and enables Keep/Unpin. No fresh gameplay or unrelated successful write is required. The browser uses an injected legacy 2,494-byte canonical evidence fixture; it is not a production-corpus storage-pressure claim.


## 2026-11-25 limited real-RunScene evidence-size observations

A disposable read-only Jest harness drove **real `RunScene` update/simulation and `GhostRecorder`**, with inert rendering, against the committed current ruleset. Its source-grounded report (canonical bytes, not guessed) is retained on the owner's CT223 at `/home/hermes/experiments/bsb-244-real-run-evidence-corpus-20261125.json` (SHA-256 `c9c5d268c5b94625bcf0743e1ac9212e7113b3a1336889ce2f6bacde7f7cb9a7`). Out of 15 seed/length attempts, **12 produced structurally valid combined-checkpoint proof packages**: 240 ticks (2,480–2,482 B), 480 (2,847–2,849 B), 720 (3,215–3,217 B), 1,200 (3,956–3,957 B), and 2,400 (5,832 B). Median of the 12 qualifying samples: 3,032 B; aggregate bytes for those 12 packages: 39,380 B. Three longer attempts had no available recorder after the scene ended at tick 867 or 1,511; they were **excluded**, not treated as passing size observations. This is a bounded controlled sample of 240–2,400 ticks, **not** a production player corpus, a realistic full-session storage maximum, quota pressure/corruption certification, cross-browser/ChromeOS proof, or a guarantee that all 15 attempted records would be recoverable.

Independent review also found that duplicate browser downloads can acquire names such as `64-hex-digest (1).bbreplay`. Import accepts a bounded positive decimal collision suffix while still requiring the exact 64-hex expected digest and hashing the file contents. No filename alone can authenticate gameplay or competitive eligibility.


## 2026-11-25 exact-stack browser retry and filename acceptance

The latest real Phaser/Chromium QA report passes **21/21** checks: after two pending canonical bundles fail quota, a controlled still-quota-blocked older digest does not prevent an explicit Refresh from retrying the displayed digest first and making it locally Keep-eligible. A browser download collision suffix like `64-hex-digest (1).bbreplay` is accepted only when its actual file bytes validate against that full digest; unsafe names, paths and malformed suffixes still fail. The Vite production build and deterministic simulation identity are unchanged, and all 272/272 selected replay/ghost/GameOver assertions pass. This does not establish other browsers, physical Chromebook performance, a complete real-user storage-pressure corpus or public score authenticity.


## 2026-11-25 restacked exact-head regression gate

After restacking this third draft onto the latest protected-evidence #347 and local-actions #349 heads, the real Chromium/Phaser integration passes **29/29 checks**. The updated quota fixture distinguishes a transaction whose IndexedDB index read already classified a digest as **new** (safe explicit Refresh retry once quota clears) from an **unknown** write receipt (canonical bytes remain exportable from session memory but are never silently retried or claimed durable, preventing resurrection after an external delete). A separate negative browser check asserts that fail-closed distinction. Cross-tab stale Unpin both false receipts and thrown stale-generation errors reconcile the displayed controls. Interrupted Import retains KEEP ORIGINAL FILE and distinguishes an unconfirmed import, a memory-only run requiring EXPORT RUN NOW, and durable but unbound export-only bytes. No automatic upload, deployment, public verification or leaderboard admission. This Chromium fixture is still the legacy 2,494-byte bundle, not realistic long-run quota pressure; physical Chromebook and other browser acceptance remain outstanding.
