# AlphaBluffs — public leaderboard anti-cheat boundary RFC v0.1

**Status:** DRAFT; owner threat model and verification parity are decided; specific technical solution below is a Friday proposal. **Not implemented or merged.** Parent: [v0.2 integrated RFC](./alphabluffs-v0.2-contract.md). Canonical owner history: GBrain projects/truevox-bitstreambluffs/evolution-mode/public-competition-integrity. Related [blind peer verification RFC](./alphabluffs-peer-verification-v0.1.md), issues #42, #46, #48.

## 1. Marvin's actual goals (2026-11-20)

- **Primary:** Protect the integrity of public leaderboards from obvious cheating, including clients minting absurd Shard balances, buying huge legitimate-looking equipment upgrades/training advantages, then submitting physically genuine but competitively unfair results. Also test forged brains, course seeds, run records and result metadata. Pragmatic cheap prevention, **NOT** an impossible claim to stop every exploit.
- **Secondary:** Reduce cheating in the broader Shard economy, without destroying the free offline-first local experience.
- **Absolute verification parity:** Free blind PEER verification and optional **PAID developer/server verification** must confer **identical** proof requirements, Verified / Rejected outcome, leaderboard eligibility and in-game Shards/Seals/rewards. Money buys optional verification-compute convenience only, not a better adjudication, favorable seed, boosted rewards, priority standing or a special competitive tier. Both paths feed one server-owned verdict engine.
- **Currencies:** Shards + Seals are acceptable working names, **not** a decided two-wallet mechanic. Seals need no gameplay benefit. Selling verification-as-service is **not** selling shards or Seals, and must never automatically award them for payment alone.
- **Local-first, public-ready**: initial local launch need not require online login, cloud verification or server balance. Later public rankings must not rely on client-authored coin balance.

## 2. Evidence from current source code

The existing game ProfileStore persists a bank in editable browser localStorage under bb.profile and credits each real run idempotently via its ledger hash. It has a purchaseUpgrade() path for permanent gameplay improvements, and the catalog contains speed, hop, flip, canopy, airbrake, divebomb and BSOD Grace ranks. The current daily mode already disables purchased upgrade ranks for official Daily runs. These are **source facts, not assertions of an installed online anti-cheat solution**. Local-store hashes alone are not a security boundary because an attacker may edit the whole client and saved values.

## 3. Proposed cheapest useful containment

### 3a. Define public boards by what they admit

**STOCK / EQUAL-LOADOUT PUBLIC BOARD:** the authority fixes equipment/gear ranks, versioned physics/rules, allowed abilities and challenge seed. On submission, recreate the race under legal submitted frozen model and authoritative game rules. A local save with forged billions of Shards cannot buy a better legal loadout *for this board*. This extends the existing clean/Daily distinction.

**UPGRADED / OPEN-EQUIPMENT PUBLIC BOARD:** the authority validates BOTH (i) legitimate seeded replay/brain performance, and (ii) every effective purchase/upgrade/boost rank from a SERVER-OWNED ENTITLEMENT LEDGER or equivalent authenticated receipt; client-supplied profile.bank and upgradeRanks are merely claims, never proof. If a client bought rank 9999 using forged local Shards, the public submission is unqualified unless the server itself accepted those purchases.

**FIXED-TRAINING-BUDGET PUBLIC CONTEST:** no paid extra Sim-Slot/Power advantage may increase the officially permitted physics-step budget. To guarantee true clean-training eligibility requires organizer-run initial states and controlled accounting or comparable evidence. A strong legal model submitted from arbitrary outside pretraining **cannot** prove a fixed private training history through its weights alone. Keep these contests distinct from OPEN brain performance where all legal model weights/real-world compute history may compete.

### 3b. Separate local and public authority

A **LOCAL wallet** may remain user-editable and support all single-player play, equipment, Power, training, cosmetic rewards. In a future server-backed PUBLIC economy, the SERVER independently credits shard income using authoritative server time, approved authentic run evidence, idempotent transactions and its own last-settled cursor. Server validates competitive purchases and loadouts from that ledger. Do **not** silently import the local bank, local equipment or historic local-clock earnings as publicly qualified account credit. Define an explicit future migration policy; local progress can always remain playable even if not accepted as public-verified currency.

**Working currency naming does not solve fraud:** creating a locally editable Seals field or using two client-side currencies gives NO assurance of genuine spending. Seals may be server-issued honors/cosmetics with no gameplay advantage; whether to implement a second spendable wallet remains open.

### 3c. Free and paid verification use a single standard

- Upload candidate immediately to public board as **Unverified** and preserve the original server-received submission timestamp.
- FREE path: blind random reciprocal peer jobs, opaque assignment mapping, private validator pseudonyms, actual deterministic replay, server quorum/adjudication.
- PAID path: same replay challenge, exact same rules, same verifier independence and final authority; difference is who performs computation and potentially latency/availability. Never sell a favorable verdict.
- Both paths pass results into the **same server verdict state machine**. Exactly matching evidence MUST produce the same public eligibility, rank, rewards and verification status regardless of provider.
- Tournament deadline eligibility should be determined by original server **submittedAt**, not when verification finishes, so paying for faster service is convenient but not a ranking/entry advantage. Both paths can remain Unverified until validated; dishonest claims still fail.
- Never trust the client's own status flag, self-check result alone, timestamp, Shard total or upgrade list.

## 4. Known limits and cost-conscious priorities

**Highest impact P0 gate:** Stock board rejects boosted loadouts; upgraded board demands server-recognized gear entitlements. This directly blocks the easy 'edit bank then buy all upgrades' exploit in public competition. Confirm with attack fixtures before claiming any percentage of cheating blocked.

**P1:** signed challenge identity/seed, model ABI and physics equivalence, peer/server replay parity, duplicate/forged receipts and settlement replay, multi-device account/role security, blinded peer assignment, independent quorum/spot-checks and basic abuse rate limits.

**P2:** sophisticated Sybil/collusion attacks, modified client fingerprinting and fake training-provenance in OPEN events. Avoid invasive client surveillance or claiming impenetrable validation. If no server ever observes the training process, an external-trained legal brain can still be submitted to OPEN category: that's legitimate open competition, not a guarantee of equal training compute.

**Potential loop:** locally minted fraudulent Shards could fund extra local Sim-Slots, enabling more private training. A legal model trained with more compute may outperform peers in OPEN contests; without an enforced training budget this cannot be reliably attributed to local Shard cheating. Reserve strict train-budget claims for organizer-controlled classes rather than pretending purchase receipts prove private optimizer history.

## 5. Security acceptance matrix (proposed)

| ID | Attack / scenario | Expected public outcome |
|---|---|---|
| A01 | Edit bb.profile.bank from 20 to 999999999 | Local sandbox can change; server public bank and accepted purchase history unchanged |
| A02 | Spend forged local shards for speed/flip/BSOD upgrades; submit STOCK | Standardized loadout only; claimed upgrades ignored/rejected for that class |
| A03 | Spend forged local shards; submit UPGRADED with real physics proof | Reject public eligibility when even one effective upgraded rank has no valid server entitlement |
| A04 | Change client upgradeRanks or replay a purchase receipt | Reject unsupported ranks and previously consumed/reused receipts |
| A05 | Real run, same model/rules, free peer route vs paid server route | Same Verified/Rejected classification, eligible boards, in-game credits, Seals, and rewards |
| A06 | Verify via paid route before a free queued result is resolved | Earlier original submittedAt is retained; event entry deadline fair regardless of route |
| A07 | Client submits claimed Verified flag and forged run/seed | Ignore client status; independent verifier/authority replays committed legal challenge |
| A08 | Accrue unverified offline shards entirely offline then connect account | Local shards remain local; do not silently mint authoritative server credits |
| A09 | Manipulate local clock, ask server for year of idle shards | Server uses server time and last-settled account cursor; no extra trusted credits |
| A10 | Pretrained strong legal brain enters OPEN ranking | Can compete if replay/rules valid, regardless of privately trained compute |
| A11 | Same pretrained brain falsely claims a fixed-step clean-training event | Reject without organizer-controlled proof of budget and starting state |
| A12 | Paid verifier is unavailable or fails | No upgraded/guaranteed status; retry or use free peers; no purchased 'Verified' badge |
| A13 | Nonverified legitimate real runs support LOCAL Idle baseline | Still earn normal local income; verified backing earns extra bonus under published rules |
| A14 | Submitted video/trace shows valid input but frozen policy cannot reproduce it | Reject actual brain-performance verification claim |

## 6. What is still a product choice?

- Whether to use **one spendable Shards balance** with separate local/online trust, or Shards plus Seals as a noncompetitive recognition asset. **Not locked.**
- Which public leaderboard classes accept purchased gear at all (stock-only launch is a viable cheap starting point).
- Whether any server-backed baseline income from locally generated, *unverified* run evidence is allowed (must define trusted-source checks or a bounded allowance; never blindly trust claimed rate).
- Exact free peer quorum, server spot checks, paid service turnaround/cost, qualifying verified-run bonus and competition class migration.
- No fixed anti-cheat success percentage is yet measured. Goal is to catch cheap/blatant exploits while retaining a fun local game.

**NOT IMPLEMENTED:** no live server wallet, entitlement validation, public anti-cheat, paid-verification service or public leaderboard exists in these documents. All existing tests in draft PR #61 are reference examples, not production proof.
