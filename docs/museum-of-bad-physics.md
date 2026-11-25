# Museum of Bad Physics — v1 Offline Developer Gallery

Run the gallery using a loopback-only static server from the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/tools/museum-of-bad-physics.html` in Chrome/Chromium.
ES modules are blocked by Chromium when opened directly through `file://`, so double-clicking the HTML does not work. No public hosting or internet connection is needed. Input: GhostTape v1 JSON files (choose or drop).

## What this is / is not

A local, offline gallery of **recorded pose traces rendered as static SVG**. It is not
playable physics, not a simulation, and not a verification of provenance. Entries are
claims only: `simRevision`, ruleset ID, and historical/current/future status are
**unverified self-declared hints** from the file. Nothing here is an official record,
result, or score.

## Gallery limits

- **8 entries** per gallery, **2 MiB** per file, **8 MiB** total.
- Local UTF-8 reads. The static HTML/JavaScript files load only from your loopback server; no external requests, uploads, or telemetry are made. No persistence — nothing is written to disk by the gallery.
- Files stay in browser memory; clearing or removing revokes any generated Blob URLs.

## Privacy

No selected recording leaves the browser. No upload, no persistence, no external request. The loopback HTTP server serves code, not selected tapes.

## Manual QA checklist

- [x] Good GhostTape v1 JSON loads and renders a static SVG trace.
- [x] Malformed tape shows an error notice (invalid JSON, bad UTF-8, missing pose trace).
- [x] Multi-file limit enforced: 8th entry accepted, 9th rejected.
- [x] Clearing during an async read prevents late entries; removal and clearing revoke Blob URLs (verified in headless Chromium).
- [x] Reselecting the same file re-adds it to the gallery.
- [x] HTML injection payload in a text field renders inert text.
## Automated verification

```bash
npm test -- --runInBand tests/src/museum-of-bad-physics.test.js tests/src/downhill-run-strip.test.js tests/src/ghost-tapes.test.js
```

This gallery keeps a browser-safe snapshot of `SIM_REVISION` and an automated test checks its parity with the authoritative ruleset constant. Update both when that revision changes.
