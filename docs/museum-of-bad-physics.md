# Museum of Bad Physics — static local-file gallery (v1 player preview)

The **player preview**, if this patch is released, is accessible from the game Title menu via **M MUSEUM**, or directly at `/tools/museum-of-bad-physics.html` on the same origin. The page reads **only files explicitly selected by the visitor**. The original developer-only loopback server remains supported:


```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/tools/museum-of-bad-physics.html` in Chrome/Chromium.
ES modules are blocked by Chromium when opened directly through `file://`, so double-clicking the HTML does not work. No hosting is required for the loopback option; the release build may also serve the gallery publicly, without uploading selected recordings. Input: GhostTape v1 JSON files (choose or drop).

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

## Player preview release boundary

`vite.config.js` bundles the Museum HTML as an explicitly tracked multi-page entry. Title navigation uses a path relative to the running game, so a Pages subpath such as `/BitstreamBluffs/` remains correctly scoped. The Title-screen **M MUSEUM** chip (also the **M** key) navigates to this route only from Title, not during a run. **Back to game** returns to `index.html`. The gallery performs no file discovery, automatic downloads, network uploads or score changes; its `LOCAL / UNVERIFIED` disclaimer describes the **recordings**, not the page hosting.

This is a visual inspection tool for GhostTape v1 JSON exports, not historical physics playback, official proof, a replay-verified museum or a claim about a tape's provenance. Do not close #85 on this prototype alone. The public integration must receive source security review and exact-head CI including the compiled route before release; source-only/local tests do not establish public readiness.

## Automated production-route test

After `npm run build`, run `CHROMIUM_EXECUTABLE=/usr/bin/chromium node tools/test-museum-public-browser.mjs` (or omit the environment variable if Playwright's matching Chromium is installed). This uses the real compiled game and asserts Title keyboard `M`, pointer chip, entry/back navigation, local GhostTape and static SVG rendering, malicious filename inertness, clear-time Blob revocation, invalid JSON rejection, zero HTTP requests when selecting tapes, and zero page exceptions. The dedicated `.github/workflows/museum-public-preview-qa.yml` runs this independently on PRs.

GitHub CI additionally builds with `--base /BitstreamBluffs/` and runs the same actual Chromium test with `MUSEUM_PREVIEW_BASE=/BitstreamBluffs/`; a root-relative link would fail this case. User-selected tapes remain local; the Museum is not required to be available offline before its shell HTML has been loaded/cached.
