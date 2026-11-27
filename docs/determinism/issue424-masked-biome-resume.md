# #424 native biome mask preservation in one-use Suspend/Resume

## Production bug and scope

A stock, unmodified classic run can legally select an explicit
nonzero biome mask through Title.startRun(seed, maskOverride), including
a typed seed-mask sharecode. Its full candidate and GhostRecorder
preserve that original mask. However, the v2.25.31 player Resume
controller reconstructed the fresh scene using the CURRENT profile's
enabled biomes whenever the fresh Title registry seed differed from
the saved run. On a cold PWA reload the registry seed differs, and a
saved run with mask 3 is re-created with mask 0. The strict terrain
configuration witness correctly refuses the mismatch, but the player
cannot resume an otherwise valid one-use stock save.

Real production-minified v2.25.31 failure was reproduced: source
Suspend succeeded with nonzero mask, Title showed a READY save,
but physical cold offline Resume never published RunScene.

## Reviewed correction

On explicit Resume, read the original biome mask from the recorded
native GhostRecorder section inside the single-use candidate file.
This is an exact uint32 and the recorder header seed must agree with
the candidate header seed. The pre-existing native recorder decoder,
terrain regeneration and hashed CONFIG witness independently validate
the complete saved world before stage activation. If the recorder
mask is forged/incoherent, strict restore rejects it, discards the
private stage and releases the READY claim; no gameplay or public
Verified authority is minted by client bytes.

The source mask always takes precedence over current profile, title
registry and later unlock changes. If other current profile settings
make the exact world impossible to reconstruct, the full codec still
refuses the restore without consuming the one-use slot. The change
DOES NOT enable modified/boosted/upgraded, magnet, Kodiak, Daily or
gym saves and does not provide an old-build migration.

The code change carries v2.25.32 so older v2.25.31 exact-build saves
remain incompatible and preserved, not silently relabeled. This is
a runtime reconstruction fix, not a SIM_REVISION change.

## Local browser evidence

Full real production-minified v2.25.32 Pages offline PWA, controlled
by its content-hashed service worker. The player physically clicks
Pause SUSPEND RUN, original source page closes, the whole context
goes offline, a NEW cached Title physically clicks R RESUME SAVE,
the original run ID and tick are verified on the resumed RUN_START,
source biome mask must match, local slot is consumed exactly once,
a separate offline Title finds it empty. Local PASS:
- mask 3: tick 184, saved 260680 bytes, resumed RUN_START at tick 184.
- mask 1: tick 182, saved 261476 bytes, resumed RUN_START at tick 182.
- Both had zero browser errors or outbound mutating requests.
- All external music catalog requests were blocked in synthetic QA.

Real opt-in upgrade mode (purchased speed rank 1, enabled), tested on
the compiled game, is conservatively refused: no SUSPEND RUN row,
source still manually paused and resumable, no phantom slot.
Additional magnet and Kodiak denials are exercised in the same
exact-head workflow.

Focused tests validate 0,1,3, high unsigned masks, invalid numbers,
negative zero, missing/wrong-seed recorder and unsupported UI.
Broader native upgrade/bear/hazard restore requires separate reviewed
schema and live-browser parity proof before changing conservative
policy; this PR deliberately keeps those modes unsupported.

Reproduce:

    node tools/pwa/build-pages-site.mjs / dist-biome-qa
    node tools/savestate-experiment/test-player-suspend-biome-compiled-browser.mjs dist-biome-qa --mask=1
    node tools/savestate-experiment/test-player-suspend-biome-compiled-browser.mjs dist-biome-qa --mask=3
    node tools/savestate-experiment/test-player-suspend-biome-compiled-browser.mjs dist-biome-qa --deny=upgrade
