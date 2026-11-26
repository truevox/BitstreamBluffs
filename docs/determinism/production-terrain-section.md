# #119: native terrain recipe section (candidate)

Geometry is deterministic, so persist a bounded recipe rather than
arbitrary collider/terrain coordinates. The application-owned native
TerrainGenerator inventory is explicit. Bind the recipe to build,
original run and completed tick, and compare SHA-256 witnesses of
trusted configuration, generated bounds and each generated chunk
against an independently rebuilt native generator. Hash witnesses
encode numeric binary64 bits (including signed zero), ordered
arrays/Sets and tagged records. They are not signatures or proof
that an original run occurred.

Store object slots and their ordered roles: active list, pool,
pending release, pending added, scratch/temp/last, queued chunks and
mesh order. Preserve actual aliases and distinct objects that happen
to have the same chunk index. Preserve RNG, diagnostic counters and
all six Float64 scratch arrays in canonical F64. The source capture
does not call getChunk or advance generation; restoration constructs
a detached generator from caller-owned options, not from wire-supplied
content. Unknown fields, wrong build/config, invalid role references,
foreign geometry and oversized generation requests refuse.

Conservative candidate limits: 1024 bounds, 128 distinct chunk
objects, 8192 values per scratch array, six pooled chunks, normal
canonical byte limit. Beyond those limits capture/restore refuses.
These are implementation limits selected for bounded reconstruction,
not a claim that every playable course fits. No production layout
registration or player storage action.

## Local verification

24/24 tests in savestate-terrain-state.test.js: native pool/queue
alias identity, exact byte recapture, four biome masks (0, 1, 3,
all bits), identical streaming and cache behavior over a continued
16km-pixel interval, malformed state/witness controls, signed zero
and subnormal scratch. Geometry edited in the source cannot pass
independent regeneration. The Jest content loader produces genuine
cross-realm arrays; trusted witness hashing accepts those after
descriptor validation, while serialized array admission stays strict.

Real source-game Chromium file transport:
`node tools/savestate-experiment/test-native-terrain-browser.mjs`.
Capture native RunScene at 481 (30093 bytes) and 936 (30189 bytes;
one pending release). Separate fresh browser context reconstructs
a detached native generator from the saved file and trusted native
options. Both recapture exact bytes, preserve aliases and match 20
subsequent streaming/query batches per boundary, including far
ahead/behind probes; zero browser errors. Destination live generator
and tick zero are unchanged. This test exercises terrain only,
not a full persisted-world restore or a ranked result.

Remaining integration: entity/hazard/pickup/shard spawn and zone
references must be rebound to reconstructed chunk records, Matter
configuration/topology checked, and every section admitted by one
registered layout before the atomic slot and UI can be connected.
Do not swap a detached generator into a live scene with stale
aliases. Existing full-world and Matter tests remain in force.
