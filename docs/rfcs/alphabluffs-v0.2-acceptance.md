# AlphaBluffs v0.2 — acceptance matrix (PROPOSED, not yet passing)

Companion: [v0.2 RFC](./alphabluffs-v0.2-contract.md). A standalone non-production [reference model](../../tools/spec/alphabluffs-economy-model.mjs) with [unit tests](../../tools/spec/alphabluffs-economy-model.test.mjs) exercises the Sim-Slot/Power state machine without physics or wallet integration. Each row below is a future production test/verification target, NOT a claim that game implementation exists.

| ID | Test fixture / action | Required behavior |
|---|---|---|
| L01 | New profile with 0 shards, 3 Sim-Slots | Genuine 3 concurrent simulations may train; accelerated internal episodes pay ZERO shards/official Ride-Daily records |
| L02 | At 12 productive active hours, choose FREE Continue | Same brain, optimizer, queue, RNG, roster and campaign; another 12 active hours with zero shards, repeat forever |
| L03 | Attempt to rent extra Sim-Slot midcampaign or at free rearm | Reject/defer until explicit Stop & Reconfigure, no bank deduction |
| L04 | Rent Slot between campaigns | Exactly one extra permitted genuine physics environment for purchased time, bank charged once |
| L05 | Buy Power Potion while RUNNING | Current campaign global attention +12 active hours; extend already-existing rented Slot lease IDs according to tested roster policy |
| L06 | Buy Power Potion with no active campaign | Immediate purchase yields +12 hours for NEXT campaign; no retroactive older-run benefit |
| L07 | Stop & Reconfigure early with unused purchases | Save all neural progress, show exact pending loss, FORFEIT invested Power/extra Slot time; no refund, carryover OR separate stopping fee |
| L08 | Stop & Reconfigure after purchased time exhausted | Save progress, reconfigure with zero lost time / no charge |
| L09 | Browser closes/sleeps/crashes, reopened later | Same learner+roster and all unused paid active-time balances preserved; no offline neural training; begin separate Idle settlement |
| L10 | Use free Continue with expired rented slot | Three free slots remain; no reviving used-up purchased bonus lease |
| I01 | Frozen Autopilot 100 normal runs, upgraded sled | Genuine physics/eligible shards, frozen model hash unchanged, equipment changed legitimately |
| I02 | Off-browser elapsed time with known same-brain evidence | Exactly-once OFFLINE SHARD RACING official virtual wins/losses and shard ledger; not actual physics Ride/Daily records |
| I03 | Brand-new imported brain with only 0–3 eligible runs | Conservative prior/confidence, no fantasy champion yield from unverifiable author claims |
| I04 | Equipment or deployed brain changes | New offline interval rated by new appropriate frozen pilot/loadout, past settlement immutable |
| I05 | Duplicate tabs, reload twice, clock rollback | No duplicate offline rewards or wins, no negative elapsed-credit |
| I06 | Real-run history currently lacks immutable deployed brain hash | Versioned BrainRunEvidence (or safe migration) stores pilot, gear and rules linked to actual run ID/ledger hash without breaking historical hashes or duping payouts; no false last-X history |
| P01 | Seeded actions in real Ride and renderless trainer | Same authoritative fixed-step physics outputs within declared cross-runtime conformance; discrepancies reported |
| P02 | Invalid model graph, huge weights, NaN or unsupported ABI | Reject safely, no executable import, no uncontrolled resource allocation |
| P03 | NEAT / fixed nets / PBT method sharing | Compatible inference supported; optimizer copy/fine-tune rejected if architecture incompatible; provenance honest |
| P04 | MAP-Elites, novelty, PBT example trains | Each produces actual method-specific learning signals, archives/competition traces, not UI-only placeholders |
| P05 | 1/3/6/12 worker performance desktop + Chromebox | Publish real aggregate physics steps/s, thermal/CPU/memory, and queue occupancy; no fictional linear scaling |
| C01 | Evolution Draft / All Dressed with privately purchased upgrades | No more officially allowed training steps or hidden demo advantages; rank/trust rules explicit |
| C02 | Kodiak encounters under fixed seed and Level X | KPK white, BFK brown grizzly, BIK black Vermont; can overtake/be overtaken, predictable evasive counterplay; no unavoidable hidden teleport |
| C03 | Brain Bazaar import and publishing | Consent/licensing, compatible weights-only sandbox, version checks, no raw demonstrations leaked without approval |
| S01 | Chromebox July 1 local rollover and power-loss recovery | Old brain archived; genuinely blank new brain, build pinned; no student tracking or raw radio device capture |
| D01 | RFC signoff and GBrain provenance | Settled owner rules separate from assistant balance defaults; no real-money hosted-training task is added |
