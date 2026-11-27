# #424: actual compiled offline PWA Suspend/Resume acceptance

This is an additional **production-minified Pages PWA** test for the
v2.25.31 constructor-name hotfix. The earlier dev-server source
restore tests cannot detect minified constructor-name failures.
The online compiled test cannot prove that a cold, offline,
service-worker-controlled reopening preserves the single-use slot.

The new independent compiled-offline-suspend-qa workflow:
1. Verifies exact triggering commit and compiled build/ruleset identity.
2. Builds the actual pinned production PWA with its content-hashed
   offline shell, using the established Pages builder (not Vite dev).
3. Loads a stock RunScene in Chromium, pauses it, then uses
   a real canvas pointer press on the SUSPEND RUN menu hit zone,
   not a direct internal controller or fabricated IndexedDB row.
4. Confirms a READY one-use local slot with matching run ID
   and completed tick. The original scene retires to Title.
5. Physically closes the source page; puts the WHOLE browser context
   offline, then opens a new page from the cached PWA shell.
6. Uses a real canvas pointer press on Title's R RESUME SAVE,
   confirms resumed RUN_START has the original run ID and tick
   and the unique native slot is consumed. A second new
   offline page must find the slot empty.
7. Fails on browser JS errors or outbound mutating requests.

The browser context blocks all cross-origin requests (including
external music catalog fetch attempts) during this artificial run.
No synthetic game telemetry is delivered to the public endpoint.
A run can advance after resumed RUN_START before the test reads its
current tick; the event witness must be exact. No Verified, Shards,
progression or server authority is inferred from client storage.

**Local real Chromium result on v2.25.31 8477c955:** PASS.
The cached shell was controlled by the service worker; physical
source Suspend saved a 261,539-byte envelope at completed tick 182.
A new fully offline page restored the identical run ID, published
at exactly tick 182, consumed its only save, and left another offline
Title page empty. Zero JS errors and zero outbound mutating requests.
External catalog GET requests were blocked.

Not covered: physical Chromebook hardware/ChromeOS, eviction under
real disk pressure, older exact-build READY save compatibility, or
cross-version installed PWA worker updates. Keep #119/#424 open for
those gates and upgraded/hazard/biome configurations.

Reproduce:

    node tools/pwa/build-pages-site.mjs / dist-offline-suspend
    CHROMIUM_EXECUTABLE=/run/current-system/sw/bin/google-chrome \
      node tools/savestate-experiment/test-player-suspend-offline-compiled-browser.mjs dist-offline-suspend
