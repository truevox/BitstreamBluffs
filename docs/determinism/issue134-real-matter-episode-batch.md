# #134 real Matter episode batching — isolated QA bridge

The real `RunScene`/Matter 0.20 Worker from #491 can now execute independent
indexed episodes through #134's `runEpisodeBatch` scheduling contract. The
`qa-real-physics-batch.mjs` wrapper uses #453's actual admission policy with
caller-supplied slot authorization, active count, Ride activity, visibility and
hardware hints. Workers receive independent index-derived seeded runs; result
ordering is by **input index**, irrespective of completion order. Chromium
QA compares four real-physics worker episodes at one and two authorized lanes
against one another and the same `runPhysicsEpisode` on the browser main
thread. It checks full tick/crash/score/distance/fingerprint/recorder results,
not just scalar scores. Ride-active and hidden-tab requests start no workers.
An injected stalled worker is cancelled and terminated; a failed constructor
returns no partial trainable result. Each episode worker is terminated after
its result, failure or cancellation. CI compiles the real physics code into
module Workers and runs the test in actual Chromium against a fixed source.

This intentionally creates one fresh Worker **per episode**. That is a QA
execution bridge, not an optimized production pool. It has not been wired to
the existing app's #453 per-tab reservation manager, the Ride-start listener,
real Web/Lab UI, actual brain/training APIs or paid slot authorization. The
admission arguments in the test are synthetic known inputs, not a claim that
player entitlements have been integrated. Multi-batch/cross-tab concurrency,
300-second in-worker physics, physical Chromebook battery/CPU/memory and
full biome/collision coverage remain open. AI learning from these short QA
runs remains prohibited. No game scoring, money, Verified status, replay
revision or save format is touched.
