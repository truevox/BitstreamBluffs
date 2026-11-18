# Bitstream Bluffs — BSOD-authoritative wind audio consumer (feature branch)

**Status: independently implemented integration candidate, NOT merged to main / NOT deployed.** Based on Controls Friday's gameplay branch commit `a918df3` (chase/event `b0eee91` plus real wind physics). The new `EVT.BSOD_STATE_CHANGED` event is the exclusive live wind source for `AudioSynth`; there is no local BSOD timer, distance predictor or generated gameplay hazard in music code. The controls branch remains authoritative for pursuit, wind simulation, camera, pom-pom, physics, `windEnabled` persistence and Settings UI.

## Integration contract

`AudioSynth` consumes each **one-object** post-physics `BSOD_STATE_CHANGED` snapshot. It reads `active`, signed `relativeAirX`, `atmosphereDensity` and `proximity01` without mutating the event or gameplay. Wind loudness uses a bounded, sign-symmetric `abs(relativeAirX)` speed curve. A zero relative speed is near silence even at maximum BSOD proximity; negative airflow of equal magnitude is equally audible. Vacuum and inactive events mute environmental wind, but **never disable BSOD collision**, pom-pom or danger. UI `windEnabled=false` and persisted `windVolume` affect only audible wind. Song selection, `musicVolume` and `sfxVolume` remain independent.

`AudioSynth.setSpeed(pxPerSec)` continues feeding the same StemMusicDirector bass/intensity path and procedural music intensity; it no longer overwrites the wind gain. A dedicated `_applyWindFromBsod()` updates just the existing wind gain and bandpass frequency, with WebAudio smoothing. Pause mutes wind, resume reapplies the latest authoritative state, and run start/end/abort plus inactive snapshot explicitly reset the state. Event listeners are removed on AudioSynth destroy. The canonical `proximity01` danger signal is retained separately for later **music-only** effects, but **no new BSOD music corruption is shipped by this change**; the previous standalone sound-design lab is not a simulator for this contract.

## Branch, evidence and merge gate

Source changes are limited to `src/systems/AudioSynth.js`, its new focused contract tests, and this music-integration note. There are **no modifications to** `RunScene`, `Sled`, `BsodPursuit`, `SaveStore`, `SettingsView`, `src/events.js`, `InputRouter`, the score inspector or sound assets. Control Friday can continue developing its branch. This music candidate must only be merged **after** the authoritative event and `windEnabled` settings exist on its target branch; cherry-picking the audio changes alone onto old main would create an unrecognized event. No force-pushes.

Tests deliberately cover signed head/tail wind symmetry, silent wind matching at danger=1, wind-independent speed/bass calls, volume/toggle independence, pause/resume, atmospheric vacuum, inactive lifecycle reset, headless browsers, malformed floats, and event listener cleanup. The full game test gate, production build, and eventual real-browser native-game sound validation are separate checks; none substitutes for actual listening approval of more intrusive music corruption.

When eventual music-only corruption is reviewed, use `proximity01` independently of `relativeAirX` so a near-wall rider matching the tailwind can have quiet wind but still receive BSOD music distortion. Do not reuse the existing one-shot global glitch event indiscriminately: it processes SFX and environmental wind too, so it is not an isolated music effect.

## Verification performed

- BSOD/music/settings focused tests: **22/22 passed** (four suites, including seven new wind-consumer scenarios). Full project run: **137 suites passed, seven unrelated legacy/e2e suites failed; 2,242 tests passed, nine failed**. Every one of the **126 `tests/src/` suites passed**, including game audio, event, music-selection and new wind tests. Two failing external suites (`tests/config/unit/env-detection` and `tests/tricks/integration/combo-scoring`) were re-run unchanged on Control Friday's parent branch and also failed there; the other five require independent baseline triage. Thus **do not claim the entire repository test gate passes**.
- Vite production bundle built successfully (179 modules transformed, existing large-chunk size warning).
- No changes have been deployed to the private `:8188` game. Actual listening and browser WebAudio validation remain required before production merging.
