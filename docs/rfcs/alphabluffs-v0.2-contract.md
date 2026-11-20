# AlphaBluffs v0.2 — three modes, Sim-Slots, Power, and Shard Racing

**STATUS: DRAFT FOR OWNER REVIEW. Not implemented, signed off, or deployed.**
Date: 2026-11-20. Repository base: origin/main at 75bba2e.
Canonical owner decision history: local GBrain projects/truevox-bitstreambluffs/evolution-mode/formal-spec-v0-1.
Focused canonical GBrain homes: projects/truevox-bitstreambluffs/evolution-mode/sim-slots-and-power and projects/truevox-bitstreambluffs/evolution-mode/shard-racing.
Tracking: GitHub BitstreamBluffs issues #23, #24, #25, #26, #27, #40–#48.

## 1. Authority and terminology

- **OWNER DECIDED:** an explicit Marvin requirement, not an assistant suggestion.
- **PROPOSED DEFAULT:** a starting implementation interpretation to be approved, not yet an owner's rule.
- **MEASURE:** performance, balance, legal/security or reliability decisions requiring real evidence.
- One **physics episode** is an actual seeded downhill race simulated under authoritative game physics.
- One **training campaign** is a persistent optimizer plan and queued set of many physics episodes, including brain weights, RNG, archive, checkpoint and locked concurrency roster.
- One **Sim-Slot** represents one concurrently advancing real physics environment, NOT one trainer project, brain, learner generation, candidate, CPU core or individual episode. Sim-Slots is the preferred player-facing name.
- **Power Potion** is a WORKING label, pending a possible better game-themed name.

## 2. Distinct gameplay modes and shard bank

**OWNER DECIDED:** Ride is the existing manual arcade game; frozen Autopilot/Idle deploys one player-selected immutable trained checkpoint and plays ordinary physics-based runs for eligible shard income, potentially using real permanent equipment upgrades; Evolution Lab trains real networks and never pays shards for accelerated internal training episodes. Brain Bazaar is a model exchange, not an additional top-level mode. Imported powerful brains aren't locked by player experience level.

**PROPOSED DEFAULT:** one existing player profile-owned spendable shard bank and equipment inventory for Ride, Idle and Lab. Actual repository ProfileStore already has a spendable bank distinct from lifetime earned shards; reuse rather than creating duplicate currency. Mode-specific record origins and eligibility keep training, modeled Shard Racing and real manual/Idle racing separate. Keep Daily Classic and fixed-budget Daily Draft currency and rankings isolated.

**MEASURE:** shard generation rates, upgrade/shop effects, clean migration from current profiles, and preventing replayed/invalid/ineligible events from paying twice.

## 3. Evolution Lab state machine — OWNER-DECIDED behavior

| State/event | Transition | Training knowledge | Power and Sim-Slot allowance |
|---|---|---|---|
| Between campaigns: Start | RUNNING with locked Sim-Slot configuration | Restore chosen saved checkpoint or explicitly start new | Start counting ONLY productive active training time |
| After 12 free productive hours | AWAITING_CONTINUE | Full model/optimizer/queue/RNG checkpoint saved | Attention pauses; no 24-hour daily quota |
| Continue — FREE +12h | SAME campaign and roster RUNNING | No neural reset; repeat forever at 0 shards | +12 active hours for free |
| Pause, browser close, device sleep, crash | PAUSED or OFFLINE_IDLE, same campaign identity | Full state preserved; closed app does NOT learn | All unused purchased active-time allowances preserved, not consumed |
| Rent more Sim-Slots while RUNNING/AWAITING_CONTINUE | REFUSE / prompt Stop & Reconfigure | Unchanged | No charge until between campaigns |
| Stop & Reconfigure (explicit confirmed action) | END campaign; BETWEEN_CAMPAIGNS | SAVE learned weights, optimizer, all archives and lineage for new run | **FORFEIT unused purchased Power and extra rented Sim-Slot time invested in ended campaign. NO refund, NO carryover, NO extra stopping fee** |
| Between campaigns: rent Sim-Slots | Add temporary concurrency for NEXT campaign | Checkpoint unchanged | New purchase at displayed price |
| Power Potion while RUNNING | Add +12 hours to CURRENT campaign | Unchanged | Consume purchase now; extend current rented roster only |
| Power Potion while BETWEEN_CAMPAIGNS | Add +12 hours to NEXT campaign's pending allowance | Unchanged | Not an entitlement in any already-ended run |

**OWNER DECIDED:** Three Sim-Slots always free. A player may train indefinitely on them for zero shards by pressing free Continue every 12 productive hours. Bonus Slots are temporarily rented ONLY between long campaigns, never at the routine free re-arm. Power Potions can be bought ANYTIME and immediately add 12 active hours to current or pending next campaign. A Potion taken AFTER renting bonus slots can extend those EXISTING slots; a subsequently rented slot cannot inherit an older Potion.

**OWNER DECIDED:** Stop & Reconfigure deliberately ends the run, NOT the learned brain. The choice incurs **no separate penalty**: cost exists only if a player prepaid more runtime or rented slot-hours than they used. Ordinary pause/close/free Continue never forfeits entitlements. Warn with exact actual unused hours before confirming a forfeit; if zero unused entitlements, show no lost amount.

**PROPOSED DEFAULT:** one global active-attention clock when one or more authorized environments advance; each extra Slot lease counts actual productive occupancy of THAT environment. Expired bonus leases remove their capacity without erasing queued work. A Potion adds 12 hours to attention and ALL bonus leases already held at purchase, priced with current roster. At expiration of the free 12h attention clock, free Continue cannot restore an already-consumed bonus Slot lease. Pending Potions bought before a run begins attach to the NEXT campaign; if none has started they are not part of a terminated campaign.

**MEASURE:** worker stalls, crash-safe journaling, concurrent browser tabs, durable checkpoint, atomic debit/lease creation, dynamic queue sizing, active-utilization vs reservation billing. Genuine technical failures need recovery; they are NOT voluntary Stop & Reconfigure.

## 4. Proposed balance equations — NOT owner-approved prices

Let j index the jth **extra** purchased Sim-Slot, n = 3 + all currently rented bonus slots, and H = total committed uninterrupted productive active hours for the current/next campaign (including first 12 free hours). X, Z, alpha, beta are tuning parameters.

- Extra Sim-Slot rental for a proposed 12 PRODUCTIVE slot-hours: S(j) = round( X × [1 + beta × (j-1)] ).
- +12h Power Potion: P(n,H) = round( Z × (n/3) × [1 + alpha × floor(H/24)] ).
- Sensitivity candidates, NOT approved: beta about 0.25–0.50 and alpha about 0.25. No real X/Z shard price until income and throughput measured.
- Price shows slots and unattended duration before buying, and a ledger receipt binds exactly the existing bonus lease IDs. Buying many Potions before renting many Slots cannot give future slots retroactive free extensions.
- Paid time is NOT calendar duration; it pauses when actual active training work stops. Hardware governs real simultaneous speed. A purchased slot is a concurrency permit, not a guaranteed extra core.
- **PROPOSED DEFAULT needing owner signoff:** next-campaign unattended-duration price escalator resets after a real Stop & Reconfigure. There is no way to circumvent spent, nonrefundable active campaign purchases by browser refresh.

## 5. Official offline Idle and Shard Racing

**OWNER DECIDED:** Closing the browser PAUSES real Evolution Lab neural training and STARTS offline Idle. Use a frozen deployed model (or bundled default) and owned equipment to estimate earnings. Offline Idle may have **OFFICIAL Shard Racing races and victories**, under its own separately disclosed virtual game rules, not fabricated downhill physics races or Daily Classic/Draft leaderboard records. Training weights do NOT improve while the browser is shut. Owner proposed calibrating the virtual earnings from the last X real games of the SAME frozen brain.

**PROPOSED DEFAULT — first local official league:** Players earn official LOCAL Shard Racing victories, separate from actual live physics race records. A global cross-player **verified** ladder requires an explicit trust/server policy and is not part of the first offline-local resolver. Virtual opponents can be defined by league tiers or archived verified statistical benchmarks; do not claim to have raced another named real player unless a trustworthy competitive service actually does that.

**PROPOSED DEFAULT — estimate real ability:** Use most recent ~20–30 eligible genuine races of the exact selected frozen checkpoint, under compatible equipment and game rules, and measure survival, finish frequency, score, race duration, hazard survival and shard yield. To avoid treating three lucky races as a champion, use confidence smoothing: estimated = n_eff/(n_eff+k) × observed + k/(n_eff+k) × benchmarkPrior. The exact window and k need statistical calibration. New imported Bazaar brains without adequate real evidence use a conservative starter prior, or benchmark while the app IS open, never trusting uploader-reported achievements as income authority.

**PROPOSED DEFAULT — seeded ledger:** A versioned deterministic virtual Shard Racing outcome resolver converts the elapsed eligible offline period into modeled wins, losses and shards using a frozen evidence/rules snapshot. Track mode=offline-shard-racing and display "While away: races, wins, shards, hours, pilot". These are OFFICIAL results under Shard Racing rules, but NOT a physics-run replay, official Ride/Daily win or live-race skill measurement. Do not double-credit a separate hourly idle income and each modeled virtual race for the same elapsed time unless explicit rules allocate both.

**PROPOSED DEFAULT — local-first v1:** No automatic offline equipment shopping; one fixed loadout per offline interval. Release a virtual opponent/league-cadence design with real-duration-derived timing; do not silently invent a 24h cap, payout multiplier or hardcoded exact races/hour without benchmark.

**MEASURE:** race-duration/cadence floor for rapid-crash brain, older/better brain variance, official virtual race win rules and achievements, equipment changes, highly capable Bazaar imports, absence interval claims, duplicated tabs, crashes and backwards wall-clock. Reconciliation must be idempotent, atomic with the existing shard bank and bounded in storage. Close events are unreliable, so use durable foreground heartbeats and settlement cursors; not simply browser unload.

## 6. Simulator, ABI, real training methods and fairness

**OWNER DECIDED:** Real trainer episodes MUST share the same actual seeded game physics, terrain, hazards and equipment. Required first-class training methods include NEAT, fixed-parameter ES/CEM, MAP-Elites, novelty search, Population-Based Training; optional PPO/demonstrations later. Genuine learning must be observable, checkpointed and measured, not fake scripted brain levels. Training and stock-equipment skill ratings are separate from purchased equipment strength.

**PROPOSED DEFAULT API seam:** seeded reset(game build, rules, biome, equipment) returns a versioned observation; bounded policy actions advance fixed authoritative steps and return next observation, shaped learning reward, true game score and terminal telemetry. Observations are player-perceivable only (speed, rotation, slope/hazards, ground state, legal equipment abilities, BSOD danger when visible); actions match actual supported controls, not teleporting/seeing unseen future hazards. Version the action/observation/reward/physics contracts. Account each actual authoritative frame in budgeted contests, even if a chosen action persists over many frames.

**PROPOSED DEFAULT model envelope:** immutable checkpoint hash, family (NEAT / fixed topology etc.), architecture + weights, action/observation ABI version, training recipe/lineage/seed provenance, owner attribution. Same inference ABI does NOT mean NEAT weights can be directly copied into a fixed-network PPO/ES trainer; document a compatibility matrix for deployable, fine-tunable, PBT-copyable, convert-needed, rejected. No arbitrary executable code in Bazaar imports; reject malformed weights/NaNs/unbounded graphs.

**MEASURE:** exact checkpoint/replay reproducibility, browser-platform physics drift, memory/thermal/worker scalability, valid restoration after crash, uniform scoring, optional training-method recipe percentages only where denominator is honest. Budgeted Evolution Draft/All Dressed MAY NOT purchase extra verified physics-step budgets through private shards, extra Sim-Slots, pretraining or hidden demonstrations. Existing Daily Classic/Draft records retain their separate trust rules.

## 7. Other game and operational acceptance

| Area | Owner direction | Still open / needs test |
|---|---|---|
| Racing Kodiaks, issue #47 | Occasional hostile moving rivals, overtaking/be overtaken, attempt to wreck player; KPK WHITE polar-like, BFK BROWN grizzly, BIK BLACK Vermont black bear | Sync Level X, biome/cadence, attack cues/collision/fair avoidance, deterministic replay and curriculum; archetype attack behavior is only assistant-proposed |
| Brain Bazaar, issue #40 | Share/fork/download any brain strength, creator and training-method attribution | Weights-only safe import, consent/licenses, moderation, incompatibility UX, service/offline boundary |
| School Chromebox, issue #26 | Yearly July 1 America/New_York rebirth, archived ancestors, pinned build, real developmental aspiration, ambient Wi-Fi activity as intentional entropy | Kiosk stability/backup, thermal/storage, radio metrics without student tracking, no MAC/SSID/payload collection, true skill not faked |
| Existing music and racing | Frequency radio, Kodiaks, BSOD, real game integration and streamer-friendly free game | Independent asset rights, performance/accessibility and compatible feature branches |

**NOT PART OF THIS IMPLEMENTATION RFC:** real-money shard sales, mandatory accounts, actual neural training in a closed browser, cloud compute, arbitrary prestige resets. Distant hypothetical monetized hosted training is preserved in GBrain ONLY and does not get a current feature issue or build requirement.

## 8. Proposed implementation sequence and signoff

1. Extract/shared **actual physics**, observation/action contract, one deterministic trainable baseline and fixed-seed replay tests; benchmark 1/3/6/12 true physics environments on desktop and target ChromeOS.
2. Persist immutable trained brains and make **real foreground frozen Idle** races earn legitimately while trainer runs pay zero; adapt existing ProfileStore bank without duplicate currency.
3. Add the **Sim-Slots/Power state machine**, free infinite 12h rearms, between-run Slot configuration, actual Stop & Reconfigure forfeit, durable checkpoint and journal.
4. Build separate **offline official Shard Racing** v1 local resolver, confidence-weighted evidence and once-only settlement; no invented real-physics replays.
5. Add required method families, measured training provenance, Bazaar compatibility, Kodiak training observations, mode-specific and restricted verified contests.
6. Independently validate school kiosk operation and release/legal/privacy gates. Never merge to production merely because a design RFC exists.

See companion acceptance matrix: [AlphaBluffs v0.2 Acceptance](./alphabluffs-v0.2-acceptance.md). The separate [economy reference state machine](../../tools/spec/alphabluffs-economy-model.mjs) and its [Node built-in tests](../../tools/spec/alphabluffs-economy-model.test.mjs) are an executable illustration of owner-decided transitions and explicitly proposed billing assumptions, **NOT** wired to the game, production wallet, browser scheduler or real physics.

### What remains genuinely for Marvin

- **Owner approval proposed defaults:** first Shard Racing ladder local-official rather than a pretend verified global league; shared existing bank/garage across modes; no offline auto-shopping in first offline resolver; duration-price escalator resets only when a genuinely new campaign begins; specific Kodiak level gate and league win format later.
- **No immediate owner choice necessary** for numeric X/Z/alpha/beta, sample window k, codec/ABI, Worker architecture, exact throughput, race cadence and reward caps: measure/prototype those before requesting balance approval.
- **Release approval still required:** versioned implementation fixture results, owner acceptance of the final balance and fairness model, and a reviewed PR.
