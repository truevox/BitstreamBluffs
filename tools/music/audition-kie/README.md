# Consolidated Kie church organ listening archive

Marvin approved one paid Kie.ai Upload & Cover spin intended to return
two generated variants from Maxi's 214.976-second vocal stem. Two
concurrently operating Friday agents accidentally submitted separately.
That is an execution error, not double authorization. Both jobs
succeeded, and their four full outputs are saved on CT223 and
backed up independently on CT211, 24 credits total.

Task A: 2a05f8478617530bec35454aa1d9e686, uploaded 256kbps MP3,
produced take 1 and take 2 at about 214.824 seconds.
Task B: de4cf96e280b04256906de5090771d93, uploaded source FLAC,
produced option 1 at 214.824s and option 2 at 214.800s.
Both use Kie Suno V6 instrumental cover. The four MP3 masters
remain unchanged; no extra paid generation was made after detection.

Source archive directories on CT223:
  /home/hermes/experiments/bitstream-kie-cover-20261115
  /home/hermes/experiments/bitstream-kie-organ-20261115/results

CT211 independent archive:
  /root/bitstream-maxi/mountain-voice-gallery-kie/2026-11-15-vertigo-organ-v6/task-*/option-*.mp3
Canonical structured file/checksum receipt on CT223:
  /home/hermes/experiments/bitstream-kie-organ-20261115/two-task-archive-receipt.json

The source code here creates a private HTML5 mobile audio audition
page. It uses six assets under Git-ignored public/music-audition-kie:
the four original Kie MP3s, one original vocal preview MP3, one
25-second preserved V3 organ preview MP3. The game never receives
any of these experimental output clips.

An independently deployed copy is hosted in a persistent private
user systemd unit bitstream-kie-range.service, from:
  /home/hermes/experiments/bitstream-kie-organ-20261115/site
Bound to Tailscale address 100.115.120.66, port 8182.
The range_server.py implements byte-range HTTP requests for mobile
playback and seeking. The account has linger enabled, and the unit
is enabled at login/boot.

Listening page:
http://100.115.120.66:8182/tools/music/audition-kie/

Build from staged private data (no MP3 commits):
  node tools/music/audition-kie/build.mjs
Smoke test:
  node tools/music/audition-kie-smoke.mjs

No API credentials or uploads in this repository. The model may
alter original notes, arrangement and exact timing; close duration
does not establish musical synchronization. Marvin has not yet
approved any of the four Kie interpretations for a game release.
