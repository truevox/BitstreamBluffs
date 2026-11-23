# Garbage Dump Glacier: physical stem coloration, V1

**Stacked on draft PR #194** to avoid editing or rebasing its Snowpack work prematurely. Issue #193 is the cross-biome original-stems epic; PR #200 is the design reference. This implementation does not rewrite the existing vocal MIDI-derived melody pipeline, replace source performances, or alter source music time.

## Implemented

- An explicit, read-only **physics-to-music signal adapter** (`MusicPhysicsSignals.js`): normalized impact from `EVT.LANDING.impactSpeedPxS`, grounded speed-dependent contact. No invented surface roughness.
- A reusable low-cost **scrapheap** native Web Audio effect. The original drums remain on a dry path, while a quieter distorted, high-passed, inharmonic three-mode resonator path introduces metallic rattles. Ground speed raises the rattle send; airtime removes it. Landing impact creates a bounded burst with rapid onset and slower decay.
- The new processor remains in the instrument's existing effects graph and does **not** synthesize notes on a guessed beat grid, replace MIDI instrument performances, restart a song, or change user levels.
- Controls avoid per-frame graph rebuild. Speed-derived wet-send updates are quantized in control policy to avoid continual AudioParam automation.
- Actual independent instrumental stem audition and dry/airborne/landing experiment: `/tools/music/scrapheap-audition.html`. Samples are derived MP3 previews from existing stems and do not overwrite original masters.

## Source and quality guardrails

Only *drum stem* processing is involved in this first pass; it intentionally does not claim full-body metallic instruments yet. Drum attacks excite an inharmonic resonant bank rather than inventing individual musical notes. Physical landing now also triggers a **deterministic one-shot Foley** even when the original drum audio has no transient. That is separate from and never a replacement for the original instruments. The takeoff has a smaller suction-release Foley on the real grounded→airborne edge.

The absolute mix and true peak on long-form songs, phone listening, cross-biome transitions, repeated landing and low-end devices require further review. This is an early live-DSP demonstration and should remain a draft PR until approved. Snowpack remains the first independently approved biome sound.

## Technical verification

Focused unit tests check invalid input fallback, speed/contact policy, airborne suppression, landing timing, no effect graph replacement, non-Snowpack policy isolation, audio param bounding, and stable song clock. Browser smoke covers decoding and playing the actual five instrument stems and changing physical inputs without page errors. Vite builds the standalone audition as a separate entry, with no game-menu wiring.

## Audibility regression and correction (2026-11-22)

Marvin reported that speed/jump/landing button changes were inaudible. That was supported by a measured **original drum-only difference RMS of only 0.00432 against original RMS 0.08878**, before the other instrument stems masked it. The earlier Chromium smoke exercised UI controls but never asserted audible effect strength. The original impact behavior also only modulated existing drum signal: a landing between hits could be silent. The first prototype was therefore not accepted.

Changes: (1) strengthen the source-excited inharmonic rattle bed while keeping an untouched dry drum path; (2) synthesize a short **deterministic physical scrap-metal strike per authoritative landing event**, even between drum notes. This is physics Foley, NOT a melody, beat-synced MIDI replacement, or new original recording. One reusable deterministic buffer per processor (about 20,160 mono samples at 48kHz); a maximum of four overlapping strike voices, and cleanup on effect disposal; (3) add a **Solo drums** button to the audition so testers can isolate processing instead of listening through four other instruments.

Real Chromium 4-second offline render using all five *original* recorded instrument previews, at maximum contact, a hard landing at 1.2s, and normal five-stem mixing gains:

- Original full-mix RMS: 0.026979; full-mix maximum-contact *difference* RMS: **0.007096 (~26.3% of original full mix RMS)**.
- Dry full-mix peak: 0.1731, processed full-mix with landing peak: 0.2557 (sampled peaks, not true-peak analysis).
- During the 1.2–1.6s impact window, the metal strike with **no drum audio or any other stem connected** had RMS 0.03250 and sampled peak 0.2538.
- No page errors or non-finite samples in tested excerpt. This demonstrates a real source-independent landing sound and a substantially larger signal change; it does **not** establish a human-audibility guarantee on every speaker, full-song true-peak compliance, or mobile CPU/headroom certification. Human listening still gates release.

## Owner listening feedback — sticky puddle “splock” (2026-11-22)

Marvin confirmed that the corrected effect is audible and that he **loves** it, but requested a little more “splock” and described the texture as **lifting a foot out of a wet, sticky garbage puddle**. Treat this as sound-direction feedback, **not** as approval of any specific technical implementation. The proposed response is to emphasize the rubbery suction-release sound and hollow pop, not merely boost metallic harshness.

Added a new physical-impact **Splock** coefficient (default 120%, adjustable 60–160% in the audition) to the source-independent deterministic impact, without increasing the always-on ground-rattle bed or changing source playback. The 420 ms precomputed hit now includes a short rising suction chirp, a delayed rubbery lip-pop and a few scattered clacks over the prior inharmonic knock. Added a repeatable **Test splock** trigger independent of waiting for a gameplay landing; the audition keeps normal hard/soft landing controls. Any final setting depends on Marvin listening to the updated build.

**Chromium measured headroom, 4 sec actual five-stem mix:** three hard physical hits at 0.7/1.7/2.7 seconds, using the same input and normal demo master gain: 60% Splock peak 0.2184 / impact-window RMS 0.0243; 120% peak 0.3259 / RMS 0.0467; 160% peak 0.4130 / RMS 0.0619. No non-finite samples, all tested sampled peaks under 1.0. **This is a short excerpt only, not a full-game loudness/true-peak/mobile/perceptual acceptance report.** No original audio masters or derived biome melodies changed.

## Owner-favorite intensity and takeoff pair (2026-11-22)

**Owner feedback (Marvin, direct quote):** “I cranked the splock slider, and I fucking LOVE it.” The audition slider's maximum at the time was **160%**; “cranked” is interpreted as maximum rather than independently measured slider state. The response author also proposed a quieter suction sound on takeoff, and Marvin replied “YEAH!! OK, what's neext?” This is enthusiastic authorization to explore a paired effect, **not yet a final production-mix approval or instruction to merge other PRs**. Preserve that attribution: the default-selection and sound-design implementation below is a **Gal Friday recommendation** building on owner feedback.

**Implementation:** Default physical landing Splock coefficient **1.6 (160%)** in the actual Scrapheap DSP, with existing bounded 0–1.6 parameter preserved and the listening page set to 160% by default. A second reusable, deterministic **240 ms adhesive-release buffer**, distinct from the larger 420 ms landing SPLORP, gets a short low-to-high viscous suction rise and a tiny pop. It triggers only on an authoritative garbage-biome grounded→airborne transition, scales to the existing real ground-speed/contact proxy with a small minimum for low-speed jumps, and never fires repeatedly while airborne or in menu/other biomes. Both one-shots use the existing capped max-four-voice/disposal infrastructure; no playback-clock changes, source replacement, new beat assumptions, new instrument performance, or unseeded randomness.

**Audition:** “Take off (suction)” and standalone “Test suction” let the owner hear the new half of the pair without editing the song. “Hard landing” and “Test splock” demonstrate the existing beloved full-strength follow-through. Existing dry compare, drum solo, looped original five stems and adjustment slider remain.

**Measured scope:** 15 focused suites / **133 music-audio tests** passed and Vite production build passed. Chromium audition smoke triggered takeoff, landing and separate controls. A *representative five-second* Chromium offline render with 3 takeoffs and 3 landings had dry full-mix sampled peak **0.17309**, affected full-mix peak **0.41801**, and source-independent Foley-only peak **0.41810**; zero non-finite samples. This is **not** a full-program true-peak/loudness/mobile/headphone certification or a substitute for Marvin listening.
