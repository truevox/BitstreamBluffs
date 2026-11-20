# Public music YouTube thumbnails — exact catalog association

Source: the three original-song YouTube video IDs *already present* in
`public/music/catalog.json`. Saved as local unchanged 320×180 JPEG thumbnail
assets on 2026-11-19 to avoid runtime calls and CORS/network flakiness.

| Song track ID | Original YouTube thumbnail URL | Bundled file |
| --- | --- | --- |
| `FEsxYVStla4` | https://i.ytimg.com/vi/FEsxYVStla4/mqdefault.jpg | `FEsxYVStla4.jpg` |
| `WRBGQUqD54U` | https://i.ytimg.com/vi/WRBGQUqD54U/mqdefault.jpg | `WRBGQUqD54U.jpg` |
| `FYImnz5-hXs` | https://i.ytimg.com/vi/FYImnz5-hXs/mqdefault.jpg | `FYImnz5-hXs.jpg` |

One More Run (`local-one-more-run-bitstream-bluffs`) has no catalog-confirmed
YouTube ID. We render an explicit local-original placeholder instead of
claiming a random thumbnail belongs to the track. Music Friday will check
whether an official video/source ID is available.
