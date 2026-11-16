# Bitstream Bluffs — two-song twelve-voice playable music proof

Completed November 15, 2026, private research demonstration only.

## Play the actual game

http://100.115.120.66:8184/

This is the true Phaser game with its standard AudioSynth and
StemMusicDirector, not the standalone music audition laboratory.

- Start a normal run to hear the music inside gameplay, including the
  existing effects from speed, aerial moves, and entering a new biome.
- A PRIVATE overlay on this test copy also lets Marvin select one of
  the two full-length songs or twelve distinct mountain voices.
- Hear it now activates sound from the title screen with a direct
  user gesture; the panel controls the real in-game music provider.
- The panel defaults to the favored Vertigo Vents/Gentle church organ.
  Normal gameplay's RUN_START event switches to the home Bitstream
  voice; use the overlay again to hear another mountain.
- The existing MUSIC VOCALS setting remains separate and defaults off.

## Data and sources

The demo song catalog has two whole-song engine-compatible packs:

Pope Leo Wants the AI Root Password:
  22 segments, 10,318,847 frames at 48 kHz, 642 score notes.

One More Run (The Ballad of Bitstream Bluffs):
  18 segments, 8,380,800 frames at 48 kHz, 333 score notes.

Each segment has eighteen sources: six ordinary backing/vocal stems
plus twelve voice:biome instruments. The result contains precisely
720 short, individually decodable Ogg Opus files, approximately
64 MB of derived audio. The twelve voices use the existing Gentle
SheetSage-informed full-song instruments. All source masters and
original 11-stem Suno package remain untouched.

The offline builder is
tools/music/build_private_full_game_packs.py.
On CT211 it reads the source/derivative audio and writes only to
/root/bitstream-maxi/private-game-proof-20261115/music/
using an atomic new destination directory, never modifying input.

The preview website lives OUTSIDE the repo at:
  /home/hermes/experiments/bitstream-game-audio-proof-20261115/site/

It has a copy of an approved game dist/ build with a substituted
RESEARCH music catalog, an overlay script and private music files.
No source/game code is changed for the preview. The normal repo
public/music catalog and released dist/music are not modified.

The server is a persistent --user systemd service:
  bitstream-private-playable-game.service
and binds only the Tailscale IP 100.115.120.66 on port 8184.
Marvin's Tailscale membership, not robots.txt, controls access.

Tracked source-only tools:
- tools/music/build_private_full_game_packs.py
- tools/music/private-playable-overlay.js
- tools/music/private-playable-smoke.mjs

**Never commit the derived music pack or pretrained SheetSage/MERT
model weights to Git. Never publish this proof through ordinary
public releases.**

## Evidence and caveats

Headless Chromium navigated into the true game's TitleScene and
RunScene, loaded each private music manifest, verified eighteen
source names for every segment, and fetched first/middle/final
chunks of both songs. Its real AudioContext reached running state.
Actual sample playback began for Pope (seven active sources),
changed from Vertigo to Crystal Cavern, switched to One More Run,
switched back to Vertigo, and remained live after entering a
normal sled run. No playback, JavaScript or HTTP errors.

The separate public game release safety gate still excludes ALL
private music audition assets and model checkpoints. This is
not artist-approved release music or a declaration of commercial
rights clearance. The second Suno 11-stem batch was offered but
not received. The first One More Run 11-stem reconstruction differs
noticeably from its original master, so Marvin's listening verdict
matters before any release decisions.
