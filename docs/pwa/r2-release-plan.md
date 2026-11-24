# PWA: versioned R2 publication bridge (#172)

Scope: developer-only inventory/planning layer, based on main `29587b64` and the verified #333 soundtrack publication. No worker registration, runtime routing, media downloads, new audio files, or production save/physics changes. Existing local four-song plan remains unchanged.

The publication manifest from #330 is trusted build evidence (14,637 objects, 1,399,907,225 bytes). `planPublishedMusic` validates its format, release identity, unique bounded relative keys, total size, and the SHA-256 and size of actual catalog and supplied pack bytes. It reuses the selection/biome planner and projects every required/bonus original logical path to the exact versioned R2 URL with its published byte length and SHA-256. Missing referenced assets fail closed. This manifest is not a signature; provenance must be maintained by the release pipeline, not taken from an arbitrary client or remote response. A future client-facing manifest must be sanitized, release-bound and validated before routing. The original cache downloader cannot consume these absolute URLs yet.

Measured against the original publication inventory and exact catalog + 33 pack JSON bytes (four via released Git blobs, remaining via authorized runtime source):

| Selected songs (menu-ready, no dynamic orchestra or next-biome prefetch) | Groups | Media/pack/caption entries | Bytes (excluding catalog) |
|---|---:|---:|---:|
| All 33 | 66 | 4,929 | 452,885,899 |
| First catalog song only | 2 | 145 | 13,816,538 |
| All disabled | 0 | 0 | 0 |

These are exact original-quality inventory sizes, not measured Lite/Full derivative sizes, transfers or quota estimates. Catalog is an additional 6,639 bytes if retained. No audio objects were downloaded for this check. The published original recordings are not the approved Lite mono derivatives.

Next integration slices: (1) scope-safe shell on root and GitHub Pages subpath; (2) publish separate source-bound Lite/Full derivative inventories without deleting original masters; (3) cross-origin CORS-aware verified download and service-worker routing by exact release URLs, never opaque responses; (4) preserve full catalog offline and avoid procedural fallback for missing selected tracks; (5) consent, progress, quota, cancellation, safe quality promotion and safe lifecycle; (6) device/update/persistence QA. Do not close #172 on this foundation slice.
