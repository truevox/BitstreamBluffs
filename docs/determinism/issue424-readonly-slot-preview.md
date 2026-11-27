# #424 — Read-only one-use Suspend slot status (pre-UI foundation)

This narrow source seam is **not** player Save/Resume, proof of eligibility, or an alternative slot database. LocalSuspendSlot.peek(expectedIdentity, registeredLayout) is a read-only IndexedDB transaction that reads a detached snapshot and validates it **after the transaction closes**, avoiding long locks against another tab's real atomic claim.

The only successful states are **empty**, **claimed** and **ready**. The ready result includes an exact-build, strictly envelope-only runId/tick display hint, never the candidate bytes, claim token, restorable world, rank eligibility or Verified status. Failed states are **incompatible** (old/foreign build, physics, Matter, layout or unsupported envelope version), **corrupt** (invalid bytes, binding or state), and **unavailable** (storage permission/error). Unknown data is never deleted, replaced or downgraded. This method cannot fix a stale claimed token after the owner page dies, and **must not promise** that a ready result remains available: the authoritative claim() happens separately, atomically, at the explicit future player action.

The shared inspectStoredReady helper prevents peek and claim from drifting on identity, layout or envelope checks; neither checker authenticates who earned the run. A future Title menu can use the status hint to display a disabled Resume/repair message and must revalidate at claim time. No render loop should poll this method; the eventual UI should sample upon opening the menu and after deliberate relevant actions.

Verification (Gal Friday engineering, not a new Marvin decision):
- Fake IndexedDB regression for status transitions, old-build refusal without stealing a slot, corrupt persisted binding, denied storage, absence of token/bytes, and actual readonly transaction mode.
- Actual Chromium two-tab/real IndexedDB check through test-local-suspend-slot-browser.mjs: empty → ready → claimed across reload → released ready → consumed empty, including incompatible build and competing claims. No HTTP writes.
- Runs into the existing local-suspend-slot-qa.yml gate; no independent second save store.

Remaining #424 and #119: safely activate and publish a fully prepared fresh native scene, consume exactly once, then wire Pause > SUSPEND and Title > RESUME with proper PWA storage/error and physical Chromebook QA. Separate public verification authority stays in #135.

Related canonical context: [[projects/truevox-bitstreambluffs/determinism-opportunities/op-052-heavy-mode-trusted-savestates]] and [[projects/truevox-bitstreambluffs]].
