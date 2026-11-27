# #424 — real Chromium closed-page single-use Resume proof

This is a **diagnostic test of the source-only bridge**, not a player's
Save/Resume UI and not proof that a score is human or Verified.

The `--suspend-reopen` browser gate exercises the existing local slot:
- At native capture tick 481 or 936, encode the complete exact-build,
  eight-section candidate into a canonical `bb-savestate-cache`
  single-use Suspend envelope, then persist its bytes in actual IndexedDB.
- **Close the original destination page** before claiming anything, leave
  its storage partition intact, and open a newly booted game page with
  a clean tick-zero native RunScene.
- Claim with the exact running build descriptor and registered layout;
  a second claimant is denied `slot-claimed`. Inspect the original nested
  candidate only as **envelope-only**; its checksum is not player proof.
- Restore the already-reviewed fresh internal candidate into this test
  scene, requiring zero simulated restore ticks and exact file recapture.
  Only after observed successful restore is the claim token consumed.
  A subsequent claim returns `empty`, so the slot is not rewindable.
- Both runs preserve 496+41 = **537/537** later fingerprints, the
  exact native fatal tick 977, full GhostTape and RunRecord, and zero
  browser errors; a separate late-discard negative remains covered.

This does **not** yet test the actual in-game player UI, lifecycle
handoff into an isolated replacement Phaser scene, a service worker
update during resume, power loss/crash claim recovery, nor physical
Chromebook or modified/upgraded run eligibility. Those remain in
[#424](https://github.com/truevox/BitstreamBluffs/issues/424).
Do not introduce a second suspend database, auto-upload, or attach
Verified rank/reward status to local bytes.

**Provenance:** Gal Friday generated the new browser fixture on a
separate branch after local v2.25.20 format acceptance. Marvin's
single-use vs repeatable practice and independent-public-verification
choices are distinct owner-established policy; this test is engineering
evidence only. [skip netlify]
