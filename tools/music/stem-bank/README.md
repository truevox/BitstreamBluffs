# One More Run — six-stem compatibility from eleven originals

2026-11-15. Marvin requested including One More Run alongside all
other Bitstream Bluffs songs, allowing Gal Friday to choose the groups.

Original CT211 launch33 was already a 33-track collection with track 33
One More Run (The Ballad of Bitstream Bluffs), supplied by Marvin.
The original WAV and MP3 master, supplied ZIP and 11 source 48kHz
PCM16 stereo WAV stems remain unchanged and accessible.

Source layout:
 /root/bitstream-maxi/launch33/stems/original_11s/33_one_more_run/
Optional six-stem layout:
 /root/bitstream-maxi/launch33/stems/grouped_6s/33_one_more_run/

Six 44.1kHz 24-bit stereo FLAC files, all 7,699,860 frames (174.6s):
- vocals = vocals + backing_vocals
- drums = drums + percussion
- bass = bass
- guitar = guitar
- piano = keyboard
- other = synth + strings + woodwinds + fx

Each of the 11 original inputs appears in exactly one new group.
Group drums required a 0.9936 scale to avoid very slight PCM clipping.
See one-more-run-groups.json for per-file SHA256, gain, source names,
output path and technical validation.

IMPORTANT: The 11 original supplied stems do not reconstruct the
untouched master WAV. Their raw-sum residual RMS was -21.26 dBFS
against original master RMS -19.4 dBFS, relative residual 0.807.
This is upstream of our grouping. Use original master at neutral
all-unity playback, and six derived groups when applying audio
ducking; QA the mix. Do not claim perfect subtractive cancellation.

Updated original CT211 roster.json, stem_status.json,
game-stems-manifest.json with optional grouped_6s stanza on track33.
Preserved each prior original_11s stanza and all previous 32 songs;
saved timestamped manifest backups. Existing read-only preview
http://192.168.86.211:8767/ remains available, no service restart.

Reproducible scripts:
- group-one-more-run-11-to-6.py
- annotate-one-more-run-manifests.py
- one-more-run-groups.json

No game integration, master overwrite or release approval. Full
One More Run original audio is on the private Pope audition webpage.
