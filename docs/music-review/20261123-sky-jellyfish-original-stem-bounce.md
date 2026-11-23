# Sky Jellyfish Mountain: original-stem elastic membranes and floating stereo halo

**Draft, unmerged, not owner-listening approved.** Gal Friday, November 23, 2026. Tracks issue #264. User requested another biome for a multi-audition evening; all first-listen values here are assistant proposals, not statements from Marvin.

## Existing source and sound design

The shipped biome has actual bouncySpring terrain and an established springRebound physical velocity model. It already renders decorative jellyfish bells in the scenery. Its separate melody timbre is vowel choir / floating cathedral. This music project reads the real grounded/airborne and valid landing events; it does NOT change physics, movement, hazards, score, replay, visual art, beat grids, source musical notes, or transport.

Five original instruments (bass, drums, guitar, piano, other) run through native jellybloom Web Audio. Each retains an unprocessed dry path. The parallel effect creates a small stereo, slightly pitch-wavering halo from the recorded source using 28ms/47ms left/right delays, slow 0.33/0.43Hz modulation, an original-source 130Hz highpass, and grounded 4.7kHz to airborne 12.5kHz lowpass transition. The user adjusts halo buoyancy and tentacle float rate separately. No new soundtrack or synthesized chords.

One true takeoff triggers a 390ms deterministic soft FWOOO on the original other stem; the halo brightens/widens with flight. A valid non-crash landing triggers a 770ms BWOOOING elastic membrane on the drum effects graph, with two progressively smaller rebounds. The physical sound exists even if the recording falls silent between drum hits. Game landing results arriving before the authoritative grounded transition are held and applied once grounded. Crash, invalid impact, menu and wrong-biome transitions drop queued events. A rider already airborne when changing into this biome creates an initially open effects graph. Maximum three overlapping physical voices per graph, disposed immediately on graph teardown; no polling or gameplay timers added.

## Proposed audition settings, not approved

- Buoyancy/stereo halo: 135%.
- Tentacle float speed: 100%.
- BWOOOING landing: 130%.
- FWOOO lift: 95%.

The audition provides solo drums and unprocessed A/B, separate landing and takeoff test controls, slider changes during playback, and native five-stem source recordings.

## Objective tests

- 272/272 targeted music/biome/visual tests across 27 suites green.
- 483/483 determinism tests across 18 suites green. No modifications to the simulation tripwire or identity digest.
- Production Vite build: 522 modules. Chromium standalone OGG player loads all five original One More Run source recordings, adjusts controls and plays physical event SFX without page errors.
- Real Chromium OfflineAudioContext, original One More Run 3.5s stereo excerpt at 48kHz: dry RMS 0.081398 and peak 0.73002; grounded versus dry delta 30.39% of dry RMS, peak 0.75545; flight versus dry delta 59.01%, peak 0.80065; flight versus grounded delta 30.30% of grounded RMS. A valid landing added 21.52% delta relative to grounded RMS; landing alone with ALL original stems silent RMS 0.020548, peak 0.252375. These are measured signal differences, not judged loudness or full-song true peak.
- A real production-game Chromium Title-to-RunScene loaded original One More Run audio and switched all seven distinct processors on the real mixer without restarting the song clock; 21 retired crossfade graphs drained to zero. Simulated event inputs at the actual driver boundary are NOT a claim of manual terrain gameplay.
- Only symlinks to original archival OGG media were added in ignored, disposable local dist output for test. No recordings were changed or checked into git.

## Review and listening gate

This implementation is stacked on draft Steampunk #263, based on consolidated five-biome draft #261. The static audition is published separately via the existing main-based draft #201, using the existing 20-second Pope original-instrument MP3 review sample; these are not the same original OGG passage measured above. The user's listening approval is outstanding. Does the halo sound buoyant rather than generic chorus? Is the elastic membrane organic or a cartoon spring? Is the lift too similar to Garbage's existing suction release? Tune independent sliders before any production merge.
