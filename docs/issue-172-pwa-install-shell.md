# #172: Installability shell — phase 1

Phase 1 adds the app manifest, install icons, and launch metadata. It **does not** register a service worker, cache pages, or claim offline gameplay. The production game, replay tools, scoring, and storage behavior remain unchanged.

The offline release shell, atomic caching, and data-safe updates are separate follow-up work in #172 after the cross-browser and replay contracts are stable. In particular, do not register a service worker during dev or replay/conformance tests.
