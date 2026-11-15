# One paid Kie.ai V6 organ cover: Maxi full vocal stem

Date: 2026-11-15.
Authorization: Marvin explicitly approved exactly one paid Kie.ai
generation, using Maxi's isolated vocal stem and aiming for a church organ
or holo pads. Gal Friday selected church organ because the existing
V3 Vertigo organ is the clear artistic reference.

## Exactly one paid generation task

Task ID: 2a05f8478617530bec35454aa1d9e686
Kie credits consumed: 12.0
Model: ai-music-api/upload-and-cover-audio with inner model V6
Input: instrumental=true; variety=0; duration=215;
  audio_weight=0.95, style_weight=0.85, weirdness_constraint=0.05.
Style: solo acoustic cathedral pipe organ converting UPLOADED LEAD VOCAL
MELODY into full-bodied organ, reed/principal stops, warm deep pipes,
gothic resonance, original melody/pitch/rhythm/attacks/rests/phrasing,
no added sections or backing instruments.
Negative tags: vocals, speech, choir, drums, percussion, guitar,
piano, strings, orchestration, synthesizers, pads, beat, bass,
new countermelodies.
No lyrics or prompt field because Kie treats prompt as lyrics when
instrumental mode is on.

Source: complete CT211 original isolated vocal stem (FLAC), unmodified,
214.976 seconds. Rendered a 44.1kHz mono 256kbps MP3, 215.014s,
6,881,324 bytes and SHA256:
5c5d6d1e92b3b1423f06ee5bffbae879b5a64734c60d793c897f23f8c63a4c63
Original stem on CT211:
/root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4/vocals.flac

Uploaded file to temporary provider storage using its free
file-stream-upload endpoint. Exactly ONE request was submitted to
Kie createTask. Kie returned ONE task ID and two generated takes,
not two paid spins.

Both resulting MP3 files are 48kHz stereo and 214.824s each.
Take 1 size 5,782,762 bytes, SHA256 begins 3efd3022e8e2b05.
Take 2 size 5,699,914 bytes, SHA256 begins 48b399668205d06.
Provider confirmed SUCCESS and charged 12 credits total.

Private source MP3, task receipts and full output MP3s on CT223:
/home/hermes/experiments/bitstream-kie-cover-20261115/

## Private comparison

http://100.115.120.66:8181/tools/music/audition-kie-organ/

The audition webpage switches between 25s excerpts of Take 1,
Take 2 and the UNCHANGED V3 Vertigo church organ. It also includes
Maxi's original 25-second vocal stem and optional backing, as well
as clickable links to both complete approximately 3:35 Kie tracks.
These excerpts all crop source clock 150-175s, but the generative
takes can be musically rephrased and therefore are not mathematically
sample-synchronized.

This is a generative cover, NOT direct deterministic timbre transfer.
It may produce different pitches, harmonies, new accompaniment and
timing. Never confuse a close duration match with melody identity.

Audio source and generated files deliberately ignored by Git under
public/music-audition-kie-organ/ and dist-music-audition/.
No game stems, production audio, SFX or source FLAC changed.
No new game dependencies. No merge into main.

Marvin's V3 organ artistic preference remains unchanged.
Audio quality, melody fidelity, commercial rights and user approval
must all be reviewed separately before considering any release.
