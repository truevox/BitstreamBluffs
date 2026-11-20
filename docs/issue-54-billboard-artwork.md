# Issue #54: catalog-driven billboard artwork + PR #52 HUD review fixes

Child PR of draft PR #52 (`feature/song-billboards-meter-minimap-51`). Opened
before implementation, per the issue → branch → draft PR workflow. Owner: CC Friday.

Scope:
1. **HUD/billboard review fixes** from CC Friday's review of #52: minimap keep-outs
   (touch buttons, bottom HUD row, seed lines), minimap dimming under centre
   banners, hysteresis, zoom-aware look-ahead; a smaller billboard lane that
   avoids the rider, crisp thumbnail/title rendering, a spotlight that lights the
   face, and a fade-out at the end.
2. **#54 artwork:** remove the hardcoded YouTube-ID allowlist. Every song gets art:
   its confirmed YouTube thumbnail if the catalog has a YouTube ID, otherwise a
   bundled generic Bitstream Bluffs "NOW PLAYING" card. One More Run has no special
   case.

Status: in progress.
