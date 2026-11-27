# #119 remaining scene fields and complete internal candidate file

Follow the integrated #418 source rather than independently merge its
three constituent drafts or duplicate #417's release-only plan.

The remainder codec now has a fixed inventory for timers, effect state,
wards, recovery samples, active zones, BSOD outcome, Kodiak state, HUD
and tutorial counters, telegraph marks/tracker history, camera and ghost
checkpoint. Every admitted number is canonical F64 or an exact integer.
Pending crash, pending contact/despawn queues and terminal/gym boundaries
refuse. Unknown legacy scene roots refuse rather than disappear. Camera
and tracker have exact shapes; fingerprint tick, known subsystem keys
and combined fingerprint must match. The source config is a digest
witness only; fresh trusted configuration is regenerated, not applied
from saved settings. This conservative comparison can refuse a save
after local settings/profile changes. The special magnet spawn is
rederived from a separate native generator; entity-to-terrain, zone,
telegraph and sled RNG bindings are checked before restore. The source
uses its fixed, reviewed schema, not arbitrary wire constructors.

The internal canonical candidate-file codec composes eight typed
sections: clock, RNG, recorder, terrain, Matter, entities, subsystems,
remainder. It checks SHA-256 error-detection seal, exact build/ruleset/
simulation identity, run/tick/seed and all section schemas; prepares
a detached native recorder and native terrain, reconstructs the early
graph, binds section IDs and returns a locally constructed internal
projection. No raw RunScene graph or config is present in the file.
There is no cryptographic authenticity claim. This candidate kind
is deliberately different from bb-savestate-cache; the production
layout declaration and registry remain inert until actual admission
and transaction review. There is no user-facing activation.

Local tests: 176/176 across 7 focused determinism suites; remainder
includes captured stock tick-936 state and synthetic effect/ward
variants. Native browser with all raw scene roots stripped: capture
481 and 936, residual 7550 and 9150 bytes, 537 exact subsequent
fingerprints, zero replay during restoration, identical terminal
records/tapes and no browser errors. Test also exercises late isolated
discard. Single-file QA additionally verifies independent disk transport
and strict preflight; a re-sealed clock-tick mismatch is rejected before
any candidate mutation. Existing independent terrain/strict compiled
Matter gates retained.

Important remaining scope: this is a local QA mechanism for completed
normal nonterminal ticks and exact matching config. Real live magnet,
Kodiak, non-stock biome/upgrade/ward and recovery combinations need
expanded browser proof, including derived presentation and Matter
configuration consistency; synthetic schema variants are not that
evidence. ASCII run ID and bounded wire size are explicit candidate
restrictions. The current shape/reference checks are not authorization
to load arbitrary external save files. Production registration, actual
scene lifecycle/side-effect isolation, single-use slot consumption,
Save/Resume UI and practice-only eligibility are outstanding.

Reproduce:
node tools/savestate-experiment/test-native-world-restore-browser.mjs --matter-section --entity-section --scene-subsystems --terrain-section --scene-remainder
node tools/savestate-experiment/test-candidate-file-browser.mjs

## Complete candidate-file proof

Final clean Chromium gate passed both boundaries:
- tick 481: 458306 bytes; 496/496 suffix fingerprints.
- tick 936: 513874 bytes; 41/41 suffix fingerprints.
Both recapture the **entire** canonical file byte-for-byte after
reconstruction, preserve original run identity and both native
aliases, execute zero simulation steps during restore, and finish
with exactly the same native fatal record/tape at tick 977.
24 malformed-file controls (12 per boundary, including re-sealed
cross-section errors) refuse during prepare with fresh scene signature
unchanged; one late isolated mismatch refuses restoration. Zero page
errors. The file includes the original native recorder prefix, clock,
RNG, all typed scene sections and checksum. No raw scene data crosses
from source to destination. Temporary files cleaned on exit.

The full-file recapture test exposed a derived telegraph color missing
from freshly materialized marks. Restore now regenerates the palette
key from mark state/kind exactly as the native planner does. No
serialized color authority; no change to gameplay physics.
