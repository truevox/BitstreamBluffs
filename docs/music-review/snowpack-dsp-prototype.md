# Snowpack DSP prototype — Issue #193

Owner direction (2026-11-21): keep original instrumental stems instead of re-performing them as MIDI; generate MIDI for biome vocals separately. Debumont should sound **muffled by heavy snow**, not glittery/crystalline. Preserve all master recordings and stereo sources.

## What is implemented
- New `snowpack` low-cost Web Audio processor: two low-pass stages, dark high-shelf, dynamics compressor, and dry/wet paths. Continuous normalized `depth` parameter (0–1) with asymmetric smoothing (quick airborne clearance, slower powder settling).
- Preset on Debumont original bass, drums, guitar, piano and Other; **Powdery** is the ground default (0.72; bass 0.56). On takeoff the Snowpack depth smoothly opens to 0 (dry original stem), on landing returns to the previous powder depth. An airborne entry into Debumont starts unsnowed. No modification to sample starts, playback rate, source beats, vocal MIDI, or original files.
- Standalone audition page `tools/music/snowpack-audition.html` with local audio file picker, three presets, ground-depth slider, and a repeatable **Jump / Land** switch to simulate the game state. No uploads.
- The audition page is a Vite HTML entry and is included in production builds, without adding it to game menus.

## How to audition
```sh
npm run dev
# Open http://localhost:5173/tools/music/snowpack-audition.html
```
Pick a local original recording or an individual stem (Ogg, WAV, MP3 supported by your browser), press Play, choose Powdery (default), and click **Jump — leave powder** to hear the unfiltered original while airborne. Click **Land — back into powder** to reapply the chosen ground depth. The ground-depth slider remains adjustable midair.

## Verification
- Jest: `npm test -- --runInBand tests/src/music-fx.test.js tests/src/dynamic-orchestra.test.js`
- Production: `npm run build`; ensure the audition HTML appears in `dist/tools/music/`.
- Real Chromium + OfflineAudioContext 48 kHz sine tests: at depth 0.95, 6 kHz RMS ≈ 0.051× dry (−25.8 dB) versus 110 Hz RMS ≈ 0.450× dry (−6.9 dB).
- Headless Chromium successfully decoded and played a real Ogg file, exercised Jump / Land, adjusted depth midair, returned to ground, and stopped cleanly; no page errors. 15 targeted Jest tests passed; game builds successfully.

## Open acceptance gates
- Subjective A/B on representative stems and full mixes; inspect transient character, bass balance, loudness, artifacts and transitions.
- CPU/mobile cost and accessibility; keep a clean fallback and do not auto-enable new processor families in unrelated biomes.
- Future physics-controlled impact/momentum, beat-sculpting, stereo movement, and inter-biome morphing should be separately auditioned, not bundled into this baseline.
