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
