# Bitstream Bluffs — 33 original songs integrated into current-main playable game

**Nov 23, 2026; code-only main-based integration; private media mounted separately.**

## Owner instruction

Marvin directed: make melody-only MIDI-derived performances for all 33 recorded songs while keeping the **original, separated six-stem accompaniment**, and derive source beat candidates separately. The 29 new songs and all 33 provisional beat maps were independently source-verified on CT211. The original four established song packs are preserved byte-for-byte. Automatically transcribed notes and rhythm candidates are not musician-verified or game beat-grid approved.

**Do not publish private copyrighted OGG/FLAC source or derived recordings on GitHub or public Netlify.**

## Game integration

- A complete 33-song code-only roster preserves the IDs and order of the original four entries; the other 29 follow the source roster.
- The **MANAGE SOUND → SELECT TRACKS** selector only displays *installed* source songs. All 33 private originals show five pages of **8 / 8 / 8 / 8 / 1** selectable titles. A public four-song installation shows only four, not 29 uninstalled placeholders.
- Previously saved all-four-songs-off preferences migrate to all-33-off rather than unexpectedly playing newly added songs. Sequential/shuffle behavior and the original menu/game stem processing remain unchanged.
- Beat-grid metadata remains fail-closed for all 33 songs. No provisional source beat candidate alters game/Gym/World Dance timing.
- Archived original melody assets physically use the legacy one-letter-shorter home-biome folder spelling while the canonical game IDs use Debutmont. The loader retries **only the single corresponding legacy path on HTTP 404**, remembers the correct spelling per pack and never treats other network failures as a filename alias. No original master is copied/rewritten.

## Private original + melody media

The private source catalog was assembled from the existing four established six-stem/biome-lead packs and 29 newly generated melody-only packs.

| Inventory | Independently verified |
|---|---:|
| Songs in private catalog | **33/33** |
| Original+melody 48 kHz Opus segment references | **11,016** |
| Total source roles per song | **18** |
| Named biome melody voices per song | **12** |
| Missing source references | **0** |
| New source-verified melody clips | **6,564** |
| New original FLAC SHA-256 identities checked | **174** |
| Source beat candidate reports | **33/33**, UNVERIFIED |

Canonical private catalog on CT223: /home/hermes/experiments/bitstream-melody33-private-20261123/game33-music-final. A private game preview mounts symbolic links to this media after Vite build; no source music binaries are in the public code branch.

## Current-main gameplay test, actual Web Audio

The new optional test script, tools/music/smoke-all-33-current-game.mjs, exercised the real StemMusicDirector and Chromium Web Audio on a private build derived from current-main gameplay with this patch.

- **33/33 unique songs successfully started**, each with original accompaniment plus an appropriate live source melody.
- All 33 packs validated **18 source roles, 12 named voice variants, and 48 kHz sampling**.
- **239 real OGG source requests**, 7+ live audio nodes per track, **zero unexpected HTTP errors**, **zero page exceptions**.
- Four prior known canonical-name 404s successfully retried the original physically archived archived home-biome filenames; none prevented playback.
- Original song durations ranged from **172.91 to 268.01 seconds**. This is first-segment real-playback coverage, not a claim of uninterrupted full song certification.
- Immutable private audit report SHA-256: **822e2cef5c915add37f5a7638bc0a705b4da90a63fd4273ab1ed567f38638ec9**.
- Earlier blocker Pope Leo, which failed to load its first legacy-named lead in unpatched current-main, now plays cleanly: 18 source roles, 12 voices and 7 active audio nodes.

To repeat, run a verified private 33-media build and execute with GAME_URL and a unique REPORT_OUT environment variable. The script refuses to overwrite an earlier JSON report and does not upload or alter media.

## Remaining gates

1. Marvin/independent listening of 29 automatically generated melodies for wrong octaves, note errors, whispered/rap content, artificial repeats and bleed.
2. Confirm quarter-note pulse, downbeat phase, half/double time, section changes and varying source tempo. Machine candidate beats must **never** be promoted to authoritative game timing without independent evidence.
3. Test uninterrupted complete songs, transitions, real SFX/wind/master overload, intersample true peaks and low-end Chromebook/Android playback. Successful song starts do not certify these.
4. Obtain source media distribution/license and mastering approval before public release. The private build is available for personal listening now.
5. Independent code review before merging the main-based integration. Public main can remain four-song until the recording assets are cleared.
