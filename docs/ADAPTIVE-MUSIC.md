# Bitstream Bluffs — Adaptive Music Engine

**Status: functional prototype, feature branch, not merged.** November 15, 2026.

## Invariants

This changes MUSIC ONLY. The existing AudioSynth remains the owner of SFX, wind,
crash ducking, glitches, user-gesture audio unlock, master compressor and public API.
StemMusicDirector plugs into the old music filter/bus, sharing its AudioContext.
If the catalog is absent or cannot load, the original procedural soundtrack runs.

Original FLAC masters on CT211 are never modified. All game assets are encoded in
separate derived directories. Do not commit audio to Git: public/music/ is ignored.
Unlike the procedural loop, the playlist survives run ends, aborts and retries.

## Working now

- Full-length Pope Leo Wants the AI Root Password six-stem Opus test: 22 segments
  and ~215 seconds, each segment referenced by exact 48 kHz sample frame offsets.
- Separately generated full-length Bitstream Bluffs synthesized vocal melody,
  produced with offline continuous pitch/dynamics analysis (not MIDI or Suno).
- **All twelve** full-length mountain candidate instruments have been rendered
  from the Pope song's shared F0/phrasing, sample-aligned to exact 48k frames.
  Each has a 25-second level-matched demo and optional instrumental backing.
  They are provisional sound designs, not yet game-installed masters.
- Original vocals default OFF and toggle independently of timed captions
  (captions default OFF and require real word alignment metadata).
- Twelve biome definitions: Bitstream Bluffs home/virtual mountain plus 11
  imported unlockables, each with a distinct proposed singing instrument identity.
- Runtime derived voice source naming voice:<biome>, with voice crossfading.
- Twelve synthetic impulse-response environments, convolution send effects,
  crossfades and capped IR cache; all are designed ambience, not field captures.
- Extensible source/effects model: gain, filter, pan, distortion, delay, tremolo,
  ring modulation, convolution and analyser; data-driven, bounded, validated.
- Low-cost automation: aerial drum ducking, speed-filter control, combo gain,
  genre-neutral effect chains, access to audio energy for visual changes.
- Browser-integrated real-song playback through normal RunScene RUN_START,
  actual SFX AudioContext, no new Phaser audio engine.
- Persisted musicVocals and musicCaptions settings, simple caption HUD slot.

## Input and game deployment

Masters (read-only):
root@192.168.86.211:/root/bitstream-maxi/launch32/

Derived prototype pack (writable, separate from masters):
root@192.168.86.211:/root/bitstream-maxi/music-pack-pope-full/

Deployment layout, EXCLUDED from Git:
public/music/catalog.json
public/music/packs/01_FEsxYVStla4/pack.json
public/music/packs/01_FEsxYVStla4/0000-vocals.ogg
public/music/packs/01_FEsxYVStla4/0000-drums.ogg
public/music/packs/01_FEsxYVStla4/0000-bass.ogg
public/music/packs/01_FEsxYVStla4/0000-guitar.ogg
public/music/packs/01_FEsxYVStla4/0000-piano.ogg
public/music/packs/01_FEsxYVStla4/0000-other.ogg
public/music/packs/01_FEsxYVStla4/0000-voice-bitstream-bluffs.ogg

The master-to-Opus pack builder is tools/music/pack_song.py.
The F0/dynamics extractor and prototype synth are tools/music/voice_resynth.py.
The derived-stem injector is tools/music/augment_voice.py.
The twelve full-length candidate renderers and gallery metadata preparation
are tools/music/render_mountain_voices.py and tools/music/prepare_voice_gallery.py.
Current generated audio is on CT211 at /root/bitstream-maxi/mountain-voice-gallery/.
The separate browser demo is tools/music/audition/. Preview assets belong
under ignored public/music-audition/. Use node tools/music/audition/build.mjs
to build the gallery *and copy private audio assets*: a bare Vite audition build
clears its output directory and does not copy those files.
Use the scripts with explicit source/out/pack paths; scripts refuse obvious
source-bank overwrites and check frame alignment.

## Runtime modules

MusicPack.js          safe manifests, extra sources and mix preset validation
StemMusicDirector.js  segmented schedule, playlist, cache, dynamic voices
MusicFXGraph.js       processor registry, stereo source graph, sends/automation
ImpulseBank.js        12 deterministic environment responses, small buffer LRU
BiomeSpaceBus.js      crossfaded reverb sends / room tails
BiomeVoices.js        twelve mountain identities / fallback
CaptionSequencer.js   word-accurate caption position, optional beat timing

Existing integration files: AudioSynth.js, services.js, SaveStore.js,
Views.js, RunScene.js and UIScene.js. Game physics and procedural SFX remain.

## Tests

With dependencies installed, run the targeted Jest suite:
npm test -- --runInBand tests/src/music-pack.test.js tests/src/music-fx.test.js tests/src/input-audio-glitch/AudioSynth.test.js tests/src/savestore.test.js

Build: npm run build.

With an independent song pack deployed to public/music and Vite running on
127.0.0.1:5173, the real-browser smoke tests are:
node tools/music/smoke.mjs
node tools/music/game-smoke.mjs
node tools/music/retry-smoke.mjs

With ignored 25-second audio previews available:
node tools/music/audition/build.mjs
node tools/music/audition-smoke.mjs

These browser tests require Chromium and the test song; they are not part of
the default CI suite.

## What is NOT finished

- Twelve candidate voices have been rendered for the Pope song, but only
  the *home Bitstream voice* is installed in the playable game pack.
  The other eleven remain standalone audition WAVs/Opus clips.
  None is listening-approved; all need audition, refinement, level matching
  and packaging into a production song manifest.
- No real word-aligned lyric captions have been packaged yet; caption display
  correctly stays empty until the timing data exists.
- Twelve IRs are designed synthetic placeholders, not recorded acoustic spaces.
- Offline granular synthesis of guitar/piano/other is planned but not implemented.
- Source FX can be configured now, but musical beat detection and musical
  beat/bar-aware transitions have not yet been supplied for Pope or other tracks.
- Audio-reactive visuals currently include subtle scanline shimmer only. Terrain
  music-reactive design awaits visual readability testing.
- Listening QA: separation leakage, Opus chunk seam audibility, output loudness,
  synthetic voice expressiveness, room reverb wet levels, phone/Steam Deck CPU.
- Seeking Friday verified all 32 songs / 192 FLAC stems are fully validated.
  Six piano stems are effectively silent; the graph must tolerate sparse sources.
  Full 32-song derivatives still need settings, processing, rights/attribution
  and bandwidth/device budgets. Demucs is no longer a blocker.
- The original-minus-separated-stem reconstruction method is intentionally
  OFF because MP3 priming/alignment can create comb filtering.
- New music UI is essential settings only; full playlist/custom mix controls
  require a later design pass.

User-deferred (not required for release): polyphonic instrument transcription and
real-time neural instrument replacement.

Source/provenance: Marvin's approved music requirements and ChatGPT Friday's
implementation proposals were saved to the canonical GBrain page
projects/truevox-bitstreambluffs/audio-stem-graph. Treat implemented behavior
as agent-authored until owner verifies the musical quality.


The pack format also supports named derived textures through a bounded layers
map (source ID to gain). Until the full 12 distinct singing voices are rendered,
the current virtual Bitstream voice stays audible as a temporary melodic lead.

A browser retry smoke test verifies the song clock and segment scheduling
survive run-end, retry and abort events.

## Collaboration boundary with CC Friday

The music feature branch / draft PR #21 was cleanly rebased on CC's
fast-forward-only main v2.8.0 (454e5ed). Do not merge or push to main.
CC handles biome gameplay and Readable Chaos warning SFX. This music branch
extends AudioSynth.js without altering playSfx or replacing procedural SFX.
Added music methods: setMusicProvider, setAirborne, currentMusicCaption and
musicEnergy. Changes to run/biome event subscriptions are music-only. RunScene
calls setAirborne. Future main changes will need another rebase and fresh tests.

## V2 voice audition — owner feedback and implementation (2026-11-15)

**Owner feedback (Marvin, NOT an agent inference):** V1 concept and audition
interface are well liked, but **many sounds are much too alike**; transitions
between notes are too soft for Maxi's frequent hard onsets; **Crystal Cavern
and Steampunk Slopes are particularly disappointing**. Switching back to
Maxi's original voice makes the intended melody/phrasing intelligible even
where isolated synthetic instruments were not. Instruments must be judged
alone as melodic performances.

**Friday's diagnosis (inference, requiring listening verification):** V1 drove
related continuous oscillators with a shared slow vocal envelope. Original
128ms windows and smoothing can erase note attacks and introduce octave
errors. Timbre and articulation diversity were both insufficient.

**Agent implementation (never overwrite the read-only FLAC masters):**
- voice_phrasing_v2.py: 10ms pitch and fast (32ms) source RMS/spectral-onset
  analysis; torchaudio NCCF, octave correction, distinct onset and velocity
  estimates; still a heuristic, not trusted transcription.
- sf2_melody_v2.py: genuine sampled note-on/note-off events and continuous
  MIDI pitch-wheel changes for original bends and vibrato. Uses the existing
  CT211 FluidSynth/FluidR3_GM.sf2; no new browser/npm dependency. Debian's
  FluidR3 GM soundfont package identifies the license as MIT.
- articulated_gallery_v2.py: 12 distinct sample-or-procedural instrument
  generators with fast onset attacks. Crystal combines sampled glockenspiel
  mallets with independently ringing glass modes. Steampunk combines sampled
  calliope pipes with a distinct steam chiff/mechanical valve transient.
  Other sample families include brass, reed, saw lead, choir, music box and
  church organ; remaining digital synths add timed note transients.
- measure_voice_contrast.py: numerical comparison of the common 25-second
  excerpt. Median log-spectrum correlation across 66 instrument pairs fell
  from 0.956 to 0.905. Normalized median onset rise at 126 candidate onsets:
  Crystal -0.068 -> +0.293; Steampunk -0.008 -> +0.991. Directional engineering
  checks, NOT evidence of musical approval.
- tools/music/audition-v2: separate V1 vs V2 browser UI with sample-aligned
  crossfades and original Maxi reference. The 26 Opus preview assets are
  generated separately and excluded from Git.

**Test deployment:**
http://192.168.86.223:8181/tools/music/audition-v2/
The previous V1 audition remains available independently.
CT211 V2 derivative gallery: /root/bitstream-maxi/mountain-voice-gallery-v2/.
This iteration is 25-second clips; old full-song V1 files and the game's
draft-Pope pack are intentionally unchanged pending owner listening approval.

**Open risks:** about 1,234 triggered notes over 215 seconds (126 in the
25-second excerpt), including possible false triggers from Demucs bleed.
Pitch can still jump incorrectly. Audition each instrument SOLO, not just
with Maxi reference; check sample onset timing, musical legibility and
individual instrument identity. No claims of finished art or 32-song migration.

**Repository coordination:** CC Friday owns fast-forward-only main and
Readable Chaos warning SFX; V2 is OFFLINE resynthesis plus separate lab only.
It does not change the live AudioSynth API, game physics or SFX hooks.
Rebase the unmerged draft PR onto CC's moving main before review.

## V3 pitch-control experiment (2026-11-15)

Marvin's **actual listening feedback after V2**: major sonic improvement,
with Candy sawtooth and Vertigo church organ among the best, but audible
small pitch slides and wobbling; larger deliberate glides are less bad.
Marvin asked whether timing is quantized and whether detection can improve.

**Answer grounded in V2 source:**
- NO beat/BPM timing quantization.
- V2 pitch samples and note onsets occupy a 10ms grid. New note onsets
  closer than 70ms apart are suppressed, and notes shorter than 55ms are
  discarded. SF2 instrument note-on/off and pitch wheel events run in 10ms
  audio blocks. This IS coarse time discretization, not rhythmic snapping.
- SF2 sample instruments choose an integer MIDI note nearest detected
  note pitch, then use pitch bend updates every 10ms to follow source F0.
  It is MIDI-like events, not a MIDI file or tempo-quantized note grid.
- Raw source NCCF is not yet independently confidence-validated or checked
  against a separate F0 tracker. Bad harmonics/octaves can still corrupt it.

**Separate agent-authored V3 pitch-control test; NOT yet listening-approved,
not installed in game, not a raw-detector upgrade:**
- tools/music/pitch_stability_v3.py keeps existing onsets unchanged,
  estimates per-note pitch centers robustly, suppresses slides under
  25 cents, reduces modest deviations to ~35%, preserves established
  larger glides at ~80%, and rejects transient spikes.
- Existing 1,234 event times (10ms grid) are unchanged. Frame-to-frame
  pitch steps over 10 cents dropped from 4,840 to 4,035 in the source
  under this method. This is not proof of audible improvement.
- Three synthetic-control tests pass: tiny jitter suppressed, sustained
  larger glides preserved, genuine note-to-note interval preserved.
- New separate two-voice 25s A/B lab with V1/V2/V3 and original vocal:
  http://100.115.120.66:8181/tools/music/audition-v3/
  Rendered sawtooth and church-organ preview assets are on CT211 under
  /root/bitstream-maxi/mountain-voice-gallery-v3/; originals untouched.
  Browser test passes for revision switching and original voice reference.
- Next raw-detector improvement should independently compare a confidence-
  aware second estimator and temporal continuity, and test accurate
  attack timing against source audio. Do not re-quantize notes to BPM
  or install new dependencies without Marvin's approval.

V3 is a limited two-instrument pitch-treatment experiment, not a
twelve-instrument accepted art revision or production audio change.

## V4 architecture consultation and first controlled challenger (2026-11-15)

**Owner-origin suggestion (Marvin):** after V3 improvements, consider a
**generative conversion** of singing into instrument audio instead of
continuing to fix a MIDI-like note-trigger pipeline. Preserve exact singing
rhythm, phrasing, melody and deliberate large glides, without unwanted tiny
slides. This is a suggestion to research, NOT approval of new dependencies,
commercial model licenses or use of a neural model in the game.

**Astra Friday consulted before V4 implementation:** read-only Kanban
bitstream-progression task t_6fa9e952. Astra independently recommended:
1. Stop using discrete notes as the master performance representation; use
   continuous F0/voicing/amplitude/attack curves with distinct articulation
   layers. Keep SF2 as a separate instrument-specific alternative.
2. Fix SF2 false reattacks from pitch changes, wrong held sample through
   rests, 10ms block onset scheduling, silence/pre-roll and clipping/range
   assumptions. These are static code findings and must be validated.
3. Build a manually checked 25s vocal-performance reference; distinguish
   pitch detector failure from synthesis failure before full song conversion.
4. Candidate YIN/harmonic analysis + confidence/continuity and 5ms
   acoustic onset extraction, NOT semitone-state quantization.
5. Explore DDSP as a neural timbre-transfer challenger only after dependency
   and checkpoint license approval; DDSP still depends on accurate F0.
   RAVE/diffusion are potential research lanes but do not yet warrant
   swapping our deterministic architecture, especially given model/domain
   and commercial licensing concerns. No source audio was actually
   listened to by Astra, only code and sources were reviewed.

**V4 engineering proof (agent-authored, not musically approved):**
- tools/music/continuous_challenger_v4.py: source-guided continuous
  oscillator-bank synthesis for Candy's sawtooth and Vertigo's organ,
  with phase integration and band-limited partials; no note-on/off MIDI
  messages, no semitone sample selection and no 70ms onset exclusion.
  Voice amplitude and separate short attack exciter come from 5ms
  source-envelope/spectral evidence. The V3 pitch stabilizer output is
  deliberately reused as the pitch control: this is NOT yet a repaired
  raw pitch detector nor a neural generative model.
- First 25s rendered to CT211 /root/bitstream-maxi/mountain-voice-gallery-v4/.
  V1/V2/V3 renderings and all six FLAC masters remain untouched.
- tools/music/audition-v4/: new 2-voice 4-way V1->V2->V3->V4
  same-song-position A/B interface, independent instrumental backing,
  original Maxi vocal reference and feedback UI.
  Private 10 Ogg files are ignored under public/music-audition-v4/;
  build script also publishes to current CT223 tailnet-only lab server.
  http://100.115.120.66:8181/tools/music/audition-v4/
- test_continuous_challenger_v4.py: confirms true acoustically separate
  40ms-apart attacks can be found on 5ms frames, continuous synth
  renders non-silent valid sound without discrete note events, and
  impulse exciters do not reset sustained oscillator phases (3/3 pass).
  Browser A/B smoke checks all four revisions, source reference and
  25-second media synchronization (no JS/network errors).

**Important limitations:** V4 currently retains V3 flawed raw F0
(including occasional octave errors), uses a simple source RMS energy
gate rather than separately validated lead-voicing confidence, and
does not include a manually checked oracle or an independently trained
neural instrument-transfer model. V4 should be called an architecture
challenger rather than a complete upgraded transcription pipeline.
The game still uses V1 home synthesized voice only. No V4 voice
package is integrated with gameplay, nor is any new dependency installed.

## Genuine pretrained neural DDSP trial (2026-11-15)

**Marvin's actual V4 artistic feedback:** the Candy saw may be a little
better in V4; Vertigo's continuous V4 organ sounds much worse overall,
even if it might have improved pitch accuracy. V4 organ lost V3's soul.
V3 Vertigo organ is the artistic keeper/benchmark. This assessment is
a user listening judgment, not an agent metric.

**Marvin explicitly approved an isolated DDSP experiment.** Implemented
using the real official Google Magenta pretrained TFJS DDSP checkpoints
for violin, trumpet, tenor saxophone and flute; an organ checkpoint was
not available among these four. Model inputs are original 25-second
isolated vocal loudness and the continuous V3 stabilized F0, resampled
at 250 frames/s. NO MIDI note events or tempo-grid quantization.
DDSP is genuine neural timbre synthesis, but it is still limited by the
source pitch detector's errors and is NOT a raw audio-to-audio model.

Execution was on CT223 native TFJS CPU without needing CT211's
temporarily unavailable NVIDIA driver. Both npm dependencies are pinned
inside a *separate research manifest*, NOT the game root or Demucs
venv. A 5-second model emits 80,000 samples; six overlapping chunks
using 1s crossfades make exactly 25s of seamless output. Every model
rendered valid finite audio with preview RMS about -23dBFS and no
clipping. Local waveform check: source-to-DDSP loudness correlations
0.922–0.948, with best offset 8–28ms. These metrics only support
approximate timing/dynamics retention; they do NOT establish pitch
or musical quality.

Research source scripts, environment notes and restrictions:
tools/music/ddsp-proof/README.md
tools/music/ddsp-proof/extract_features.py
tools/music/ddsp-proof/render-ddsp.mjs

Real inference artifacts were created outside Git in
/home/hermes/experiments/bitstream-ddsp-20261115/audio/rendered/.
Official model weights/downloads are in the isolated work directory
under models/ and were not committed.

**Private listening demo** (original Maxi vocal + optional backing,
4 neural instrument models, untouched V3 organ and V3 saw benchmarks):
http://100.115.120.66:8181/tools/music/audition-ddsp/

Site source: tools/music/audition-ddsp/. Private 25-second Opus
clips and gallery metadata are gitignored in public/music-audition-ddsp/.
Chromium tested all 6 switching paths plus original, backing, room,
25s lengths and exact audio filename availability, with zero JS or
HTTP errors.

The DDSP *software* is Apache-2.0, but the rights to distribute its
pretrained checkpoints and outputs in a public commercial game still
need verifying separately. Do not silently claim the audio is ready
for publication. Marvin has not yet listened to the DDSP outputs.

## Independent SPICE pitch pipeline and ACE-Step cover assessment (2026-11-15)

**Marvin guidance:** existing underlying instruments are musically
close enough that improving pitch data is a priority; also asked about
ACE-Step covering the material. This is user planning guidance, NOT
approval to overwrite V3 Vertigo organ or deploy new game audio.

**Implemented in separate SPICE/V3 audition:** official Google
SPICE TFJS neural pitch model ran on Maxi's **original isolated vocal
waveform**, 16kHz, 25s, 32ms inference hop. 783 frames; 564 with
confidence >=0.7. This was the *full* SPICE detector from Magenta's
Tone Transfer pipeline, not the previous V3 F0 workaround. No changes
to Demucs source masters. New confidence-aware SPICE F0 interpolated
to 250Hz DDSP conditions with unchanged source loudness, four genuine
neural DDSP targets re-rendered. Separate CT211 V3 sampled church organ
and Candy saw retuned using SPICE F0 while preserving their 1,234
original note timestamps and sampled instrument program identities.

**Finding:** among 546 overlapping high-confidence voiced frames,
median V3/SPICE absolute pitch disagreement ~27.5 cents, with 63
>700-cent disagreements. This is an *independent-detector mismatch*
and not conclusive proof that either F0 source is correct. It gives us
a bounded, causally interpretable listening test: leave instruments
mostly fixed, change source pitch estimates.

New 12-selection, 14-audio-file mobile/Tailscale A/B lab:
http://100.115.120.66:8181/tools/music/audition-spice/

Reproducible research scripts in tools/music/ddsp-proof/.
The private model/source audio and generated 25s test clips remain
outside Git. Do not ship or merge neural outputs without commercial
rights review and Marvin's listening approval. V3 organ untouched.

**ACE-Step:** official ACE-Step 1.5 supports Cover mode but its maintainers
confirm that regenerated covers can vary melody, unsuitable as an
assumed sample-exact replacement for the game's original vocal stem.
It could still produce a separate polished promotional interpretation.
Local CT214 ACE-Step LXC was stopped, and its ext4 LV is flagged
read-only (blkdev --getro = 1) so Proxmox cannot start it. A read-only
e2fsck -n reported the filesystem clean. We did NOT modify LV flags,
repair the volume, or disrupt current inference services. If we
proceed with ACE-Step, fix and back up CT214 deliberately, or use an
isolated new runtime after checking model weights / hardware.

## Single authorized Kie.ai organ cover spin (2026-11-15)

**Marvin explicitly authorized ONE paid Kie.ai generation** using
Maxi's separated vocal stem, aiming for either church organ or
holographic pads. Gal Friday selected church organ because V3
Vertigo organ is the established artistic benchmark.

**Task and result:** Kie Upload & Cover V6 processed a 256kbps MP3
copy of the entire 214.976-second original isolated vocal (original
FLAC untouched), instrumental=true, style solo cathedral organ,
audio_weight=0.95, style_weight=0.85, weirdness_constraint=0.05,
variety=0, target duration 215s. Exactly one Kie generation task
2a05f8478617530bec35454aa1d9e686 was accepted and completed,
consuming **12 credits TOTAL**. That same task returned **two**
48kHz stereo MP3 takes, each 214.824s long. This is not two spins.

Both downloaded and archived on CT223 under
/home/hermes/experiments/bitstream-kie-cover-20261115/.
Same-clock excerpt switching against unchanged V3 Vertigo organ,
Maxi original vocal, optional backing, with links to both full MP3s:
http://100.115.120.66:8181/tools/music/audition-kie-organ/

Research/provenance document:
tools/music/kie-cover-proof/README.md
Listening site:
tools/music/audition-kie-organ/
Generated audio is Git-ignored; no game audio or old labs changed.

**Limits:** Kie is a *generative cover*, not a guaranteed
time-synchronous vocal-to-organ timbre converter. It may
reinterpret pitches, timing and instrumentation despite strong
style requests. User has NOT yet audited/approved either take
or replacement in the game. V3 organ is preserved as reference.

## Kie.ai duplicate-submission reconciliation (2026-11-15)

Marvin explicitly authorized ONE paid Kie.ai Upload & Cover generation
on Maxi's isolated vocal stem, with the expectation that its two audio
variants would BOTH be saved for listening. Two independent Gal Friday
processes accidentally ran separate paid submissions with different
local idempotency sentinels. That was an agent coordination error, NOT
a second Marvin authorization. Marvin was informed. No additional
paid submissions were made after the overlap was discovered.

Task A (first) is 2a05f8478617530bec35454aa1d9e686: 12 credits,
uploaded the 214.976s vocal as 256kbps MP3. Two output MP3 SHA256
digests: 3efd3022e8e2b050fda94c1e4a824279688da7322d94615b69108e58d08ff6f3
and 48b399668205d067cc516a497972f01a19ed106f6074811716a190697227480c.

Task B (unintended duplicate) is de4cf96e280b04256906de5090771d93:
12 credits, uploaded original full FLAC. Its two MP3 SHA256 digests:
cf9e1df919445d4f970f1932e6e2e5c2a997b531c13416345acec8d8f8355a48
and c416f4dacab331f9ad74bc718cd929598f229aa1b4a6557d938db8aedf2ccb01.

Total: TWO Kie tasks, 24 credits, FOUR distinct complete MP3 files.
All four were retained in their respective CT223 source directories
and backed up on CT211 (checksums verified). The canonical receipt is:
/home/hermes/experiments/bitstream-kie-organ-20261115/two-task-archive-receipt.json
plus independent CT211 archive:
/root/bitstream-maxi/mountain-voice-gallery-kie/2026-11-15-vertigo-organ-v6/two-task-archive-receipt.json

Consolidated private listening archive for all four original full MP3s:
http://100.115.120.66:8182/tools/music/audition-kie/

This persistent Tailscale-only range-serving web lab includes the
two variants from each Kie task, Maxi's original vocal preview,
and an unchanged 25-second V3 organ benchmark (2:30-2:55).
Native audio controls and synchronized A/B switching were tested
in headless Chromium. Four distinct download URLs were verified.
A second tailnet host confirmed the 206 byte-range response. This
service survives reboots through enabled user systemd unit
bitstream-kie-range.service with Linger=yes. It serves from a
stable experiments/site directory independent of this Git worktree.

Repo sources: tools/music/audition-kie; private MP3 files are ignored
under public/music-audition-kie. No game audio or SFX was changed, and
no new Kie task will be launched without distinct user authorization.
The original V3 organ sound remains the musical benchmark.

Future Kie safety: ALWAYS check both the provider task list and
the canonical shared project task ledger before spending; use a
single cross-process durable idempotency sentinel for each explicitly
authorized paid spin. An uncertain response is NOT authorization to
retry a chargeable API request.

## Local ACE-Step 1.5 organ and holo cover A/B (2026-11-15)

**Marvin baseline and request:** Both prior Kie V6 organ covers were
tonally "head and shoulders above" the earlier MIDI-like and DDSP
attempts. Marvin approved testing locally hosted ACE-Step 1.5 as a
possible replacement, with cathedral organ and holographic pads
and 0.9 vs 0.7 source-cover strengths.

**Safely recovered CT214:** Original ext4 LV was marked read-only
despite passing offline read-only e2fsck. Native recovery snapshot
before-ace-test-20261115 was created FIRST, then LV permission
returned to RW and CT214 started. Existing ACE-Step Turbo weights
and Nvidia RTX 3060 CUDA validated. No forced filesystem repair or
model reinstall. Keep recovery snapshot.

**Actual audio-to-audio inference:** Original ~215s Maxi isolated
vocal waveform, not MIDI or V3 pitch, fed to existing ACE-Step
1.5 Turbo cover model with instrumental mode, 8 steps, fixed seed
20261115, batch 1 and CPU offload. All four runs succeeded,
organ s0.9, organ s0.7, holo s0.9, holo s0.7.
Each full cover duration 214.9665s; derived 25s excerpt 25.0065s.
No cloud credits spent. Source FLAC and all game audio untouched.

**Tailnet-only level-matched listening lab:**
http://100.115.120.66:8181/tools/music/audition-ace15/

Seven selectable versions: four ACE 1.5 candidates, prior two
Kie V6 organ takes, unchanged V3 organ; original Maxi vocal plus
optional backing, and links to all six complete generative covers.
Independent Chrome smoke verified seven switching paths, all nine
25-second media assets and six full links with no errors.

Reproducible research source:
tools/music/ace15-proof/README.md,
tools/music/ace15-proof/{generate.py,run-matrix.sh,export.py},
tools/music/ace15-proof/export-results.json.
Private audio/gitignored under public/music-audition-ace15/.
Game production code, original stems and older audition labs unchanged.

These are generative covers and not necessarily sample-synchronous,
melody-faithful or instrument-isolated. User has NOT listened to or
approved these ACE outputs as music art. Kie tonal-quality verdict
and V3 organ artistic baseline are preserved as prior judgments.
