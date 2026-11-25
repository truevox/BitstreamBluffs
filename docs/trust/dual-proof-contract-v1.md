# Dual-proof public eligibility contract — draft v1 (#245)

**Not yet active or wired to public leaderboards.** This module is a pure, transport-independent decision library. It has no keys, server, wallet API, persistence, network or public publication. Offline/local modes remain playable and local ranking is untouched.

## Trust boundary

A result tagged `trusted` in JSON **is not itself authenticated**. No caller of this pure JS library can independently establish provenance by setting `kind`, `issuer`, `challengeId`, `digest` or `signature` fields. A future server must authenticate its own verifier execution, issued challenge (nonce, expiry, replay protection), entitlement/economy receipts, privacy consent, and audience eligibility **before** passing them as separate `simulation`, `authorization` and `consent` inputs. NEVER derive these from a client request or let a browser call alone award public ranks.

Client `request` cannot carry wallet balance, shard ownership, receipts, equipment grants, a trusted verdict, or a `verified` flag. A bundle hash is an integrity fingerprint only, not proof of ownership, humanity or real gameplay.

This module checks strict field sets, lane consistency, cross-input identity and matching replay outcome; it is not a verifier. Trusted infrastructure is currently unimplemented. All platform/network integration MUST remain disabled until separately authorized by the owner.

## Next

Explicit tests must exercise forged balances, missing tapes, mismatched builds, stale challenges, denials and unverified provisional publication. The score and rewards are never taken from a client-supplied wallet. Future paid and free verifier routes must reuse this identical adjudication function and conformance corpus; fees buy faster service, not better verdicts.
