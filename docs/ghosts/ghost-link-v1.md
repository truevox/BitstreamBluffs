# Ghost-in-a-Link v1 — initial isolated codec (issue #69)

**Status:** draft utility only; no shipped share/import UI or hosting service. Do not close #69. Player account, online API, uploads, official verification, ledger credit and wallet spending are all **outside** this implementation. Separate P0s #119, #244 and #245 own authoritative savestate, protected evidence and public eligibility. The codec cannot replace them.

`src/systems/ghost/GhostLink.js` supplies two explicit-call-only functions:

- `createGhostLink(tape, location.href)`: compresses an allowlisted real SIM9 original Ghost Tape with browser gzip, prefixes a versioned fragment `#bbghost=1.<sha256-prefix>.<base64url>`, strips URL query, source run ID, timestamps and unrelated profile/private fields. Does not fetch, copy or navigate.
- `parseGhostLink(pastedUrl)`: verifies a single bounded versioned fragment, compressed checksum, capped decompression and supported SIM/tape/RNG/state/input/checkpoint/trace. Returns **`trust: 'unverified-local-practice'`** with all credit/official flags false and an isolated `shared:<digest>` ID. It never saves/imports automatically. **The SHA is corruption detection, not producer authentication.**

A URL hash is not transmitted in a normal HTTP request. Sharing is a future explicit player action, never after every crash or save. A link can disclose seed, selected biomes, score, inputs, movement and upgrade choices. Show that before any copy/send. Import must require explicit acceptance and render an unranked practice-only ghost—never authorize wallet claims or an official score.

**Length:** recommended <=1,900 chars; direct browser links accepted up to **8,192 chars**, with a future warning that some messenger/QR apps truncate long URLs. Actual short 141-tick SIM9 tape produced **1,498 characters**; a naturally completed 849-tick run (166m) produced **4,873 characters**. Both round-tripped in real Chromium. A larger replay requires an explicit opted-in hosted fallback with secure untrusted reads; no anonymous upload endpoint or browser-side R2 write token is created.

**Evidence:** `tests/src/ghost-link.test.js` rejects corrupted, malformed, oversize and unsupported versions; guards course, inputs, finite poses, nested fields and zip bombs; prevents auto-network access. `tools/test-real-ghost-link-browser.mjs` exercises actual source tapes from a browser game. This is a source-verified codec, **not yet player-facing sharing**.

**Outstanding:** explicit share/copy UI, privacy disclosure and warning, explicit paste/preview/import path, local visual ghost practice, larger optional hosted fallback, independent code/security review. No production physics, replay schema, PWA, media source or existing save changes.
