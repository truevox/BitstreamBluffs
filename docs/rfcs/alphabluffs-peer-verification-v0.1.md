# AlphaBluffs — blind reciprocal public verification, RFC v0.1

**Status:** OWNER DESIGN DIRECTION + Friday technical proposals. Future PUBLIC leaderboard architecture, **NOT** a launch public backend. Canonical GBrain: projects/truevox-bitstreambluffs/evolution-mode/peer-verification. Parent [AlphaBluffs v0.2 contract](./alphabluffs-v0.2-contract.md), [acceptance matrix](./alphabluffs-v0.2-acceptance.md), issue #48.

## 1. Settled owner rules

1. **Immediate public provisional entry:** elect to submit own scored run; upload immediately and show it on the public board stamped **Unverified** (not hidden while waiting).
2. **Automatic, blind contribution:** during the submitting player's own FINAL self-verification race, their device downloads and checks approximately **a couple of random OTHER players' verification jobs in the background**. No separate manual player-review step. They cannot choose which other races; the gameplay UI reveals no target participant, run, result, or list of whom they verified. No other player may inspect the assignment graph either.
3. **Private verifier identifiers:** the server's validation journal attributes validators by **salted, username-derived pseudonyms**; never display public usernames next to verification, never reveal even a player's own verifier pseudonym to them. These tags and the underlying verifier-to-submission relationships are INTERNAL, not client-visible artifacts.
4. **Do not peer-verify offline elapsed hours.** Offline time is local math, not one of the volunteer replay jobs.
5. **Offline shard rate uses recorded genuine races.** The eligible recent races for the SAME frozen checkpoint, compatible equipment and rules are valid source evidence **whether verified or not**. Nonverified run history still earns baseline offline shards.
6. **Verified evidence bonus:** when offline yield extrapolates from a qualified VERIFIED-run evidence cohort, award positive EXTRA bonus shards. Verification is an incentive, never a gate to basic Idle earnings. Exact multiplier, eligible cohort threshold and selection policy remain OPEN.

## 2. Proposed protocol — not user-locked implementation

- Player opts into future public submission; app gives a brief, upfront description that public verification also performs anonymous, limited checks on other players' submissions **without identifying which ones**. The player has no discretion over individual assignments. First-release LOCAL-only play needs no registration/verification grid.
- After submission, server records immutable candidate and displays Unverified on public board. Server commits challenge and sends opaque task IDs, versioned physics and policy weights-only payloads to appropriate devices; no sender username, scoreboard position, or verifier identity tag should be included.
- Own final self-check re-executes legal frozen model under designated real seeded physics conditions; bounded low-priority peer verification workers concurrently execute assigned tasks. A peer check is reproducible execution and comparison, not a vote, thumbs-up, or trust in somebody's replay video.
- Server compares independent check results; only server decides whether evidence meets public Verified policy. Failed/contradictory results become Disputed, Rejected or Awaiting Further Checks. Targeting 2 hidden jobs per public submitter is NOT equivalent to proving any particular submission has two independent validators; scheduler must separately track target quorum and distinct operators.
- To prevent replaying or favorably selecting public challenge seeds, recommend server selection/commitment of protected seeds/checkpoints before evaluation, versioned authoritative physics and a signed challenge envelope. Audited random server challenges plus independent replicated validations deter colluding clients but DO NOT completely prevent a farm of fake accounts or malicious agreement.
- A future global ranking ought to use genuine verified modeled/real fixed-seed performance, NOT total reported hours or total offline shard balances that depend on unauthenticated local clocks. The locally earned shard wallet may remain independent.

## 3. Privacy/trust boundary

**Important feasibility constraint:** if a third-party browser runs someone else's submitted model, a technically capable owner can inspect the downloaded weights or protocol packets. No client-side secret, hidden task name or code obfuscation can guarantee they learn absolutely NOTHING about the job. We can **withhold identifying user/run metadata from UI and ordinary API payloads**, avoid linking to recognizable public models, restrict transferred telemetry, and retain the assignment graph only in the coordinator. Perfect concealment of the raw computation is not available without substantially different trusted/proof machinery.

**Pseudonymization recommendation:** a visibly salted SHA hash of a guessable username can be dictionary attacked; prefer a server-secret HMAC over normalized, stable internal account ID rather than mutable display names. Domain-separate verifier pseudonyms from scoreboard identity and optionally rotate by season/key version while retaining private server audit linkage. The key, pseudonym and username mapping stay SERVER-ONLY, never in downloaded tasks, public API, console receipts or client storage. This is privacy improvement, not a magical Sybil-proof identity or mathematical anonymity guarantee.

**Resources:** dynamic CPU/thread/network quotas and worker scheduling prevent background verification from changing the submitter's own physics tick rate, score, input latency or model evaluation. For weak devices, postpone assignments, use bounded queue or a trusted server fallback; do not silently spoil the verified score. No arbitrary uploaded executable code; weights-only model with ABI validation.

## 4. Verified-evidence Idle bonus (proposed mechanics)

- Eligible real physics RunEvidence stores frozen brain hash, equipment hash, game rules, official event ID and a **verification status** independently of the legacy RunRecord/ledger hash (which must not change).
- **Base yield:** compute from the genuine recent eligible sample regardless of verification status; never reduce to zero solely for unverified racing.
- **Bonus:** if the Idle estimate actually uses a qualifying verified-only cohort for the same brain/gear/rules, apply a separate positive versioned bonus factor B to new offline shard settlements. B and the minimum verified sample size must be measured and chosen; a hypothetical 5–15% range would be an EXAMPLE ONLY, NOT a decision.
- Race status updates apply to NEXT eligible settlement snapshots. The same offline interval cannot pay baseline or bonus twice, and retrospective verification does not silently re-credit earlier Idle accrual.
- Open policy: whether the player chooses a verified evidence profile, whether the game automatically prefers verified evidence when sufficient, and how partially verified cohorts are weighted. Do not silently change the claimed statistical basis of one's earnings.

## 5. Proposed conformance and rollout gates

- Provisional **Unverified** displayed as soon as submission accepted, even with no validators online.
- Hidden automatic peer tasks co-scheduled at submission's own final verification, selected by coordinator, no identities/results/assignments shown and no exposed own verifier pseudonym.
- Server-side private HMAC/assignment graph; clients may be able to inspect raw task data, so no false total secrecy claim; no arbitrary executable model files.
- Two independent agreeing results (initial suggestion, exact policy undecided) or server adjudication for Verified; conflicts remain disputed, never public verified by a self-check alone.
- No scored-run physics/latency regression while peer tasks process; network/CPU limits tested on weak Chromebox/mobile.
- Base Idle payment passes for verified and unverified recorded physical races; verified-backed calculation can earn separate positive idempotent bonus, and status change never double-settles history.
- No checking offline elapsed time; public ranking cannot treat untrusted time-derived shard totals as proven performance.
- Local first-release standings, checkpoint and wallet work without server, identity, public upload or peer tasks.

**Architecture review status:** no public service/validator/verified Idle bonus exists yet. Separate numerical pricing, quotas, trust policy and sample selection remain unapproved.
