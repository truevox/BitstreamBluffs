# #134 — bounded deterministic Lab episode scheduler (foundation only)

This is a *tools-only* pure-JavaScript dispatch contract. `tools/lab/episode-batch.mjs`
uses the existing `Rng` seed-fork contract for per-index uint32 episode
seeds. Every episode callback receives a frozen `{index, seed, signal}`;
the callback must use that seed rather than a shared, mutable PRNG. Results
are published only after the whole batch succeeds, always indexed in input
order even when asynchronous jobs finish in any order. In-flight callbacks
are allowed to finish on cooperative cancellation, but the caller receives
only `{ok:false,code:'aborted'}` with no partial results. An episode failure
similarly refuses a partial trainable batch. `concurrency` is explicitly
bounded 1..32; the caller/governor decides the current slot entitlement and
memory budget, with the owner-planned base platforms being web 1 and Steam 3.

The contract does not call Date, `Math.random`, a presentation function,
score/Verified/Shard awarding or persistent storage. It has an ABI version 1;
it MUST NOT become a source of ranked human runs.

Local six-test suite includes a golden deterministic pseudo-training result
with delayed, differently ordered callback completions and concurrency counts
1/2/3/7/16; refusal on invalid requests; independent seeding; controlled
cancellation; no partial results after errors. GitHub exact-head CI runs
this test in addition to checking current game source identity.

**P0 still open.** There is no browser Worker adapter, SimWorld episode
callback, actual policy training, chunked/cancelled worker-life-cycle,
shutdown under tab suspension, throughput/memory/responsiveness data, or
Chromebook verification here. An accelerated trainer may NOT run against
uncertified #122 simulation states. Remote workers #428 stay separately P2.
