# #413 — UNVERIFIED provisional submission using the canonical server wallet

**Authorship:** Gal Friday engineering plan, implementing Marvin's existing
public-competition-integrity and peer-verification requirements. This is not
a decision from Marvin about server rollout, prices, TTL or reward rates.
**Prerequisite:** #411 one canonical `publicWallet`/signed admission source;
#410's separate wallet and challenge tables must **NOT** ship as another bank.

## Source-only implementation boundary

- A trusted server adapter authenticates account, consent and audience.
- Only canonical `provisional-public` request bytes are received; all
  course/build/ruleset/seed/lane/loadout claims must equal a fresh challenge
  issued by the *existing* `openAdmissionLedger`. Enforce challenge account
  ownership, server expiry, and the server-pinned equipment digest.
- Persist a single private `UNVERIFIED` submission per server challenge, in
  an atomic SQLite transaction, timestamped by a **server** clock.
- SQL constraints forbid Verified status, Verified-only rank and reward.
  Public read projection omits account, tape/manifest digests and verifier
  identifiers. No hidden peer/identity mapping is exposed.
- Do not introduce a new server wallet, purchase flow, client balance
  acceptance, issuer, network endpoint, upload, peer scheduler or payout.
- No automatic promotion into signed admission. That later transition
  requires independent replay, consent, entitlement and vetted settlement.

## Release checks

1. Positive normal stock submit, public-safe UNVERIFIED projection.
2. Forged local-billion-Shard, paid or Verified flags; foreign account,
   expired challenge, mismatched pinned course/gear, duplicate and hostile
   bytes must not mutate public or signed admission.
3. Two independent SQLite connections and restart cannot publish twice.
4. No Shard/rank mutation; no automatic signed Verified admission; preserve
   offline-only browser behavior and existing strict free/paid policy.
5. All exact-head GitHub trust, identity, Chromium replay, Heavy, Cemetery,
   Pages/PWA, and native source tests pass before source merge.
6. Production database migration, actual service/user consent, signer,
   evidence retention, peer assignment and payout are explicitly excluded.
   #135 remains OPEN and no unapproved policy defaults are silently frozen.

[skip netlify]
