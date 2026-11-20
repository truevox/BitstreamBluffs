# Issue #54: catalog-driven billboard artwork + PR #52 HUD review fixes

Child PR of draft PR #52 (`feature/song-billboards-meter-minimap-51`). Opened
before implementation, per the issue → branch → draft PR workflow. Owner: CC Friday.

## 1. Billboard artwork (#54)

- `src/entities/BillboardArt.js` resolves art from catalog metadata only. A
  confirmed YouTube ID is explicit `track.youtubeId` or, backward compatible, a
  `track.id` that is itself an 11-character YouTube video ID. `youtubeId: null`
  opts a track out. Anything else gets the bundled generic card. There is no
  allowlist, and One More Run has no special case.
- The catalog is loaded in PreloadScene; the `{id,title}` song-change event is
  joined to its catalog row by id. AudioSynth and the music transport are
  unchanged.
- Thumbnails load once per ID per session through a scene-independent loader
  that adds them to Phaser's global TextureManager. It tries the bundled
  `music/thumbnails/<id>.jpg` first, then `i.ytimg.com` (which sends CORS `*`).
  Failures are remembered: there are no retries and no per-frame requests. All
  catalog IDs are warmed at boot.
- On a song change the title and art are set together before any draw. If the
  thumbnail is still loading, the sign waits off-screen for up to 1.5 s and then
  goes out with the generic card. A late or stale result never repaints a sign.
- Catalog: the three YouTube songs now carry explicit `youtubeId`.
  `tools/music/pack_song.py` keeps extra catalog fields when it repacks a song.
- Generic card: `public/music/billboard/generic-now-playing.png`, original
  procedural neon art, regenerated with `tools/render-billboard-generic-art.mjs`.

## 2. HUD / billboard fixes from CC Friday's #52 review

- Minimap: keeps clear of the touch buttons, the power-up row and the seed lines
  (it lifts above the left touch cluster or moves top-right); the tutorial chip
  yields to it. It dims under centre banners and the full-width strip. Corner
  changes wait 600 ms, except that it moves at once off the rider. Its look-ahead
  scales with speed-zoom.
- Billboard: an 80×56 sign in an eased sky lane above the rider, dimmed while it
  must cross the rider. Posts run down to the actual terrain. The thumbnail uses
  LINEAR filtering. The title is drawn at 1× scale as a marquee, static and
  shortened under reduced motion. The dance squash applies to the frame only. A
  centred gantry lamp casts an additive cone over the face, and the sign fades
  out at the end of its life.

## Tests

- `tests/src/music-world-sign-map.test.js`: resolver, loader failures, stale-art
  guard, titles/marquee, lane, dimming, minimap keep-outs and dwell.
- `tools/billboard-artwork-issue54-browser-smoke.mjs`: minified Chromium with
  real OGG and real song changes. It runs the shipped catalog and a routed
  catalog that adds new, remote-only and missing IDs plus an opt-out, and audits
  the sign on every frame.
- `tools/hud-minimap-touch-browser-smoke.mjs`: tablet and phone touch viewports;
  the minimap never overlaps the touch buttons.
