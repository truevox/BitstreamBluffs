# Underwater Mountain Hydrostatic — draft source-grounded audio experiment

Owner intent: pressure accumulates on real deepest downward **terrain elevation**, never decreasing inside the biome; jumping and ascending temporarily relieve **audible** pressure, but do NOT clear stored pressure; falling/landing reimpose it and trigger a quiet physical water-pressure wave. Explicit exit resets. All original stems and separate biome MIDI melody leads are preserved. No fabricated beat grid or score change.

Source implementation: draft [Bitstream Bluffs PR #252](https://github.com/truevox/BitstreamBluffs/pull/252) commit `5d34f85`, stacked on Scrapheap #221 and Snowpack #194. This standalone sample snapshot is shipped through existing audition draft PR #201, not merged production.

The browser page uses the SAME `HydrostaticPressure` pure state policy, `MusicFXGraph` processor and `DynamicOrchestraPresets` as the game implementation, with simulated signed terrain elevation/jump/apex/fall/touchdown controls. Original five ~20-second recorded instrument stems are referenced **from existing neighboring Scrapheap preview**, not copied, modified or reprocessed. In the real game, the inputs come from RunScene's current `terrain.heightAt(sled.x)`, rider `y`/`vy` and `grounded` state.

Verification: 142 focused tests pass, Vite build and built browser click/play assertions pass; real Chromium offline audio compared five original stems (dry parity difference RMS 1.64e-9; deep-pressure difference 0.01312; rising relief difference 0.01238; landed wave difference 0.00615). No sampled clipping in tested three seconds. Full-song true peak/loudness/mobile and owner listening review remain outstanding.
