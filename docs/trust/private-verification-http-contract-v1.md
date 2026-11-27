# #135 private verification HTTP adapter — source-only contract v1

This **is not a hosted service**, a finished account provider, or a switch
that turns on public Verified rankings. The exported
`createPrivateVerificationHttpHandler` is only a Node HTTP request handler:
**it creates no listener, binds no port, reads no credentials, issues no signer
receipts and deploys nothing**. It may be mounted behind an explicitly
configured HTTPS gateway *after* account, consent, resource and privacy policy
are ready. Do not attach an unreviewed public address to a test fixture.

The adapter connects the same canonical SQLite-backed #135 peer coordinator
and #413 provisional ledger. There are no wallet/reward/payment/Verified
endpoints. It cannot create a Verified receipt, publicly identify a verifier,
promote a peer consensus to trusted authority, or import local Shards.

## Authentication and trust split

Every private operation requires exactly one `Authorization: Bearer <token>`
header. A **trusted host-injected** `verifyBearer(token)` callback must verify
session signature, issuer, audience, expiry, revocation and user identity,
returning exactly `{verified:true,accountId:<stable authenticated ID>}`.
Missing, duplicate, malformed, revoked and invalid tokens are refused; cookies
or request body `accountId` are never login evidence.

Challenge creation is disabled unless the host injects
`issueTrustedChallenge({accountId,kind})`. That callback, NOT the request,
must choose and freeze the account-owned loadout, legal course, run seed,
ruleset/verifier build and challenge. The client only indicates Human or TAS
intent. The internal challenge ledger enforces the account owner and frozen
gear when the run is submitted.

Publishing is disabled unless the host injects
`authorizePublication({accountId,requestBytes})` and returns EXACTLY
`{consentAuthorized:true,audienceAllowed:true}` derived from its own trusted,
account-bound consent and audience records. The client cannot set either
flag. Published outcomes remain **UNVERIFIED ONLY**, and only after successful
creator-local qualification; peer match alone never publishes.

`deviceReady:true` merely asks the host to schedule background work; it is
NOT a capability attestation. The coordinator additionally requires the
requesting account to have its own in-progress opted-in final replay and
enforces distinct leased worker assignments.

## Wire protocol

Methods are all POST on `/v1/private/*`. Body is strict BB canonical JSON
(`Content-Type: application/vnd.bsb.v1+cjson`), at most 2 MiB before
parsing. All binary fields are canonical, unpadded base64url, with smaller
32-KiB caps for observed-state reports. Incoming objects must have exactly
the listed keys:

| Path | Exact request keys | Result |
|---|---|---|
| `challenge` | `kind` = `human` or `tas` | opaque server-issued `challengeId` |
| `begin` | `board`, `challengeId`, `evidenceB64`, `optedIn:true` | account-owned private submission ID |
| `local` | `submissionId`, `reportB64` | local pass/fail; never Verified |
| `status` | `submissionId` | private owner-only status |
| `peer/claim` | `deviceReady:true` | server-selected opaque lease and replay evidence |
| `peer/complete` | `assignmentId`, `leaseToken`, `reportB64` | one-use lease completion |
| `publish` | `requestB64` | UNVERIFIED provisional publication, only if trusted consent/audience and local clear pass |

The exact URI prefix is `/v1/private/` for every row. `reportB64` is the
existing canonical `{evidenceDigest,observation}` object. Peer claims return
only `id`, `kind`, `board`, `rulesetId`, `verifierBuildId`, `expiresAt`,
`leaseToken` and `evidenceB64`; **no creator/verifier account IDs, HMAC
tags or candidate list**. Recipients can inspect copied evidence bytes:
this is assignment anonymity, **not replay-content secrecy**.

The adapter refuses unknown paths, non-POST operations (except explicit
allowlisted CORS OPTIONS preflight), encoded/compressed
bodies, malformed or noncanonical JSON, added fields and noncanonical
base64url. Errors contain stable categories, never bearer tokens. Every
response is `Cache-Control: no-store`. CORS origins default to **none**;
the host may supply a short explicit HTTPS origin allowlist. No credentials
are sent with CORS, no wildcard origin is supported.

A bounded per-authenticated-account fixed 60-second request counter
(default 60/minute, maximum 4096 simultaneous identities in memory) limits
accidental or scripted spikes. This is NOT a distributed or anonymous-IP
abuse defense, nor is it persistent across process restarts. The eventual
reverse proxy must impose independent network/IP/account admission limits,
request timeouts, per-device compute budgets, authenticated privacy/consent,
and auditable account suspension.

## Explicit exclusions and rollout blockers

- No listener or default command: importing the adapter cannot open a socket.
  In-process tests create a loopback-only listener and synthetic in-memory
  tokens; **these are not production credentials**.
- No verified identity of the physical controller/browser or original author.
  Replay evidence can be copied between accounts. This remains a **public
  fraud/reward blocker** until a separately approved pre-run account-origin
  witness/duplicate-run policy exists.
- No trusted sandboxed server simulation or real cryptographically signed
  issuer execution. Even two matching browser reports can be forged.
- No real external OAuth/OIDC, passkeys or school account system; no hosted
  user database, consent persistence/revocation audit, moderation, appeals,
  payment integration or live privacy notice.
- No actual public Human/TAS board, public GET listing, Verified rank or
  Shards settlement. Paid and free validation must eventually share exactly
  the same validity/eligibility/reward engine; paid convenience must not
  change judgment.
- Security review is required before a publicly addressable service or
  reward authority is enabled. A passing mock-auth integration suite does
  not certify real account security.

## QA

`node --test server/trust/privateVerificationHttp.test.mjs` runs **real
loopback HTTP requests** through source ledgers and real-format saved replay
evidence. It covers unauthorized/foreign account requests, duplicate
credentials, malformed bytes, CORS, size/rate limits, trusted policy
unavailability, and actual submit→2-peer→local→UNVERIFIED flow with zero
Verified admissions/rewards. The existing three independent real Chromium
contexts test remains the execution oracle; the HTTP test uses that
known-good observation fixture rather than pretending to attest client code.

Owner policy provenance: [[projects/truevox-bitstreambluffs/evolution-mode/peer-verification]]
and [[projects/truevox-bitstreambluffs/evolution-mode/public-competition-integrity]].
The HTTP adapter/limits are Friday engineering choices, not new owner-approved
service or privacy policy. Parent issue #135 remains OPEN.
