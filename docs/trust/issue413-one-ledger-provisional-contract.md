# #413 — UNVERIFIED provisional submission using the canonical server wallet

**Authorship:** Gal Friday engineering plan, implementing Marvin's existing
public-competition-integrity and peer-verification requirements. This is not
a decision from Marvin about server rollout, prices, TTL or reward rates.
**Prerequisite:** #411 one canonical `publicWallet`/signed admission source;
#410's separate wallet and challenge tables must **NOT** ship as another bank.

## Superseding owner clarification — 2026-11-26

Marvin clarified that a player's FINAL local check is a Mario Maker-style
qualification gate: uploading a publicly visible Unverified result is forbidden
until that exact run has passed its local replay. Peers may work concurrently
in the background while the local check runs; their results do not override a
failed creator check. A private server-submitted pending record is not a
public result.

The one-ledger provisional adapter now *requires* a qualified,
account-owned private submission for the same challenge and a complete,
matching canonical evidence bundle. It rechecks score, terminal tick, seed,
ruleset, exact manifest/tape identity and frozen gear before any Unverified
public record is admitted. Its server received timestamp is the ORIGINAL
opt-in request time, not when a verifier finishes, so a timely request is not
disqualified merely because local/peer computation ran past the challenge
issuance deadline. All Verified-only rank/reward constraints remain zero.

The private blind coordinator recognizes separate Human and TAS queues. The
existing pure dual-proof public admission is still human-only, and this
provisional adapter must not accept a TAS challenge as Human. Additional-track
evaluation requires frozen replayable controller provenance and is NOT
conflated with exact-run replay. The public network service and actual
frontend flow are still absent. Keep #135 OPEN.

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
