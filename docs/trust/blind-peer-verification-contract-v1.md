# #135 — player-initiated blind peer verification (private reference)

This is a server-only reference. There is no public HTTP endpoint, network
service, signup flow, leaderboard, payment route, or signed verifier issuer.

## Owner decisions, November 26 2026

Verification happens only after a player's explicit request. Their final local
check functions like the creator-clear gate in Mario Maker. The run is held
PRIVATELY while local qualification and independently assigned remote checks
happen concurrently. A local failure blocks public publication even when
peers agree. Passing local makes the run eligible for visibly UNVERIFIED
provisional publication, never an automatic Verified ranking.

At least two other distinct players receive random automatic verification
work while their own final local checks run. Players do not choose which runs
they verify or see the usual verifier-to-run mapping. Number and concurrency
must be tuned to device capacity. The server must never use peers to prove an
identity, and clients may inspect replay data: no impossible secrecy promise.

There will be separate HUMAN and TAS boards. Suspicious Human-vs-TAS claims
may be evaluated with peer review, not treated as definitively machine-detected.
Additional tracks may be useful when the same frozen brain/controller can be
reexecuted on server-selected tracks. Those are separate performance tests,
NOT substitutes for exact-run verification; replaying a single input tape on
a different track is not equivalent. Details of review, moderation, TAS policy
and cross-track ABI remain future design work.

The optional paid compute route must confer EXACTLY the same status, verdict,
eligibility and reward as free blind peers, offering convenience only.

## Implemented as private queue reference

The trusted server supplies authenticated account identity, challenge,
frozen authoritative equipment, pinned ruleset/executable, canonical evidence
and explicit opt-in. Human and TAS private submissions are different boards.
TAS challenges are server-issued and cannot be silently accepted through the
existing human-only dual-proof public admission policy.

The coordinator persists a private pending run, gives automatically selected
other self-checking players opaque exact-run work and binds each assignment to
a leased account-specific server-private HMAC tag. No browser response includes
the owner's account, verifier pseudonym or list of other candidates. It returns
replay evidence to execute (which is inspectable by a sophisticated browser
user), a short opaque task token and a pinned build ID. Two or more workers can
be assigned concurrently, with server-configured 2–4 target and per-device
1–2 simultaneous-job limits. Worker readiness can suppress costly background
jobs.
The assignment RNG selects over the ENTIRE current eligible queue, not merely
the oldest 32 entries. Count and indexed offset are read inside the same SQLite
BEGIN IMMEDIATE transaction. Fixed-size 256-bit lease tokens are bounded and
validated on submission. A >32-request fixture specifically prevents the old
silent selection bias from returning. A per-account unique causal replay digest
prevents the same run from being republished with a different challenge ID or
cosmetic manifest metadata; another legitimate account may still submit an
identical causal run. These are pre-alpha anti-spam constraints, not yet a
full fairness scheduler, account anti-Sybil guarantee or final policy. Expiry and restart cannot let one identity endlessly reroll the same
submission.

Both creator and peer return a canonical *observed* simulation state. The
coordinator compares it to the pinned evidence. Bare match votes, wrong
evidence and mismatched verifier pins fail closed. Client observations remain
UNTRUSTED even when they match, because browser software can fabricate them.
A match by local creator only permits Unverified provisional eligibility.
Matching peers create a private consensus CANDIDATE. A mismatching peer flags
dispute and never silently reclassifies a Human entry as TAS. Neither status
becomes public Verified and neither awards server Shards without a trusted
independent validation layer and signed authority.

The current private reference is normal single-run replay only; it does not
perform cross-track verification or isolate a real player-supplied model. It
does not publish even Unverified entries to a live board. There is no real
account adapter, verifier issuer, hosted compute, rate/abuse protection, durable
private evidence archive, public result lifecycle, paid route, online reward,
appeals process or owner-approved final quorum.

## Tests

Run node --test server/trust/blindPeerCoordinator.test.mjs. Tests use
scripted real-format evidence and real calculated replay observations from a
compiled Chromium game. They cover 2- and 3-verifier workloads, local-failure
publication gate, random assignment without user choice, HMAC/private leases,
expired jobs, challenge ownership, frozen equipment, Human/TAS separation,
tampered reports and zero trusted public admissions or reward grants. The
fixtures do not establish human input or trust in arbitrary peer browsers.

#135 remains OPEN. No client gameplay or public trust services changed.
