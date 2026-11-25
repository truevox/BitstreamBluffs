# #244: explicit local archive actions — stacked draft on protectedRefs

**This is a library/API slice only, not yet a player-visible screen.** Its purpose is to make UI wiring explicit and permission-preserving: there is no startup collection, automatic upload, webhook, leaderboard write, wallet read, remote score verification, or implicit pinning of imported files.

- `LocalEvidenceActions.keep({digest,runId,role:'pinned'})` is called only from an explicit user Keep action. Requires an existing durable evidence bundle already bound to that local run ID and asks for browser persistent storage *only after* a committed local protection. The result distinguishes the successful IDB write from whether the browser granted persistence. No guarantee against clearing browser site data.
- `unpin(key)` releases only the designated reference. **It does not delete the bytes.** Deletion remains a separate, explicit action in the archive storage layer and never succeeds while protected.
- `export(digest)` prepares the exact canonical `.bbreplay` bytes, SHA-256 and suggested filename. It **does not itself download or transmit anything**; UI must drive a browser file-save action after user interaction.
- `inspectImport(bytes,{expectedDigest})` requires an externally supplied digest (for example, from the selected file name), checks byte-for-byte SHA-256 and canonical bundle grammar and reports original provenance, course and ruleset. Ruleset equality by itself is explicitly **not** a proof of exact build execution or equipment eligibility.
- `import(bytes,{expectedDigest})` stores an archive-only bundle; it does not fabricate a source run ID (the canonical manifest deliberately excludes `runId`), pin the result, enable automatic replay, or promote the score to a leaderboard. It reports memory-only fallback if IndexedDB is unavailable. A digest and canonical grammar establish integrity, not authorship or authenticity.

All results carry `publicRankEligible:false` and clear `UNVERIFIED`/`LOCAL ARCHIVE` labeling. **An independently authenticated dual-proof verifier is separate and not active.** Next step: build the actual Phaser user controls and browser file selection/export, with visible error/status UI, keyboard accessibility, import cross-build warnings, and live-browser UX tests. This PR is stacked against #347 and must not be merged before that dependency clears independent review and the release version gate.

The import inspector rejects files above the canonical 16 MiB limit **before hashing** and refuses non-Uint8Array views with a stable error. Import reports `localDurable` for that specific bundle via the foundation's persisted byte check, unaffected by unrelated failed pending writes. Re-imports report any existing protection reference count, while accurately stating `newlyProtected:false` (the action creates no new pin).


## Post-commit protection-status failure

Once `importBundle()` commits canonical bytes successfully, a later IndexedDB failure while checking cross-tab protection count must **not** report the import itself as failed. The action returns `ok:true`, `protectionCount:null`, `alreadyProtected:null` and the explicit `PIN STATUS UNKNOWN` warning. It never silently substitutes cached counts. A negative test injects failure only in that post-commit lookup and verifies the imported bytes remain persisted and independently retrievable. All imports remain local and unverified.


A false result from an IndexedDB post-import durability probe is ambiguous: it may mean missing bytes **or** a failed read. After a successful IDB commit, the action conservatively returns `localDurable:null` and `alreadyProtected:null`/`protectionCount:null`, never falsely announcing zero pins. A verified memory-only backend reports `localDurable:false`; when the tab previously had durable storage, its pin count still remains unknown until reconnected. Regression tests inject the ambiguous read after an existing pin.
