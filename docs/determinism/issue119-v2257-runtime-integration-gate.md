# P0 #119 — v2.25.7 strict RunScene restoration integration gate

**Provenance:** Gal Friday engineering recommendation implementing Marvin's existing
go-ahead for trusted savestate development, not a new Marvin decision.
**Source:** draft #404 full-Matter/recorder runtime restoration, originally tested
against v2.25.3; current released baseline v2.25.6 (#400 RNG/clock, #405 recorder).
**Scope:** code-only importable runtime mechanism; no player Save/Resume button.

## No false completeness

- Preserve #404 source history and original PR. Restack by non-force integration.
- Reject guest, gym, replay, takeover, coach, crashed and unranked captures.
- Require complete recorded tick-zero history, strict Matter V3 world/contact
  reconstruction, and exact current-build refusal on later serialized formats.
- Only restore into disposable fresh tick-zero normal scenes; a failed restore
  must never be exposed, published, scored or used as authority.
- No production layout registration, IDB claim/consume, leaderboard, Shards,
  upload, consent or server endpoints in this release.
- Keep #119 OPEN; #135 remains independent.

## Release gates

1. 30+ targeted runtime/slot/envelope tests and source identity on exact SHA.
2. Real compiled Chromium full-Matter/recorder strict contact and hazard suffix
   equivalence including negative controls, not an experimental-only claim.
3. Replay evidence, Cemetery, Heavy, PWA/offline, identity and lifecycle CI green.
4. Independent source findings reviewed; do not claim a reviewer approval that
   did not occur. No deployment assertion until the postmerge Pages run passes.
5. Original #404 remains draft or superseded; never merge both it and this PR.
