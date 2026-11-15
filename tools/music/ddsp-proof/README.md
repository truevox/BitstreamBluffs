# Offline Magenta DDSP timbre-transfer evaluation

First run on November 15, 2026, by Gal Friday. This is NOT game code.
The neural models synthesize instrument waveforms using original vocal
loudness and the V3 continuous estimate of Maxi's fundamental frequency.
They do not use MIDI events or tempo/rhythm quantization.

## Environment

Do NOT install these libraries into the CT211 Demucs Python venv or the
game-root npm environment. Use a separate Node project with the pinned
dependencies from this folder on x86_64 Linux plus ffmpeg.

The isolated work directory on CT223 used in the experiment is:
 /home/hermes/experiments/bitstream-ddsp-20261115/

Copy extract_features.py and render-ddsp.mjs into the isolated directory.
Use a model folder with subfolders violin, trumpet, tenor_saxophone, flute.
Each model folder contains model.json, settings.json, group1-shard1of1.bin.
The official assets were fetched from:
 https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/{instrument}/

Have a localhost HTTP file server in that experiment root serving at port
8183. The renderer expects models served at http://127.0.0.1:8183/models/.
The source feature file is audio/ddsp-25s-v3.json, made using
extract_features.py on CT211 with the isolated vocals stem at:
 /root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4/vocals.flac
and the previously generated pitch control at:
 /root/bitstream-maxi/mountain-voice-gallery-v3/pope-pitch-stable-35.npz

The feature extractor resamples the source vocal to 16000Hz mono, builds
loudness frames each 4ms using centered 1024-sample RMS and imports the
continuous V3 pitch track. Its output was copied into the isolated lab.

Run npm install in that isolated work directory, then node render-ddsp.mjs.
The output directory is audio/rendered; all four 25-second neural versions
are 16kHz WAV for analysis and 48kHz Opus previews for the browser audition.

## The four neural voices

Official Magenta TFJS DDSP checkpoints: violin, trumpet, tenor saxophone,
flute. Each model yields 5s/80000 samples from 1250 F0 + loudness frames
at 250Hz. The script makes 6 overlapping chunks (0s, 4s, 8s, 12s, 16s,
20s) with 1s crossfades and outputs exactly 25 seconds of audio.

All models rendered locally with TensorFlow.js native CPU on CT223.
No NVIDIA GPU access or external inference provider required.
A modest preview normalization targets -23dBFS RMS per instrument.

Initial fidelity check, not listening approval: all renderings valid,
non-clipping, 25s; envelope correlations 0.922 to 0.948 versus source
with best offset 8ms to 28ms. This shows approximate *timing and dynamics*
retention only; errors in pitch F0 can still produce wrong melody.

The private audition UI lives in tools/music/audition-ddsp/ and includes
the unchanged V3 organ and sawtooth plus original vocals and backing.
Tailscale address:
 http://100.115.120.66:8181/tools/music/audition-ddsp/

## Rights and limits

Magenta DDSP software is Apache 2.0. Public availability of pretrained
model files does NOT by itself establish commercial rights in their
training source performances or all outputs. Keep the checkpoint assets
and generated songs outside Git until distribution terms are verified.
No model weight, original FLAC, or generated audio file is committed.

The V3 Vertigo organ is Marvin's preferred artistic benchmark; no neural
render replaces it merely by having more accurate pitch statistics.
DDSP model transfer depends on F0, not a miraculous detector bypass.
