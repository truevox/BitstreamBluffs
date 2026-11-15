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

## SPICE independent F0 test (2026-11-15)

The prior trial fed *V3* F0 into DDSP. This independent pitch control
experiment uses the **official** Google SPICE TensorFlow.js graph, downloaded
by the documented tfhub archive form:

  https://tfhub.dev/google/tfjs-model/spice/2/default/1?tfjs-format=compressed

Directly requesting the model root URL no longer resolves; use the archive
parameter to get model.json plus three weight shards. Extract these privately
into the isolated working directory at models/spice/, under the same local
HTTP file server on port 8183. Do not commit checkpoint weights.

1. Extract **original source isolated FLAC** (2m30s–2m55s) to 16kHz mono
   25-second signed WAV using ffmpeg on CT211. Do not seek to 150s within the
   already cropped 25s Ogg preview. Also write 16k f32le samples to
   audio/maxi-vocal-25-16k.f32. The original six-stem FLAC remains unchanged.
2. Run node spice-extract.mjs with the pinned tensorflow.js dependencies
   in an isolated Node project. It reads the actual waveform and runs
   the SPICE model, obtaining uncertainty and pitch at a **32ms** frame
   interval; converts SPICE's normalized pitch using its reference constants.
   This part truly receives raw Maxi vocals and does not rely on V3 F0.
3. Run python3 spice-to-features.py to generate a 250fps DDSP control file:
   audio/ddsp-25s-spice.json. The independent neural source pitch is
   confidence-aware: only 1 isolated octave spike was repaired; short low
   confidence gaps interpolate, long low confidence intervals mute.
   There is no random SPICE fallback pitch jitter.
   Original vocal RMS loudness controls are held constant.
4. Run the same neural DDSP render script but set
   DDSP_FEATURES=audio/ddsp-25s-spice.json
   DDSP_OUTPUT=audio/rendered-spice
   to keep the previous four DDSP/V3 takes intact. Each neural target
   timbre is the **same pretrained model** in the before/after comparison.
5. To isolate the detector on the beloved V3 sampled church organ and
   Candy saw, run v3-spice-control.py on CT211 with its *original* V3
   analysis and notes JSON, plus the new SPICE DDSP features copied from
   CT223. It revises only the 25s *pitch control* and base note estimates,
   preserving all 1,234 note-onset timestamps and sample programs. Pass the
   resulting NPZ and notes JSON to the existing
   tools/music/render_v3_pitch_examples.py, producing two alternative
   25-second audio takes with existing V3 timbres. The new note base pitch
   can cause sample-selection differences; do not claim a perceptually
   perfect single-variable experiment or an approved final instrument.
6. New separate A/B lab at
   http://100.115.120.66:8181/tools/music/audition-spice/
   compares four V3-DDSP vs SPICE-DDSP pairs and two sampled V3-vs-SPICE
   instruments (saw, organ) in identical excerpt timing, with optional
   backing and direct original vocal reference. There are 12 choices,
   14 total audio previews. The V3 original *organ soul* remains untouched.

**Diagnostics, not music proof:** SPICE extracted 783 F0 frames and
564 exceeded 0.7 confidence. Median high-confidence voiced F0 ~294Hz;
on 546 overlapping high-confidence voiced comparisons to V3, median
absolute difference was ~27.5 cents, but 63 were >700 cents apart,
demonstrating substantial disagreements/possible octave errors that require
manual listening or source-annotated validation. 104 note base estimates
were retuned for the V3 sampled-pitch comparison without changing any note
onset times. No conclusive quality judgment is possible from these metrics.

**ACE-Step alternative:** ACE-Step 1.5 supports source-audio Cover, which
can reinterpret a full song. Its official developer discussions say that
Cover does not necessarily preserve the precise melody note-for-note. It
may be useful for a separate promotional cover but is not presently proven
to generate sample-synchronous replacement vocals/instruments for the
six-stem in-game mix. User proposed it as an *option*, not a commitment.
The existing CT214 ACE-Step container is stopped and attempts to start
failed (filesystem root mapped read-only). Offline e2fsck -n said ext4
clean, while blockdev --getro on its LV returned 1; no write-mode
change or repair was attempted. Do NOT silently change host LV flags or
wipe data merely to enable this exploratory experiment.
