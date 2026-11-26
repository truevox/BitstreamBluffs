# P0 #135 — v2.25.10 exact evidence-bound, server-authoritative signed admission

**Provenance:** Gal Friday integration/release proposal, not an additional
Marvin policy decision. v2.25.9 is occupied by the shipped #119 Matter section;
this security reference follows in v2.25.10. Source is the new #406 author commits 17a9a62c and
ce2c67ba, added AFTER original #406 head 62218063 was released in #408.
Preserve authorship via non-force, original commits; no duplicate merge.

## Authoritative security contract

- Use exactly one canonical server Shard/gear authority for Verified
  competition: the admission-bound signed-settlement publicWallet reference.
  The separate #403 PublicChallengeLedger wallet source is held draft until
  its provisional flow is made compatible without an independent balance.
- Freeze complete effective permitted equipment at server challenge issue;
  reject local wallet/gear claims, unowned ranks, boost/modifier forgery and
  unsupported modes. Never treat a client verified flag as proof.
- Require a trusted pinned ruleset, separately authenticated account,
  independently replayed exact evidence bundle, and role-separated signatures
  binding the SAME canonical evidence digest plus claim/account/challenge.
- Pay no Shards unless admission already succeeded and independent trusted
  reward signer approved run, account, claim and amount. Idempotent exact
  settlement and purchase operations; serializable SQLite concurrency.
- Synthetic/unbound QA claims must never be accepted by a production adapter;
  keep their test-only scope explicit and disabled by default.
- Free peer and paid hosted verification stay identical on validity, rank,
  rewards and eligibility; no active peer scheduler or paid advantage.
- Never activate a public HTTP endpoint, real keys, accounts, upload or payouts.

## Release gates

- 15+ native Node22 SQLite/Ed25519 role, nonce, wallet, equipment/evidence
  identity and forged local bank tests; exact build identity and production
  bundle isolation; real compiled browser checkpoint/terminal proof.
- New adversarial fixture: tampering one evidence checkpoint without altering
  manifest/tape must refuse, including otherwise valid old issuer signatures.
- Exact-head GitHub trust, replay, Heavy, Cemetery and Pages/PWA workflows
  GREEN; independent reviewer findings addressed or recorded as unmet.
- Source release only. Parent #135 remains OPEN; no deployed public verifier.
