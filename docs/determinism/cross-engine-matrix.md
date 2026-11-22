# stub
<!-- BEGIN GENERATED -->
### Environments

| Engine id | Browser / version | Headless mode | OS / arch | GL renderer | Status |
|---|---|---|---|---|---|
| chromium-headless-shell | chromium 157.0.8103.78 | headless (chrome-headless-shell, SwiftShader) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| chromium-full-headless | chromium 153.0.8010.12 | headless=new (full Chromium, SwiftShader) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| chromium-shell-defaultgl | chromium 157.0.8103.78 | headless (chrome-headless-shell, default GL, no ANGLE flags) | Linux 6.18.44-fc-v726 x64 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ran |
| firefox | firefox 159.0 | HEADED under Xvfb (headless Firefox has no WebGL here; Mesa llvmpipe) | Linux 6.18.44-fc-v726 x64 | llvmpipe, or similar | ran |
| webkit | webkit 27.2 | headless (Playwright WebKit, not Safari) | Linux 6.18.44-fc-v726 x64 | Apple GPU | ran |

### Reference outcomes (chromium-headless-shell, 120 Hz stepping, session 1, run 1)

| Fixture | Ticks | Final outcome | Distance | Score | Covers |
|---|---|---|---|---|---|
| cruise-baseline | 2401 | ended at tick limit (no crash) | 591 m | 876 | baseline grounded + air |
| fifth-run-in-session | 1801 | ended at tick limit (no crash) | 472 m | 717 | recorded as the 5th run in one page session; re-verified in a fresh browser context |
| collision-heavy | 1669 | crash: terrain | 289 m | 399 | many contact pairs, hazards, hard landings |
| chunk-biome-boundaries | 3431 | ended at tick limit (no crash) | 815 m | 1115 | crosses procedural chunk borders and the 500 m sector boundary (biome sectors from sector 2) |
| bsod-pursuit-catch | 12150 | crash: bsod | 437 m | 0 | BSOD pursuit; the rider brakes and spams manual reset (respawn) until the wall catches it (~100 s) |
| airborne-tricks | 2224 | crash: hazard | 513 m | 2428 | heli / corkscrew / divebomb tricks |
| parachute-airbrake | 2146 | crash: hazard | 332 m | 790 | parachute deploy, air brake presses, ground brake |
| kodiaks-on | 2637 | crash: hazard | 606 m | 991 | hostile Kodiak packs (Sync Level >= 6 at record time) |
| daily-practice-rule | 2401 | ended at tick limit (no crash) | 724 m | 1399 | Daily rule + biome mask derived from a past date seed (practice run; official Daily needs today's date) |

### Matrix: first divergent tick vs the reference (per engine, cadence; both sessions and every run position)

A cell is `ok` when every run of that fixture in every session (including the repeat of run 1 at the end of each session) had a digest sequence identical to the reference; otherwise `FIRST_TICK subsystem(s)` (the earliest across runs; `*` marks inconsistent results across runs of the same cell).

**cruise-baseline**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (4) | ok (4) | ok (4) | ok (4) |
| chromium-full-headless | ok (4) | ok (4) | ok (4) | ok (4) |
| chromium-shell-defaultgl | ok (4) | ok (4) | ok (4) | ok (4) |
| firefox | 554 terrain (4/4) | 554 terrain (4/4) | 554 terrain (4/4) | 554 terrain (4/4) |
| webkit | 971 sled+world (4/4) | 971 sled+world (4/4) | 971 sled+world (4/4) | 971 sled+world (4/4) |

**fifth-run-in-session**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 489 terrain (2/2) | 489 terrain (2/2) | 489 terrain (2/2) | 489 terrain (2/2) |
| webkit | 714 terrain (2/2) | 714 terrain (2/2) | 714 terrain (2/2) | 714 terrain (2/2) |

**collision-heavy**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 580 terrain (2/2) | 580 terrain (2/2) | 580 terrain (2/2) | 580 terrain (2/2) |
| webkit | 732 sled+world (2/2) | 732 sled+world (2/2) | 732 sled+world (2/2) | 732 sled+world (2/2) |

**chunk-biome-boundaries**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 373 world (2/2) | 373 world (2/2) | 373 world (2/2) | 373 world (2/2) |
| webkit | 373 world (2/2) | 373 world (2/2) | 373 world (2/2) | 373 world (2/2) |

**bsod-pursuit-catch**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 764 sled+world (2/2) | 764 sled+world (2/2) | 764 sled+world (2/2) | 764 sled+world (2/2) |
| webkit | 508 sled+world (2/2) | 508 sled+world (2/2) | 508 sled+world (2/2) | 508 sled+world (2/2) |

**airborne-tricks**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 255 sled (2/2) | 255 sled (2/2) | 255 sled (2/2) | 255 sled (2/2) |
| webkit | 2054 terrain (2/2) | 2054 terrain (2/2) | 2054 terrain (2/2) | 2054 terrain (2/2) |

**parachute-airbrake**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 523 terrain (2/2) | 523 terrain (2/2) | 523 terrain (2/2) | 523 terrain (2/2) |
| webkit | 696 sled+world (2/2) | 696 sled+world (2/2) | 696 sled+world (2/2) | 696 sled+world (2/2) |

**kodiaks-on**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 586 terrain (2/2) | 586 terrain (2/2) | 586 terrain (2/2) | 586 terrain (2/2) |
| webkit | 796 sled+world (2/2) | 796 sled+world (2/2) | 796 sled+world (2/2) | 796 sled+world (2/2) |

**daily-practice-rule**

| Engine | 30 Hz | 60 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| chromium-headless-shell | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-full-headless | ok (2) | ok (2) | ok (2) | ok (2) |
| chromium-shell-defaultgl | ok (2) | ok (2) | ok (2) | ok (2) |
| firefox | 484 terrain (2/2) | 484 terrain (2/2) | 484 terrain (2/2) | 484 terrain (2/2) |
| webkit | 19 terrain+sled+world (2/2) | 19 terrain+sled+world (2/2) | 19 terrain+sled+world (2/2) | 19 terrain+sled+world (2/2) |

### Telegraph (presentation-derived, issue #155) differences

No run had a telegraph-only difference: the digest of the planned ground-telegraph marks was identical to the reference whenever the causal digests were.

### Outcomes per engine (final distance / score / ticks / cause) when they differ from the reference

| Engine | Hz | Session/run | Fixture | Ticks | Crash | Distance | Score | Reference |
|---|---|---|---|---|---|---|---|---|
| webkit | 30 | s1/#4 | chunk-biome-boundaries | 3431 | hazard | 835 | 1175 | 3431 / no / 815 / 1115 |
| webkit | 60 | s1/#4 | chunk-biome-boundaries | 3431 | hazard | 835 | 1175 | 3431 / no / 815 / 1115 |
| webkit | 120 | s1/#4 | chunk-biome-boundaries | 3431 | hazard | 835 | 1175 | 3431 / no / 815 / 1115 |
| webkit | 144 | s1/#4 | chunk-biome-boundaries | 3431 | hazard | 835 | 1175 | 3431 / no / 815 / 1115 |

### TapePlayer checkpoint desync (game-native check, exact sled state every 120 ticks)

| Engine | Hz | Fixture | First desync tick (checkpoint) | Runs desynced / runs |
|---|---|---|---|---|
| chromium-headless-shell | 120 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-headless-shell | 30 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-headless-shell | 60 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-headless-shell | 144 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 30 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 60 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 120 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-full-headless | 144 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 30 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 60 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 120 | chunk-biome-boundaries | 120 | 2/2 |
| chromium-shell-defaultgl | 144 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 30 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 30 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 30 | kodiaks-on | 1920 | 2/2 |
| firefox | 30 | daily-practice-rule | 1320 | 2/2 |
| firefox | 60 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 60 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 60 | kodiaks-on | 1920 | 2/2 |
| firefox | 60 | daily-practice-rule | 1320 | 2/2 |
| firefox | 120 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 120 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 120 | kodiaks-on | 1920 | 2/2 |
| firefox | 120 | daily-practice-rule | 1320 | 2/2 |
| firefox | 144 | chunk-biome-boundaries | 120 | 2/2 |
| firefox | 144 | bsod-pursuit-catch | 840 | 2/2 |
| firefox | 144 | kodiaks-on | 1920 | 2/2 |
| firefox | 144 | daily-practice-rule | 1320 | 2/2 |
| webkit | 30 | cruise-baseline | 1080 | 4/4 |
| webkit | 30 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 30 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 30 | parachute-airbrake | 720 | 2/2 |
| webkit | 30 | kodiaks-on | 2520 | 2/2 |
| webkit | 30 | daily-practice-rule | 120 | 2/2 |
| webkit | 60 | cruise-baseline | 1080 | 4/4 |
| webkit | 60 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 60 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 60 | parachute-airbrake | 720 | 2/2 |
| webkit | 60 | kodiaks-on | 2520 | 2/2 |
| webkit | 60 | daily-practice-rule | 120 | 2/2 |
| webkit | 120 | cruise-baseline | 1080 | 4/4 |
| webkit | 120 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 120 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 120 | parachute-airbrake | 720 | 2/2 |
| webkit | 120 | kodiaks-on | 2520 | 2/2 |
| webkit | 120 | daily-practice-rule | 120 | 2/2 |
| webkit | 144 | cruise-baseline | 1080 | 4/4 |
| webkit | 144 | chunk-biome-boundaries | 120 | 2/2 |
| webkit | 144 | bsod-pursuit-catch | 600 | 2/2 |
| webkit | 144 | parachute-airbrake | 720 | 2/2 |
| webkit | 144 | kodiaks-on | 2520 | 2/2 |
| webkit | 144 | daily-practice-rule | 120 | 2/2 |

### Math.* isolation (second pass, only where a divergence was found)

- **firefox / cruise-baseline / 30 Hz**: first state divergence at tick 554. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2401 ticks, first @1), hypot (2050 ticks, first @1), sin (20 ticks, first @487), atan2 (139 ticks, first @543), cos (26 ticks, first @580), tan (3 ticks, first @626). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 591 m / score 876.
- **firefox / fifth-run-in-session / 30 Hz**: first state divergence at tick 489. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (1801 ticks, first @1), hypot (1592 ticks, first @1), atan2 (107 ticks, first @300), cos (15 ticks, first @511), tan (2 ticks, first @575), sin (17 ticks, first @636). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1801 ticks / 472 m / score 717.
- **firefox / collision-heavy / 30 Hz**: first state divergence at tick 580. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (1669 ticks, first @1), hypot (1462 ticks, first @1), sin (12 ticks, first @2), atan2 (109 ticks, first @3), cos (13 ticks, first @404), tan (1 ticks, first @681). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1669 ticks / 289 m / score 399.
- **firefox / chunk-biome-boundaries / 30 Hz**: first state divergence at tick 373. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (3217 ticks, first @1), hypot (673 ticks, first @1), cos (6 ticks, first @304), atan2 (105 ticks, first @427), tan (3 ticks, first @722), sin (5 ticks, first @922). At the divergent tick: atan2, cos, exp, tan. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 3431 ticks / 835 m / score 1175.
- **firefox / bsod-pursuit-catch / 30 Hz**: first state divergence at tick 764. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (12150 ticks, first @1), hypot (1910 ticks, first @1), cos (32 ticks, first @326), sin (36 ticks, first @375), atan2 (206 ticks, first @375), tan (3 ticks, first @1579). At the divergent tick: exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 12150 ticks / 437 m / score 0.
- **firefox / airborne-tricks / 30 Hz**: first state divergence at tick 255. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2224 ticks, first @1), hypot (1897 ticks, first @1), atan2 (410 ticks, first @240), cos (39 ticks, first @255), sin (34 ticks, first @258), tan (2 ticks, first @623). At the divergent tick: hypot, cos, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2224 ticks / 513 m / score 2428.
- **firefox / parachute-airbrake / 30 Hz**: first state divergence at tick 523. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2146 ticks, first @1), hypot (1855 ticks, first @1), atan2 (417 ticks, first @240), sin (47 ticks, first @285), cos (37 ticks, first @312), tan (2 ticks, first @564), tanh (4 ticks, first @1275). At the divergent tick: atan2, hypot, cos, sin, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2146 ticks / 332 m / score 790.
- **firefox / kodiaks-on / 30 Hz**: first state divergence at tick 586. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2637 ticks, first @1), hypot (1644 ticks, first @1), sin (23 ticks, first @493), cos (19 ticks, first @563), atan2 (164 ticks, first @564), tan (3 ticks, first @666). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2637 ticks / 606 m / score 991.
- **firefox / daily-practice-rule / 30 Hz**: first state divergence at tick 484. Ops that returned different results for identical arguments (vs chromium-headless-shell): exp (2401 ticks, first @1), hypot (1416 ticks, first @1), cos (8 ticks, first @286), sin (22 ticks, first @305), atan2 (200 ticks, first @473), tan (3 ticks, first @662). At the divergent tick: atan2, hypot, exp. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); exp(-0.1388888888888889): ref 0.8703247258333905 vs 0.8703247258333906 (1 ulp, tick 1); hypot(47.877867321923866, 21.67922875311475): ref 52.55738900122058 vs 52.557389001220585 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 724 m / score 1399.
- **webkit / cruise-baseline / 30 Hz**: first state divergence at tick 971. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (805 ticks, first @1), sin (7 ticks, first @552), atan2 (2 ticks, first @1150). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(16, 6.9634642610001265): ref 17.44963708832439 vs 17.449637088324387 (1 ulp, tick 971).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 591 m / score 876.
- **webkit / fifth-run-in-session / 30 Hz**: first state divergence at tick 714. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1564 ticks, first @1), tan (1 ticks, first @320), sin (5 ticks, first @487), atan2 (59 ticks, first @601). At the divergent tick: atan2, hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); atan2(2.8302191711541127, 16): ref 0.1750776524532713 vs 0.17507765245327134 (1 ulp, tick 714).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1801 ticks / 472 m / score 717.
- **webkit / collision-heavy / 30 Hz**: first state divergence at tick 732. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1439 ticks, first @1), sin (4 ticks, first @577), tan (1 ticks, first @1399). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(533.6686953810204, 128.47531104640439): ref 548.9154597733159 vs 548.9154597733158 (1 ulp, tick 732).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 1669 ticks / 289 m / score 399.
- **webkit / chunk-biome-boundaries / 30 Hz**: first state divergence at tick 373. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (69 ticks, first @1), tan (2 ticks, first @1890), atan2 (8 ticks, first @2534). At the divergent tick: atan2, hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); atan2(-1.9717379290929244, 16): ref -0.1226154137517952 vs -0.12261541375179519 (1 ulp, tick 373).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 3431 ticks / 835 m / score 1175.
- **webkit / bsod-pursuit-catch / 30 Hz**: first state divergence at tick 508. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1486 ticks, first @1), sin (4 ticks, first @1814), atan2 (306 ticks, first @2066), tan (1 ticks, first @5839). At the divergent tick: none identified. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 12150 ticks / 437 m / score 0.
- **webkit / airborne-tricks / 30 Hz**: first state divergence at tick 2054. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (1870 ticks, first @1), sin (11 ticks, first @593), tan (1 ticks, first @1154), cos (3 ticks, first @1418), atan2 (40 ticks, first @1682). At the divergent tick: hypot, atan2. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(629.4983482544334, 140.981949350182): ref 645.0923038586318 vs 645.0923038586317 (1 ulp, tick 2054).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2224 ticks / 513 m / score 2428.
- **webkit / parachute-airbrake / 30 Hz**: first state divergence at tick 696. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (818 ticks, first @1), atan2 (17 ticks, first @316), sin (2 ticks, first @522). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(661.3997491626651, 101.41190964944143): ref 669.1292876650841 vs 669.129287665084 (1 ulp, tick 696).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2146 ticks / 332 m / score 790.
- **webkit / kodiaks-on / 30 Hz**: first state divergence at tick 796. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (2250 ticks, first @1), sin (16 ticks, first @580), atan2 (10 ticks, first @866), tan (2 ticks, first @1360). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877918718550305, 20.179817779375117): ref 51.95690662875239 vs 51.956906628752385 (1 ulp, tick 2); hypot(620.828510987958, 101.1304687620577): ref 629.0114559907145 vs 629.0114559907146 (1 ulp, tick 796).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2637 ticks / 606 m / score 991.
- **webkit / daily-practice-rule / 30 Hz**: first state divergence at tick 19. Ops that returned different results for identical arguments (vs chromium-headless-shell): hypot (39 ticks, first @1), atan2 (6 ticks, first @662), sin (1 ticks, first @1417). At the divergent tick: hypot. Examples: hypot(47.940986743409724, 14.200767235196157): ref 50.00000000000007 vs 50.00000000000008 (1 ulp, tick 1); hypot(47.877867321923866, 21.67922875311475): ref 52.55738900122058 vs 52.557389001220585 (1 ulp, tick 2); hypot(16, 6.956997999374835): ref 17.4470576649275 vs 17.447057664927502 (1 ulp, tick 19).
  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): NO divergence over the whole run (digests identical); final outcome 2401 ticks / 724 m / score 1399.

### Session-position and repeat checks

For every engine, cadence and fixture, all runs gave one identical digest roll regardless of position in the session (runs 1-10) and across the two fresh contexts, including the repeat of run 1 at the end of each session.

Rows: 400 (400 ok, 0 errors). Raw JSON: `docs/determinism/results/cross-engine-results.json`. Generated 2026-11-21T19:12:24.175Z from commit aba63e0e56417192fe937a78b80c30f42a144bd0.
<!-- END GENERATED -->
