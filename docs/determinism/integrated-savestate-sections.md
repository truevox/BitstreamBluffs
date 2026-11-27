# #119 integrated typed section reconstruction (internal candidate)

Bundle exact draft source heads #412 e6eb2197, #415 23a37188, #416
ba6ac856 atop v2.25.11; retain all original schema and detached terrain
gates. Resolve overlapping browser and CI edits by combining them, not
discarding a test. The combined branch is intended to supersede those
individual drafts after release review; no separate duplicate merges.

The source now strips the diagnostic Matter, entity, score/trick/glitch/
BSOD/tutorial, SimClock, runRandom, terrain and chunk queue projections
before sending the candidate. Matter, entities, subsystems and terrain
are separately written/read through exclusive temporary files. Native
SimClock and runRandom projections are reconstructed from their typed
primitive states; terrain is independently regenerated from trusted
fresh-game options and the bounded native recipe, NOT the old raw terrain
graph. Recreate the leading internal graph IDs deterministically with
the fixed early-field order. Verify the source itself produces the same
leading projections. The collected pickup Set node must match the native
early projection's reserved node ID. No simulation ticks are executed
during restoration.

Section binding preflight rejects globally duplicate IDs/dangling aliases
and verifies queued/physical chunk roles, exact generated hazard and
ordinary pickup spawn aliases (not merely equal-looking data), matching
content definitions, sled RNG alias, entity Matter body keys, and
live shard IDs/positions (pulled shards retain their state). The special
magnet spawn still needs a full configuration-derived placement check.
The remaining graph is trusted internal QA data; these checks are not a
general untrusted snapshot validator or a guarantee of all causal state.

Real Chromium:
- tick 481: Matter 399357, entities 4252, subsystems 3713, terrain
  30093 bytes; 496 exact suffix fingerprints.
- tick 936: Matter 442998, entities 4532, subsystems 3704, terrain
  30189 bytes; 142 retired detector entries; 41 exact suffix fingerprints.
Both native fatal runs at 977 produce identical original tape/record;
no replay ticks during restore, exact Matter/subsystem/terrain byte
recapture and entity wire decode/re-encode, shared sled RNG/tutorial
aliases, 18 unchanged early refusal controls and isolated late discard,
zero page errors. These four files total 437415/481423 bytes respectively,
not the full final save size. The remaining internal graph plus recorder,
primitives, metadata etc is not included in those numbers.

The full production layout is NOT registered. Remaining explicit
scene timers/effects, safe sample/zone/telegraph/camera and configuration
schema, special spawn checks, complete graph relationship validation,
same-realm isolation, atomic slot transaction and player UI are still
required. No rank or trust is granted. Do not activate save/resume from
this test seam.

Reproduce:
node tools/savestate-experiment/test-native-world-restore-browser.mjs --matter-section --entity-section --scene-subsystems --terrain-section
npm test -- --runInBand tests/determinism/savestate-section-bindings.test.js
