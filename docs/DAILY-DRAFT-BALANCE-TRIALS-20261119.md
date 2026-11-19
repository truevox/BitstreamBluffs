# Daily Draft v1 — controlled balance candidates

**Date:** 2026-11-19. **Author:** Gal Friday — assistant test design and suggestions, **not** Marvin's final balancing decision. The game currently allows an equal fixed **1,200 Draft Credits**. Rebuilding a preset is free, and these proposals do not alter the game or grant purchased upgrades. All costs and displayed effect coefficients were computed from the shipped `DailyDraft.js` and `PermanentUpgrades.js` source on `main` at `c20092f`. These are **legal, source-derived loadouts**, not claims of competitive strength.

| Trial build | Rank allocation | Credit cost | Main calculated effects |
| --- | --- | ---: | --- |
| **Speed focus** | Speed **15** | **1,185** | +16.7% race-speed multiplier |
| **Canopy-recharge specialist** | Parachute Fuel **12**, BSOD Head Start **3**, Airbrake Lift **2** | **1,187** | +32.3% canopy fuel, ~3.6% lower BSOD acceleration, +7.9% airbrake lift; **rank 12 uniquely enables earned canopy recharge after a real Bluff** |
| **Trick-control specialist** | Flip Control **8**, Hop Height **5**, Airbrake Lift **7**, Divebomb Power **5** | **1,137** | +14.7% flip, +6.5% hop, +20.3% airbrake lift, +16.0% divebomb power |
| **Balanced pilot** | Speed **6**, Hop **5**, Flip **4**, Parachute **4**, Airbrake **4**, Divebomb **4**, BSOD Head Start **2** | **1,153** | +10% speed, +6.5% hop, +9.4% flip, +15.6% canopy, +13.8% airbrake, +13.7% divebomb, ~2.5% lower BSOD acceleration |
| **BSOD-defense focus** | BSOD Head Start **11** | **1,143** | ~9.5% lower BSOD acceleration |

All five are under the 1,200-credit cap. Unspent credits do **not** confer any extra benefit. The engine applies diminishing-return benefit curves and the same per-rank cost equation for all builds. The **real** competitive value of the benefits cannot be inferred simply by comparing these percentages: terrain, daily modifiers, player technique, recovery opportunities, scoring, and the time to the pursuing wall matter.

## A/B evaluation plan

For each build, retain the same official Daily seed and rule and collect comparable sessions **within that day's calendar window**. In a separate, non-ranked test harness, repeat across representative terrain seeds to reduce the single-day terrain bias. Keep controls, game difficulty, and collision handling identical. Track **score, distance, duration, number of successful genuine BSOD Bluffs, longest Surf chain, death cause, and whether the session was ended deliberately**. For canopy recharge, specifically count earned recoveries after actual scored Bluffs (merely approaching the BSOD is not enough).

If automated pilots are used, validate that they behave equivalently across layouts. Their results are diagnostics of the pilot policy as much as the build; they are **not** proof of human competitive balance. Get player feedback on feel, difficulty, and counterplay. Strong different archetypes are a feature; the test should identify an overwhelmingly dominant choice or a dead upgrade, not force equal outcomes for every possible rank vector.

### Guardrails

- **Do not change the published Draft budget or cost curves silently.** Changing fixed competitive rules requires a new `DRAFT_RULES_VERSION` and explicit handling of historical records.
- The Draft board is **device-local**, not a verified shared global leaderboard. Its v4 hash is integrity-oriented, not a secure anti-cheat attestation. A player controlling local storage can fabricate an unkeyed hash.
- No modification of a real player's save, permanent upgrade ownership, credit bank, or live run should be part of balance data collection without explicit consent. Test in disposable browser profiles.
- This report records proposed test cases only. No nerfs, buffs, deployed code, or approvals are implied.
