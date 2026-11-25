# Museum of Bad Physics — v1 Offline Developer Gallery

Local opening: `tools/museum-of-bad-physics.html` via `file://`.
Input: GhostTape v1 JSON files (choose or drop).

## What this is / is not

A local, offline gallery of **recorded pose traces rendered as static SVG**. It is not
playable physics, not a simulation, and not a verification of provenance. Entries are
claims only: `simRevision`, ruleset ID, and historical/current/future status are
**unverified self-declared hints** from the file. Nothing here is an official record,
result, or score.

## Gallery limits

- **8 entries** per gallery, **2 MiB** per file, **8 MiB** total.
- Local UTF-8 reads. **No network.** No persistence — nothing is written to disk.
- Files stay in browser memory; clearing or removing revokes any generated Blob URLs.

## Privacy

No file leaves the browser. No upload, no persistence, no external request.

## Manual QA checklist

- [x] Good GhostTape v1 JSON loads and renders a static SVG trace.
- [x] Malformed tape shows an error notice (invalid JSON, bad UTF-8, missing pose trace).
- [x] Multi-file limit enforced: 8th entry accepted, 9th rejected.
- [x] Clearing during an async read revokes Blob URLs and shows the notice.
- [x] Reselecting the same file re-adds it to the gallery.
- [x] HTML injection payload in a text field renders inert text.