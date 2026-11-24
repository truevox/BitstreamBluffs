# Public music YouTube thumbnails — exact catalog association

Billboard artwork is driven by catalog metadata (issue #54); the bundled
fallback catalog is `public/music/catalog.json`. There is
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

The following copies cover all 32 YouTube IDs in the versioned 33-song R2
catalog `20261124-69a6fb46` (retrieved 2026-11-24); existing three files are
unchanged. The local One More Run track has no confirmed video ID.

| Song track ID | Original YouTube thumbnail URL | Bundled file |
| --- | --- | --- |
| `FEsxYVStla4` | https://i.ytimg.com/vi/FEsxYVStla4/mqdefault.jpg | `FEsxYVStla4.jpg` |
| `WRBGQUqD54U` | https://i.ytimg.com/vi/WRBGQUqD54U/mqdefault.jpg | `WRBGQUqD54U.jpg` |
| `FYImnz5-hXs` | https://i.ytimg.com/vi/FYImnz5-hXs/mqdefault.jpg | `FYImnz5-hXs.jpg` |
| `ehy7VzQezYA` | https://i.ytimg.com/vi/ehy7VzQezYA/mqdefault.jpg | `ehy7VzQezYA.jpg` |
| `OJZxthGfGnQ` | https://i.ytimg.com/vi/OJZxthGfGnQ/mqdefault.jpg | `OJZxthGfGnQ.jpg` |
| `sswkhce6AIw` | https://i.ytimg.com/vi/sswkhce6AIw/mqdefault.jpg | `sswkhce6AIw.jpg` |
| `R5mnA0yw8YA` | https://i.ytimg.com/vi/R5mnA0yw8YA/mqdefault.jpg | `R5mnA0yw8YA.jpg` |
| `mpNmwxla2dw` | https://i.ytimg.com/vi/mpNmwxla2dw/mqdefault.jpg | `mpNmwxla2dw.jpg` |
| `W0LHKo7kFXM` | https://i.ytimg.com/vi/W0LHKo7kFXM/mqdefault.jpg | `W0LHKo7kFXM.jpg` |
| `riwvGZ_dG30` | https://i.ytimg.com/vi/riwvGZ_dG30/mqdefault.jpg | `riwvGZ_dG30.jpg` |
| `SHhGkiVPYl0` | https://i.ytimg.com/vi/SHhGkiVPYl0/mqdefault.jpg | `SHhGkiVPYl0.jpg` |
| `Mu27hXWYZrU` | https://i.ytimg.com/vi/Mu27hXWYZrU/mqdefault.jpg | `Mu27hXWYZrU.jpg` |
| `whZd8NWl2lk` | https://i.ytimg.com/vi/whZd8NWl2lk/mqdefault.jpg | `whZd8NWl2lk.jpg` |
| `k7b3xKKhYzw` | https://i.ytimg.com/vi/k7b3xKKhYzw/mqdefault.jpg | `k7b3xKKhYzw.jpg` |
| `e2qsf6XrOoY` | https://i.ytimg.com/vi/e2qsf6XrOoY/mqdefault.jpg | `e2qsf6XrOoY.jpg` |
| `o7tbnrfRED0` | https://i.ytimg.com/vi/o7tbnrfRED0/mqdefault.jpg | `o7tbnrfRED0.jpg` |
| `layy9YVq0Vs` | https://i.ytimg.com/vi/layy9YVq0Vs/mqdefault.jpg | `layy9YVq0Vs.jpg` |
| `xiMVdlXC30c` | https://i.ytimg.com/vi/xiMVdlXC30c/mqdefault.jpg | `xiMVdlXC30c.jpg` |
| `Nog449XXOc0` | https://i.ytimg.com/vi/Nog449XXOc0/mqdefault.jpg | `Nog449XXOc0.jpg` |
| `2Cb3O1UGrpk` | https://i.ytimg.com/vi/2Cb3O1UGrpk/mqdefault.jpg | `2Cb3O1UGrpk.jpg` |
| `Jcn-PqjET1w` | https://i.ytimg.com/vi/Jcn-PqjET1w/mqdefault.jpg | `Jcn-PqjET1w.jpg` |
| `juXoTF3pSzY` | https://i.ytimg.com/vi/juXoTF3pSzY/mqdefault.jpg | `juXoTF3pSzY.jpg` |
| `TqDdzLqOhtI` | https://i.ytimg.com/vi/TqDdzLqOhtI/mqdefault.jpg | `TqDdzLqOhtI.jpg` |
| `yeKujxDJ41Q` | https://i.ytimg.com/vi/yeKujxDJ41Q/mqdefault.jpg | `yeKujxDJ41Q.jpg` |
| `S9WQYIg8VzY` | https://i.ytimg.com/vi/S9WQYIg8VzY/mqdefault.jpg | `S9WQYIg8VzY.jpg` |
| `GMvUptcX0Vc` | https://i.ytimg.com/vi/GMvUptcX0Vc/mqdefault.jpg | `GMvUptcX0Vc.jpg` |
| `fLfhXiu7kwU` | https://i.ytimg.com/vi/fLfhXiu7kwU/mqdefault.jpg | `fLfhXiu7kwU.jpg` |
| `8vBOGuyC8nA` | https://i.ytimg.com/vi/8vBOGuyC8nA/mqdefault.jpg | `8vBOGuyC8nA.jpg` |
| `n5HV4o8iY70` | https://i.ytimg.com/vi/n5HV4o8iY70/mqdefault.jpg | `n5HV4o8iY70.jpg` |
| `-0JQYFESom4` | https://i.ytimg.com/vi/-0JQYFESom4/mqdefault.jpg | `-0JQYFESom4.jpg` |
| `4ex2Owu8yGM` | https://i.ytimg.com/vi/4ex2Owu8yGM/mqdefault.jpg | `4ex2Owu8yGM.jpg` |
| `cjphToi1DUo` | https://i.ytimg.com/vi/cjphToi1DUo/mqdefault.jpg | `cjphToi1DUo.jpg` |

One More Run (`local-one-more-run-bitstream-bluffs`) has no catalog-confirmed
YouTube ID, so it gets the generic card like any other local track. When Music
Friday confirms its official video, adding `youtubeId` to its catalog entry is
the whole change.

The generic card is original procedural art (no YouTube branding, no claimed
album cover), regenerated with `node tools/render-billboard-generic-art.mjs`.
