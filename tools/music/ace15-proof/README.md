# ACE-Step 1.5: Maxi lead vocal → church organ and holo pads

Date: 2026-11-15. Marvin authorized the experiment, Gal Friday performed it.

## Scope and source

The real 215-second separated lead-vocal audio waveform from the Pope song
was fed directly to locally hosted ACE-Step 1.5 Cover mode. No V3-F0
analysis or MIDI transcription was used in the ACE inputs. We ran
church organ and futuristic holographic synth pads, each at source
cover strengths 0.9 and 0.7, with one identical seed.

Read-only source FLAC on CT211:
 /root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4/vocals.flac

Exported 44.1kHz 256kbps mono MP3 copied and hash-verified at CT214:
 /opt/ace15/auditions/bitstream-vocal-cover-20261115/input/maxi-vocal-stem.mp3
SHA256:
 5c5d6d1e92b3b1423f06ee5bffbae879b5a64734c60d793c897f23f8c63a4c63
Audio duration: 215.014 seconds. Original FLAC is untouched.

## Safe CT214 recovery

The existing ACE-Step CT214 originally failed to start because its ext4
thin LV vm-214-disk-0 was flagged read-only. An offline read-only e2fsck
confirmed clean. BEFORE making any storage changes, native Proxmox
snapshot before-ace-test-20261115 was created with pct snapshot 214.
Then only the volume permission was returned to RW using
lvchange --permission rw /dev/local-nvme/vm-214-disk-0
and pct start 214 succeeded. No model reinstallation, destructive
filesystem repair, checkpoint replacement, or competing GPU service
modification. Leave the recovery snapshot in place pending review.

## Actual local inference

Existing checkout: /opt/ace15, commit 6d467e4. Model:
acestep-v15-turbo (pretrained, about 4.8GB weights), 48kHz FLAC output.
PyTorch 2.10.0+cu128 on RTX 3060 12GB, CPU offload enabled.
Task type cover, instrumental True, lyrics Instrumental,
no external reasoning LLM (skipped for cover), eight DiT diffusion steps,
guidance_scale 1.0, seed 20261115, batch size 1, duration 215s.

Organ caption: solo expressive cathedral pipe organ with rich diapason,
principal and flute ranks, one melodic lead, preserving Maxi's original
phrases, rapid articulations, rests, note changes and sustained sounds;
no vocals, beats, drums or added melodies.

Holo caption: solo futuristic holographic glass synthesizer lead and airy
evolving synth-pad timbre, preserving original melodic phrasing and
rhythmic articulation, without vocals, beats, bass or counterpoint.

Experiment scripts:
 - generate.py: one isolated model initialization and one cover output
   per request, with a durable result receipt and duplicate-run guard
 - run-matrix.sh: GPU-safe sequential execution of four full songs
 - export.py: verify individual FLACs and export 48kHz Opus full songs
   and a separate 25-second excerpt for the browser audition
 - export-results.json: sanitized output hashes, times, level stats

Four full-length outputs finished successfully:
 organ-0.9, organ-0.7, holo-0.9, holo-0.7.
Output duration per full Opus: 214.9665 seconds.
Output duration of each excerpt: 25.0065 seconds.
Each run uses the identical underlying input, model version and seed;
the experimental factor within each pair is cover strength.
No Kie credits were spent; one 25s organ sanity render also succeeded.

Lossless masters, original source audio and generated music are NOT
committed to Git. Lossless FLACs live under CT214 at:
 /opt/ace15/auditions/bitstream-vocal-cover-20261115/output/
The derived Opus previews live in CT223's ignored
 public/music-audition-ace15/ directory.
The four independent output SHA256s are in export-results.json.

## Audition and acceptance gate

Private tailnet lab:
 http://100.115.120.66:8181/tools/music/audition-ace15/

This compares seven 25s versions: all four new local ACE-Step covers,
both existing Kie V6 organ takes from the earlier single paid Kie task,
and the UNCHANGED V3 Vertigo church organ. It also includes Maxi's
original isolated vocal, optional backing, and links to all SIX full
generative recordings. This webpage level-matches approximate RMS,
not LUFS; user can adjust volume.

Audio-to-audio cover is GENERATIVE, not deterministic timbre transfer.
Matching the overall duration does not prove source note-onsets and
harmonies are synchronized. Some outputs may add new melodies, sound
like singing, drift in timing, or contain unexpected instruments.
These require actual listening; mathematical checks do not substitute
for Marvin's artistic approval. V3 organ and both Kie baselines are
preserved unchanged, and the playable game music has NOT been updated.

The local ACE-Step checkpoint README declares MIT licensing. Confirm
release rights and source song ownership as needed before distributing
anything commercially. No new cloud music tasks were used here.
