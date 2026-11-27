# #424: compiled real-browser Suspend quota and IndexedDB-loss acceptance

A genuine installed Pages PWA uses native Chromium IndexedDB and a
content-hashed offline service-worker shell. This independent test
does not manufacture a save or monkey-patch the IndexedDB API.

## Real native QuotaExceededError gate

The test runs a stock completed-tick RunScene, pauses it, physically
clicks its Suspend menu row and invokes Chrome's real origin quota
enforcement using CDP Storage.overrideQuotaForOrigin.
The override is calibrated to actual post-install origin usage plus
32 KiB rather than an arbitrary fixed global quota. The real
~260 KiB full native snapshot must not fit.

Observe the actual PauseScene status SUSPEND FAILED: QUOTA EXCEEDED,
the original run still paused at the EXACT same run ID and tick,
the UI leaving latch released, and the IndexedDB slot empty.
Remove the quota override; the player physically clicks Suspend
again. This time the original run ID/tick must be durably stored.
No fabricated GhostTape, synthetic run record or fake IDB provider.

## Browser-side IndexedDB eviction gate

In a SEPARATE ephemeral Chromium profile, install the genuine
PWA shell; create another actual READY snapshot from paused
stock RunScene with a real pointer click. Then intentionally use
Chrome Storage.clearDataForOrigin with ONLY indexeddb storageTypes,
simulating a lost per-origin IDB partition.

Close the source page; take the entire profile offline; cold-open
a new page from the still-cached PWA service worker. Its Title
status must be empty, with R RESUME SAVE absent/hidden,
and IDB must not claim phantom old data. Prove shell cache names
survive and a fresh new stock run starts offline.

This is NOT evidence that the game detected an eviction or
warned the player. It tests safe response to a Chrome-managed
loss, not physical disk-pressure eviction. Real OS eviction,
installed Chromebook test, persistence grant/denial and wider
upgrade/biome configurations remain under #424/#119.

## Local real compiled v2.25.31 evidence

The actual 6.45 MB offline shell was installed (origin CDP usage
about 9.15 MB). Constrained quota usage + 32768 produced
the exact QUOTA EXCEEDED player message while preserving
tick 181 and creating NO READY slot. After quota removal, a
real explicit repeat click wrote a 260,606-byte READY save
at the original tick/run ID.

In an independent ephemeral browser, actual native READY saved
260,637 bytes at tick 181, Chrome cleared ONLY IndexedDB, and
fresh offline Title displayed no available save while the worker
continued to control gameplay. No JS errors or outbound mutating
HTTP in either case. External attempted music catalog GET calls
are blocked at the test context network boundary; artificial
QA runs do not contaminate playtester telemetry.

Build and reproduce with:

    node tools/pwa/build-pages-site.mjs / dist-quota-eviction
    CHROMIUM_EXECUTABLE=/run/current-system/sw/bin/google-chrome \
      node tools/savestate-experiment/test-compiled-suspend-quota-eviction-browser.mjs dist-quota-eviction

No gameplay, SIM_REVISION, layout identity, wallet or public Verified
authority changes are made by this QA gate.
