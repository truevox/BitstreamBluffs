# #119 — v2.25.12 combined dormant world-state section integration

**Provenance:** Gal Friday engineering integration under Marvin's standing
permission to advance P0. Owner policy remains full causal tick-zero
continuity for one-use local Suspend, tool-assisted repeatable checkpoints
unranked, and independent public verification (#135). The proposed order of
these three source sections is Friday coordination, not Marvin's new decision.

## Source and ownership
- Original draft #412 `e6eb2197`: typed Score/Trick/Glitch/BSOD/tutorial
  state. Original author branch remains unchanged.
- Original draft #415 `23a37188`: deterministic terrain/mesh recipe and
  regenerated geometry. Original author branch remains unchanged.
- Original draft #416 `ba6ac856`: sled/hazard/pickup/shard entity section.
  Original author branch remains unchanged.
- Merge into a fresh v2.25.11 `main` worktree non-force and retain original
  commits/attribution. Resolve shared CI/native browser harness additions
  inclusively, never by dropping one component's acceptance tests.
- Candidate v2.25.12 is **source-only**, not a registered complete-world
  serialization layout, not an active Save/Resume UI or public score proof.

## Required merge gates
1. Preserve all original unit and negative cases, strict typed schemas,
   unknown/duplicate/malformed state refusal and stable native references.
2. Real compiled Chromium independently exercises the terrain reconstruction
   and combined Matter+scene+entity sections at tick 481 and 936; zero replay
   ticks during restore and subsequent exact fingerprint/fatal tape parity.
3. Full determinism, native build identity, replay corpus, Heavy, Cemetery,
   Pages/PWA/offline, trust and lifecycle CI on the **combined exact head**
   must pass. No Netlify, secrets, keys, server launch or client data upload.
4. Dedicated browser gates may run separately to bound CI runtime; do not
   silently omit one. No PR release until complete current-head CI success.
5. Parent #119 stays OPEN for registry/layout, total-world atomic publish,
   one-use slot consume-after-success, player UI/reopen/device QA and exact
   official tape+eligibility verification.

[skip netlify]
