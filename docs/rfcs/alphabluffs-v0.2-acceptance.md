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
| I07 | First release local Shard Racing, no network | Build local standings deterministically from versioned offline-modeled event records and snapshots with event/season IDs, brain/gear/rules/provenance; no account/server or upload required |
| I08 | Future public leaderboard compatibility | Versioned event exports preserve distinct LOCAL official vs future PUBLIC verification status, offline provenance and idempotent settlement; sanitized/pseudonymous by default; no breaking retrofit of score ledger required |
| I09 | Invalid client self-attested public result | Locally generated results remain NOT VERIFIED for a public global leaderboard even if an export/import claims verification. Unknown event versions and duplicate/conflicting IDs fail safely; future authoritative verifier required |
| V01 | Submit own public candidate | Immediately visible on future public board stamped Unverified; no requirement to wait for peer checks before provisional listing |
| V02 | Submitter starts own final verification | Separate bounded background workers process random OTHER runner checks; submitter cannot pick or see their target IDs/names/results, no verifier-to-run public map |
| V03 | Pseudonymous worker attribution | Coordinator stores private salted/keyed username-derived verifier tags; no real usernames or even client's OWN verifier tag in UI, browser payloads or public API |
| V04 | Submitter owns final scored run while peer worker active | Deterministic own result/score and responsiveness unchanged versus baseline; throttle/queue work on weak devices rather than corrupt official result |
| V05 | Multiple peer results independently agree | Coordinator may mark Verified only after approved independent quorum/trusted check; disagreeing or replayed task becomes disputed/duplicate, never silently verified |
| V06 | Uploaded raw client job from another player | Parser refuses executable scripts/malformed/oversized weights, no arbitrary code execution or private identity leakage by design |
| V07 | Baseline Idle extrapolation from eligible unverified actual races | Base eligible shards still accrue; no verification gate for ordinary Idle, no fake neural progress |
| V08 | Verified-only compatible evidence cohort (policy/bonus values configurable) | Baseline accrual plus separate positive verified-evidence bonus, applied exactly once for new settlement interval |
| V09 | Race receives verification AFTER earlier offline interval settled | Previously paid shards not retrospectively duplicated; new intervals use new evidence snapshot/status |
| V10 | Public verified evidence versus server-owned offline time | Peer validation checks genuine real race performance, NOT elapsed time. Future public/account shards settle from SERVER timestamps/cursor and authoritative shard bank; client-reported hours or requested credits cannot change ledger |
| V11 | Future public shard settlement after disconnect | Server computes eligible time from SERVER timestamps and saved settlement cursor, not client-reported clock/hours; client asks for updated balance, cannot mint credits |
| V12 | Offline-first local game without public backend | Local balance remains local/unverified, game works entirely offline, and no unverified local hours/shards silently migrate to public server wallet |
| V13 | Player selects three spectacular genuine races and has forty recorded crashes | Chosen authentic same-brain/gear eligible runs may form Idle basis; don't reject/force an average of all history as anti-cheat; selection obeys published portfolio/balance rules |
| V14 | Selected verified and unverified authentic races | Base Idle remains available for either; positive bonus when selected verified evidence meets published rule, settled once |
| G01 | Forge client profile Shards into extreme balance then buy powered upgrade and enter STOCK public competition | Authoritative fixed/zero-purchased loadout; local forged upgrade ignored/rejected |
| G02 | Forge client local Shards, buy upgrade then enter UPGRADED public competition with physically reproducible run | Reject without server-recognized authoritative purchase receipt for EACH effective rank/boost |
| G03 | Same valid public submission chooses FREE peer or PAID developer/server verification | Identical valid/invalid result, Verified status, qualifying board and every in-game reward; fee never grants preferable judgment |
| G04 | Free verification queue is slow near public event cutoff | Preserve original server submittedAt and same deadline eligibility as paid validation; provisional until adjudicated |
| G05 | Client supplies a forged public balance, verification flag, gear inventory or shard timestamp | Server ignores client authority claims and uses stored account ledger, accepted evidence, rules and validation |
| G06 | Client buys many local Sim-Slots and trains legal open-category brain, claims restricted training budget | OPEN category may accept genuine model performance; budget-limited board needs organizer-controlled step history, not local Shard claims |
| G07 | Local-only Shards used for full single-player equipment and lab training | Offline gameplay remains available; public competition does not auto-certify local Shard funds or gear |
| G08 | Paid server verification returns same replay with different elapsed turnaround | Same score, proof status and rewards; paid service does NOT sell Seals, Shards or a stronger ranking |
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
