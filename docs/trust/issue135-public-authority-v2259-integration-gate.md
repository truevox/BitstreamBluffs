# P0 #135 — server-held wallet and provisional submission integration

**Provenance:** Gal Friday engineering release plan; not a new owner decision.
**Source:** original draft #403 server-only PublicChallengeLedger and tests.
**Release target:** after the separately accepted #408 signed-admission source
is merged to main, preserving both author/source histories without force-push.

## Required invariants

- A modified local `bb.profile.bank`, claimed equipment receipt or client
  `verified`/paid-route flag must never authorize public gear or Verified rank.
- Only an authenticated SERVER adapter may create accounts, grant server Shards,
  issue challenge seeds/loadouts and authenticate consent/audience facts.
- Server catalogue determines actual purchases; stable ledger receipts are
  account-bound, collision/duplicate/double-spend safe in a transaction.
- Provisional user-visible submission is **UNVERIFIED only**. It must have no
  Verified rank eligibility or public reward until independent replay proof
  and authoritative entitlement pass, under reviewed end-to-end promotion.
- Free peer and optional paid hosted verifier verdict/rank/reward are identical;
  payment is for compute/service only. Source must not invent a paid privilege.
- Local/offline game remains unchanged; no auto-upload, account dependence,
  new public endpoint, live secrets, payment provider or real users.
- TTL, catalogue examples and business rules in the source are provisional
  engineering settings, not user-authorized final competition policy.

## Gate

- On exact v2.25.9 source, run 5/5 authority SQLite tests plus 11 signed
  admission tests, trust/dual-proof and current-replay deterministic suites.
- Add non-promotability cross-module regression when both libraries exist;
  never infer signed proof from provisional data or local currency.
- Run production Vite build, native source identity, and GitHub exact-head
  server/Heavy/Cemetery/replay/PWA/security CI. Avoid duplicate #403 merge.
- Keep parent #135 OPEN. No public upload or Verified promotion in this release.
