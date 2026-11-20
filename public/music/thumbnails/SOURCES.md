# Public music YouTube thumbnails — exact catalog association

Billboard artwork is driven by `public/music/catalog.json` (issue #54); there is
no allowlist in source code. A track's confirmed YouTube ID is its explicit
`youtubeId` field, or (backward compatible) its `id` when that id is itself an
11-character YouTube video ID. `"youtubeId": null` opts a track out.

For a track with a confirmed ID the game loads, once per session:
1. the bundled copy `music/thumbnails/<youtubeId>.jpg` (preferred: no runtime
   call to YouTube), then
2. `https://i.ytimg.com/vi/<youtubeId>/mqdefault.jpg` if no copy is bundled.

If both fail, or a track has no confirmed ID, the billboard shows the bundled
generic card `music/billboard/generic-now-playing.png`. To add a song's art:
add `youtubeId` to its catalog entry, and ideally drop the unchanged 320×180
`mqdefault.jpg` here under the same name.

| Song track ID | Original YouTube thumbnail URL | Bundled file |
| --- | --- | --- |
| `FEsxYVStla4` | https://i.ytimg.com/vi/FEsxYVStla4/mqdefault.jpg | `FEsxYVStla4.jpg` |
| `WRBGQUqD54U` | https://i.ytimg.com/vi/WRBGQUqD54U/mqdefault.jpg | `WRBGQUqD54U.jpg` |
| `FYImnz5-hXs` | https://i.ytimg.com/vi/FYImnz5-hXs/mqdefault.jpg | `FYImnz5-hXs.jpg` |

One More Run (`local-one-more-run-bitstream-bluffs`) has no catalog-confirmed
YouTube ID, so it gets the generic card like any other local track. When Music
Friday confirms its official video, adding `youtubeId` to its catalog entry is
the whole change.

The generic card is original procedural art (no YouTube branding, no claimed
album cover), regenerated with `node tools/render-billboard-generic-art.mjs`.
