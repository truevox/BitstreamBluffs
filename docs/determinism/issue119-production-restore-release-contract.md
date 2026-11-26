# #119 — Production-grade authoritative RunScene restore (after v2.25.3)

**Status: engineering design, NOT a claim that production restore exists.**

## Owner-established requirements / source policy

- Complete captured Matter world, contact/Verlet caches, ordered generator and hazard state, RNG, cause/timer state and uninterrupted GhostRecorder prefix from tick zero. Fail closed on unknown fields, invalid identity/registered layout, inconsistent input tape, orphaned contact pairs, partial frame or snapshot audit. A fresh restore must be tick-identical to uninterrupted simulation on contact/hazard/natural fixtures; no replay shortcut may masquerade as a genuine full snapshot.
- User-facing **Suspend** is single-use, saved locally and consumed only after a verified fresh restore; owner policy permits ranked continuation only when full exact tape from tick zero is maintained and can be independently replay-verified. A repeatable Heavy/practice checkpoint is unranked. No browser-backed state alone can certify a public leaderboard; #135 verifier owns that distinction.
- Preserve existing offline play, explicit pause controls and the full five-ghost/independent-protected-evidence rules. No automatic uploads, no public wallet trust, no changes to SIM9 physics or paid/free verification parity.

## Friday implementation gate

1. Lift the *experiment-only* V3 Matter and RunScene state kits into an importable, audited runtime module **without reducing schema checks**. The v2.25.3 `LocalSuspendSlot` remains inert until a real registered production layout and recorder continuation pass. Avoid global or implicit code injection into the shipped game.
2. Capture only when a **normal, non-guest, non-gym, non-takeover, non-coach RunScene** is paused at a completed fixed tick. Capture includes the exact frozen run configuration, all causal state, body identity/order, telegraph state, and complete recorder prefix. Zero noncanonical/unknown fields; exact sim revision and build identity; bounded local storage. Corrupt/quota data must preserve the unsaved live run with a visible error.
3. Restore into a **new** fully initialized RunScene on the exact build. Validate everything *before* mutating it. On any failure, terminate only the throwaway scene, show reason, and preserve a recoverable token/slot when safe; do not resume ranked or credit rewards.
4. After successful restore, compare authoritative fingerprints at tick N and a checkable exact prefix, complete the slot's single-use consume, then accept live inputs. Player UI must not advertise save/resume until the full browser gates pass. A paid/public verifier still ignores local 'trusted' flags.
5. Chromium QA must include 300/300 contact, 280/280 hazard, long natural contact, double-tab claim race, stale build/layout, altered payload, interrupted save, quota, held keys and no double reward; real PWA reopen, storage and postmerge deployment.

**Release sequencing:** v2.25.3 shipped an inert single-use slot; real restore is a new versioned PR after this gate. This contract author is Gal Friday, not a claim of prior detailed implementation approval. Parent #119 stays OPEN until all acceptance steps are met.

## Implementation checkpoint (2026-11-25 ET, source-only)

The first importable runtime module lives at `src/systems/savestate/RunSceneRestoreKit.js`: an explicit Phaser/Matter dependency-injected port of the full source-tested V3 diagnostic mechanism, with no automatic global hook. `createRunSceneRestoreKit` exposes **only** strict full snapshot and fresh normal-run restore; it explicitly refuses Guest/Gym/Takeover/Coach/ended runs and refuses incomplete Matter audit or missing recorder. The separate `createDiagnosticRunSceneRestoreKit` exists only for test parity and never authorizes rewards. The original experiment implementation remains independently available in `tools/savestate-experiment/game-state-kit.js`.

A new `--runtime-module` flag in the existing real Chromium harness exercises the exported module on genuine contact and hazard fixtures with strict negative controls and exact recorder suffix comparisons; `.github/workflows/runscene-restore-runtime-qa.yml` gates the full 300-contact / 280-hazard fixture before any merge. The first unrestricted module version completed both real browser cases with zero divergence. The later strict operational wrapper passed the contact run locally, but a concurrent CT223 resource interruption prevented a final local hazard completion—**do not count it as a pass until exact-head GitHub CI is green**.

This checkpoint still emits a diagnostic structure, **not** a registered client serialisation layout. It has no wired RunScene UI, no durable slot claim integration, no validated fresh-world handoff, and no authority to mark a run ranked. Parent #119 MUST remain OPEN. No user-visible gameplay or public verifier change is shipped by this draft.
