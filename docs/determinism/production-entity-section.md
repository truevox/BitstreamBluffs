# #119: typed entity projection section

Sled, hazards, pickups, shard field and collected pickup keys have explicit
V1 field/type inventories. Canonical finite F64, signed zero, one declared
positive infinity sentinel (ballistic ETA), exact class tags regenerated
locally and bounded graph IDs/collections. Fixed scene/world/presentation
markers, stable body identities, typed hazard motion, shard/pickup IDs and
the shared native RNG alias. Unknown fields, unsafe content paths, invalid
references and impossible scalar values refuse. No generic constructor
selection in stored bytes. No runtime trust, rank or persistent-layout
registration.

The wire still preserves the internal diagnostic graph numbering.
External hazard/pickup spawn aliases MUST be checked against the eventual
regenerated terrain section and all cross-section IDs before any
untrusted persistent save can be admitted. The current implementation
does not authorize arbitrary decoded object attachment or independently
validate every physical value against the generated course. The UI and
atomic slot are not connected. It admits completed, nonterminal stock
entity projections; unsupported entity or presentation inventory changes
fail closed.

Local evidence: 34/34 focused Jest tests using the real stock sim-05@0
tick-936 entity projection captured from the running browser. Additional
synthetic variants of that projection exercise nonempty ordinary/magnet
pickup records, held airbrake, moving hazard and pulled/collected shards;
these are NOT evidence that stock sim-05 spawned those features.
Real source-game Chromium combined Matter + entities disk transport
at ticks 481 and 936: 4252 and 4532 entity bytes, exact projection
decode/re-encode, 496 + 41 exact suffix fingerprints, zero simulation
during reconstruction, preserved shared sled/RNG reference, identical
native terminal record and tape at tick 977. The stock browser proof
does not have nonempty pickups. Existing 18 early refusal controls and
late isolated discard remain. Raw selected projections are removed before
destination receives the two files. The rest of the scene is still the
internal trusted QA graph; no full persistence proof yet.

Reproduce:
npm test -- --runInBand tests/determinism/savestate-entity-state.test.js
node tools/savestate-experiment/test-native-world-restore-browser.mjs --matter-section --entity-section
