# #30 — Owner-approved ground-brake help and real gameplay acceptance

## Owner binding

Marvin selected the **existing airborne AirBrake button** to operate as the ground brake while grounded. This **does not** change the chosen Trick Deck layouts or remove any trick inputs:

| Device/preset | Ground brake when grounded | AirBrake when airborne |
| --- | --- | --- |
| Tricks Right (default keyboard) | **A** | **A** |
| Tricks Left (alternate keyboard) | **Left Arrow** | **Left Arrow** |
| Classic keyboard | **Up Arrow**, in addition to existing **S** ground brake | **Up Arrow** |
| Standard gamepad | **X** (gamepad B already brakes) | **X** |
| Touch overlay | Existing AirBrake control | Existing AirBrake control |

The existing production `RunScene.normalizePad` and fixed-tick `_simTick` already convert `airBrake` to **brake only while physically grounded**, re-deriving every 120Hz simulation tick. Grounded `Sled.applyControls()` cannot spend an airborne lift impulse, and releasing the key resets the pad through InputRouter. This change **does not touch runtime physics, replay protocol, SIM_REVISION, controls binding maps, or the BSOD chase**. It only updates the Settings / How to Play visual reference and adds acceptance coverage. In the UI, the single button is now labelled `AIR/GND BRAKE` for keyboard layouts and gamepad; the contextual tip explicitly explains its effect.

## Evidence

- `tests/src/title-howtoplay.test.js` and `tests/src/control-layouts.test.js`: 25/25 passing, including exact keycaps and layout bounds; no displaced trick key, text overlap, or missing glyph.
- `tools/test-ground-brake-browser.mjs`: actual built Chromium game for all three keyboard layouts with physical `page.keyboard.down` and `up`; correct held AirBrake input and release; controlled **BSOD catch** still produces an authentic `cause: bsod` while braking. The wall is moved closer **in the diagnostic fixture** to test collision, not to claim a naturally occurring 57-second chase. No page errors.
- `tools/test-ground-brake-ab-browser.mjs`: actual Matter + fixed-tick seeded same-course A/B with key held at tick ~45 through tick ~251. Unbraked speed **502–503 px/s** versus grounded AirBrake **~136 px/s**, consistently for all three layouts. Braked sled ~355–361 pixels behind matched unbraked run. No fabricated motion, direct velocity mutation, or synthetic run traces.
- Main's gameplay sound, music, physics, replay and saved-run provenance remain unchanged. Pages CI will run the real control/browser smoke and the How to Play unit suites. No Netlify preview build (`[skip netlify]`).

## Explicit remaining limitation

This confirms normal ground braking and a controlled BSOD catch, **not** the timing of a *natural* long-duration hold-and-catch on every possible terrain/seed/difficulty. Natural long-tail pursuit can be sampled separately without holding up the user-facing mapping correction. Future owner approval is required for any further brake-strength tuning.
