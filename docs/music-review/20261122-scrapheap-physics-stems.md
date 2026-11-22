# Garbage Dump Glacier: physical stem coloration, V1

**Stacked on draft PR #194** to avoid editing or rebasing its Snowpack work prematurely. Issue #193 is the cross-biome original-stems epic; PR #200 is the design reference. This implementation does not rewrite the existing vocal MIDI-derived melody pipeline, replace source performances, or alter source music time.

## Implemented

- An explicit, read-only **physics-to-music signal adapter** (`MusicPhysicsSignals.js`): normalized impact from `EVT.LANDING.impactSpeedPxS`, grounded speed-dependent contact. No invented surface roughness.
- A reusable low-cost **scrapheap** native Web Audio effect. The original drums remain on a dry path, while a quieter distorted, high-passed, inharmonic three-mode resonator path introduces metallic rattles. Ground speed raises the rattle send; airtime removes it. Landing impact creates a bounded burst with rapid onset and slower decay.
- The new processor remains in the instrument's existing effects graph and does **not** synthesize notes on a guessed beat grid, replace MIDI instrument performances, restart a song, or change user levels.
- Controls avoid per-frame graph rebuild. Speed-derived wet-send updates are quantized in control policy to avoid continual AudioParam automation.
- Actual independent instrumental stem audition and dry/airborne/landing experiment: `/tools/music/scrapheap-audition.html`. Samples are derived MP3 previews from existing stems and do not overwrite original masters.

## Source and quality guardrails

Only *drum stem* processing is involved in this first pass; it intentionally does not claim full-body metallic instruments yet. Drum attacks excite an inharmonic resonant bank rather than inventing individual musical notes. The impact pulse raises wet send **only where original source audio is present**; a separate contact Foley/impact source would be a later scoped task.

The absolute mix and true peak on long-form songs, phone listening, cross-biome transitions, repeated landing and low-end devices require further review. This is an early live-DSP demonstration and should remain a draft PR until approved. Snowpack remains the first independently approved biome sound.

## Technical verification

Focused unit tests check invalid input fallback, speed/contact policy, airborne suppression, landing timing, no effect graph replacement, non-Snowpack policy isolation, audio param bounding, and stable song clock. Browser smoke covers decoding and playing the actual five instrument stems and changing physical inputs without page errors. Vite builds the standalone audition as a separate entry, with no game-menu wiring.

## Recorded browser DSP probe (one excerpt, not a release-wide loudness claim)

A representative 4-second original drum excerpt was rendered in actual Chromium `OfflineAudioContext` with grounded contact at maximum, a strong landing pulse at 1.15 s, and takeoff at 2.4 s. Compared against the **same decoded original audio**, the unprocessed RMS was approximately 0.08878, processed RMS 0.08891, difference RMS 0.00432, sampled peak magnitude 0.606, and processed mono-downmix RMS 0.08799. No non-finite samples. This verifies nonzero, bounded DSP response and mono output on that one excerpt, **not** full-song true peak, subjective quality, or audio CPU compliance.
