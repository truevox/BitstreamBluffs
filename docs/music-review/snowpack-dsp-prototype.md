# Snowpack DSP prototype — Issue #193

Owner direction (2026-11-21): keep original instrumental stems instead of re-performing them as MIDI; generate MIDI for biome vocals separately. Debumont should sound **muffled by heavy snow**, not glittery/crystalline. Preserve all master recordings and stereo sources.

## What is implemented
- New `snowpack` low-cost Web Audio processor: two low-pass stages, dark high-shelf, dynamics compressor, and dry/wet paths. Continuous normalized `depth` parameter (0–1) with smoothed automation.
- Preset on Debumont original bass, drums, guitar, piano and Other; bass is less buried. No modification to sample starts, playback rate, source beats, vocal MIDI, or original files.
- Standalone audition page `tools/music/snowpack-audition.html` with local audio file picker, three presets, depth slider, and temporary snow-breakthrough button. No uploads.
- The audition page is a Vite HTML entry and is included in production builds, without adding it to game menus.

## How to audition
```sh
npm run dev
# Open http://localhost:5173/tools/music/snowpack-audition.html
```
Pick a local original recording or an individual stem (Ogg, WAV, MP3 supported by your browser), press Play, move depth between 0% (unprocessed) and ~95%, and press Break Through Snow.

## Verification
- Jest: `npm test -- --runInBand tests/src/music-fx.test.js tests/src/dynamic-orchestra.test.js`
- Production: `npm run build`; ensure the audition HTML appears in `dist/tools/music/`.
- Real Chromium + OfflineAudioContext 48 kHz sine tests: at depth 0.95, 6 kHz RMS ≈ 0.051× dry (−25.8 dB) versus 110 Hz RMS ≈ 0.450× dry (−6.9 dB).
- Headless Chromium successfully decoded and played a real Ogg file in the audition page; no page errors.

## Open acceptance gates
- Subjective A/B on representative stems and full mixes; inspect transient character, bass balance, loudness, artifacts and transitions.
- CPU/mobile cost and accessibility; keep a clean fallback and do not auto-enable new processor families in unrelated biomes.
- Future physics-controlled impact/momentum, beat-sculpting, stereo movement, and inter-biome morphing should be separately auditioned, not bundled into this baseline.
