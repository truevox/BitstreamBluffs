# Bitstream Bluffs

**Ride the glitch. Raise a brain. Race what you've created.**

[Play the pre-alpha](https://simulate.sledhead.ing/) · [Changelog](CHANGELOG.md) · [Issue roadmap](https://github.com/truevox/BitstreamBluffs/issues) · [Design document](docs/DESIGN-DOC.md)

Bitstream Bluffs is a local-first, browser-based downhill sledding, trick and racing game with a neon arcade aesthetic, procedural mountains, and a pursuing wall of corrupted data (the BSOD). Carve, hop, flip, helicopter, corkscrew, tuck, divebomb and parachute your way down increasingly strange terrain. Chase distance and tricks, earn progression and upgrades, race ghosts, and explore the mountain's secrets.

The longer-term project adds **AlphaBluffs**: real artificial-life training, an idle/incremental game driven by frozen neural pilots, and a community exchange for brains and runs. It is one game with shared deterministic physics, not a collection of unrelated simulations.

> **Pre-alpha:** Ride is playable. AlphaBluffs, public competitions and creator services are future scope. This document describes the intended product as well as the current build; it is not a promise that every roadmap idea has been implemented or approved for release. The changelog and linked issues are authoritative for exact release and review status.

## Playable now

- **Ride:** seeded downhill courses, trick combos, speed/risk tradeoffs, moving hazards, BSOD chase, practice/gym tools, nonlethal Kodiak rivals, and an expanding biome campaign. Start in Debutmont; encounter distinct mountain identities and Arcade bridges.
- **Progression:** pilot profile, Sync Levels/XP, missions, achievements, cosmetics, permanent equipment upgrades, consumable boosts and a Shard shop. Local records distinguish ordinary, Daily and modified runs. Economy terminology and balancing may change before launch.
- **Daily:** date-seeded Daily Run and equipment-budget Daily Draft, with deterministic course/rule selection and local scoreboards.
- **Ghosts and replay:** same-course Best, Latest and up to three Favorites, purchased course archive slots, local evidence storage, guest ghost sharing via link/file, replay takeover for unranked practice/TAS, Playable Postcards with reproducible challenge prefixes, Cemetery Montage/Graveyard Swarm, and Crash Coach/Butterfly Meter. See [#56](https://github.com/truevox/BitstreamBluffs/issues/56), [#66](https://github.com/truevox/BitstreamBluffs/issues/66), [#67](https://github.com/truevox/BitstreamBluffs/issues/67), [#68](https://github.com/truevox/BitstreamBluffs/issues/68), [#69](https://github.com/truevox/BitstreamBluffs/issues/69), [#72](https://github.com/truevox/BitstreamBluffs/issues/72).
- **Music and presentation:** Maxi's 33-song soundtrack, original-stem processing and biome-specific audio identities, jukebox and crossfades, BSOD proximity and gameplay-reactive sound, music-linked billboards and scenery (World Dance), CRT arcade menus, customizable presentation and reduced-motion settings. The versioned music host has a bundled four-song fallback. Maxi is the only soundtrack artist currently represented; other Frequency host packs are planned.
- **Platform:** keyboard layouts, gamepad and touch support (full parity is still a work item), browser persistence, install metadata and cooperative PWA updating. Full reliable offline operation and optional offline music download remain work in progress. The designated pre-alpha playtest host has temporary opt-out telemetry; public-launch collection policy is not established.

## The full vision

### Three core experiences

| Experience | What you do | Current state |
| --- | --- | --- |
| **Ride** | Personally ride, race and perform tricks; explore and progress. | Playable; ongoing expansion and balancing |
| **Autopilot / Idle** | Deploy an immutable neural pilot, watch real runs, earn eligible rewards, manage equipment and optionally automate purchases. | Planned |
| **Evolution Lab** | Create Boltzmann (or name your own brain), train real policies, experiment, compare champions, freeze snapshots and explicitly deploy them. | Spec/prototype groundwork; not playable |

Autopilot progresses the **equipment**, not the brain. The deployed neural snapshot stays frozen until the player explicitly replaces it. Evolution Lab progresses **intelligence** with real simulation. Accelerated training never creates ordinary gameplay currency, achievements or ranked results. Closing the browser pauses Lab training; planned offline Shard Racing settles separately modeled local race results using evidence from the same deployed brain and comparable equipment, never pretending actual physics ran while closed.

See the [AlphaBluffs epic #23](https://github.com/truevox/BitstreamBluffs/issues/23), [training simulator #24](https://github.com/truevox/BitstreamBluffs/issues/24), [player experience #25](https://github.com/truevox/BitstreamBluffs/issues/25), [integrated spec #42](https://github.com/truevox/BitstreamBluffs/issues/42) and [offline Shard Racing #48](https://github.com/truevox/BitstreamBluffs/issues/48). The detailed cross-mode RFC remains draft [#61](https://github.com/truevox/BitstreamBluffs/pull/61).

### Evolution and competition

- Real deterministic training and held-out evaluation: neural evolution, compatible optimization methods, human demonstrations and eventual reinforcement learning; track actual training method/ancestry and honest resource budgets.
- **MAP-Elites** behavioral maps, **Novelty Search** and **Population-Based Training** as first-class Lab mechanisms ([#43](https://github.com/truevox/BitstreamBluffs/issues/43), [#44](https://github.com/truevox/BitstreamBluffs/issues/44), [#45](https://github.com/truevox/BitstreamBluffs/issues/45)). **Exploit Hunter** rewards genuinely unusual behavior, retains reproducible discoveries and feeds the Museum of Bad Physics/Glitch Bounties.
- **Sim-Slots and Power Potions:** concurrent actual simulation environments, renewable free training time and optional additional throughput/time purchases subject to real device capacity; not pay-to-win eligibility ([#46](https://github.com/truevox/BitstreamBluffs/issues/46)).
- **Ride Like Me:** teach a brain with explicitly selected personal runs, then race its frozen, independently evaluated ghost. Community demonstrations are opt-in and permissioned ([#144](https://github.com/truevox/BitstreamBluffs/issues/144), [#58](https://github.com/truevox/BitstreamBluffs/issues/58), [#110](https://github.com/truevox/BitstreamBluffs/issues/110)).
- **Daily Brain Cup**, Open Evolution, Evolution Draft (training budget, stock gear), Daily Draft (equipment budget) and All Dressed (both budgets); clearly separate stock/upgraded categories, blind exams and human/AI/TAS results. Local-first before public rankings; a public daily seed is not a blind test ([#27](https://github.com/truevox/BitstreamBluffs/issues/27), [#41](https://github.com/truevox/BitstreamBluffs/issues/41)).
- Further research includes generalist RL, Go-Explore, counterfactual credit assignment, model-predictive assistance, adversarial Kodiaks and mountain/AI co-evolution ([determinism roadmap #151](https://github.com/truevox/BitstreamBluffs/issues/151)).

### Community, creators and The Frequency

- **Brain Bazaar:** opt-in publish/download/fork of compatible immutable brains, ghost tapes and course seeds as separate artifact types. No artificial power ceiling for community brains; only the bundled starter is deliberately beginner-friendly. Preserve provenance, compatibility, attribution, consent and reuse rights ([#40](https://github.com/truevox/BitstreamBluffs/issues/40), [#58](https://github.com/truevox/BitstreamBluffs/issues/58), [#60](https://github.com/truevox/BitstreamBluffs/issues/60)).
- **Bluff Codes:** compact challenge references combining a course and exact brain, with optional equipment/challenge conditions; build on existing ghost links and postcards. Optional Pascal's Ledger birth/milestone or course commitments, not mandatory payments ([#29](https://github.com/truevox/BitstreamBluffs/issues/29), [#40](https://github.com/truevox/BitstreamBluffs/issues/40), [#60](https://github.com/truevox/BitstreamBluffs/issues/60)).
- **Creator Studio:** OBS-friendly layouts and overlays, cinematic cameras, Photo Mode, replay editing, shareable highlights and beat-synchronized video exports. **Evolution Reel** turns authentic early/intermediate/late training tapes into a short branded music montage ([#62](https://github.com/truevox/BitstreamBluffs/issues/62), [#63](https://github.com/truevox/BitstreamBluffs/issues/63), [#73](https://github.com/truevox/BitstreamBluffs/issues/73), [#107](https://github.com/truevox/BitstreamBluffs/issues/107), [#234](https://github.com/truevox/BitstreamBluffs/issues/234)).
- **Audience-controlled evolution:** optional Twitch/audience votes on fitness and candidate selection at generation boundaries, with creator control and provenance; never direct manipulation of ranked physics or rewards ([#421](https://github.com/truevox/BitstreamBluffs/issues/421)).
- **The Frequency:** future character music packs and radio playlists, plus independently selectable host announcers for real gameplay/training milestones. Listen to one host's music and choose another host's voice (e.g. Stella); optional follow-current-host, off, independent volume and frequency. Maxi's current music is not a restriction on future artist or announcer choice ([#28](https://github.com/truevox/BitstreamBluffs/issues/28)).
- Additional replay/gameplay research covers daily mountain curation, constraint challenges, machine medals, glitch bounties, skill maps, time/route experimentation, ghost pelotons and live racing. The [83-opportunity index #151](https://github.com/truevox/BitstreamBluffs/issues/151) tracks candidates, not automatic implementation approvals.

## Major work status

Status is a snapshot of the documented repository scope, not a live task board. An open issue may have merged partial work; a research proposal is not an implementation commitment.

| Area | State | Remaining major work |
| --- | --- | --- |
| Core Ride, progression, Daily, local replay | **Playable** | Balance, controls parity, biome polish, onboarding, trick-flow tuning; [#157](https://github.com/truevox/BitstreamBluffs/issues/157), [#210](https://github.com/truevox/BitstreamBluffs/issues/210), [#211](https://github.com/truevox/BitstreamBluffs/issues/211), [#231](https://github.com/truevox/BitstreamBluffs/issues/231) |
| Deterministic engine and developer QA | **Implemented foundations / active** | More stress tests, throughput, sensitivity and automated analysis; [#151](https://github.com/truevox/BitstreamBluffs/issues/151), [#122](https://github.com/truevox/BitstreamBluffs/issues/122), [#134](https://github.com/truevox/BitstreamBluffs/issues/134) |
| Heavy Mode / trusted savestates | **In progress** | Native causal-state codecs and restore diagnostics exist; complete persisted world, atomic restore and player Save/Resume remain unshipped; [#119](https://github.com/truevox/BitstreamBluffs/issues/119) |
| Public verification and competitive services | **In progress, server references only** | Local protected evidence, signed admission and wallet/entitlement reference code exist; blind peer coordinator and Mario Maker-style local creator-clear gate also exist as **server-only reference code**, but actual public API, accounts/issuers, hosted peer execution, rank/reward settlement and consent rollout remain unshipped; [#135](https://github.com/truevox/BitstreamBluffs/issues/135), [#136](https://github.com/truevox/BitstreamBluffs/issues/136) |
| PWA and audio delivery | **In progress** | Install/update foundations and soundtrack delivery exist; finish reliable offline shell/music, device testing and audio refinements; [#172](https://github.com/truevox/BitstreamBluffs/issues/172), [#180](https://github.com/truevox/BitstreamBluffs/issues/180), [#312](https://github.com/truevox/BitstreamBluffs/issues/312), [#342](https://github.com/truevox/BitstreamBluffs/issues/342) |
| Retention/replay extensions | **Mixed / active** | Exploit Factory is merged developer tooling; additional Museum, curated Daily, Run DNA, race and challenge extensions are not all complete; [#76](https://github.com/truevox/BitstreamBluffs/issues/76), [#85](https://github.com/truevox/BitstreamBluffs/issues/85), [#168](https://github.com/truevox/BitstreamBluffs/issues/168) |
| AlphaBluffs training, Lab and Idle | **Specified; not yet implemented as playable modes** | Real worker throughput, policy/model ABI, evidence, training algorithms, frozen runtime and idle economy; [#23](https://github.com/truevox/BitstreamBluffs/issues/23), [#24](https://github.com/truevox/BitstreamBluffs/issues/24), [#25](https://github.com/truevox/BitstreamBluffs/issues/25), [#42](https://github.com/truevox/BitstreamBluffs/issues/42) |
| Brain Bazaar, shared competitions, Bluff Codes | **Planned; not started as product services** | Publish/import contracts, compatibility, moderation, hosted resolution, verified public rankings; [#40](https://github.com/truevox/BitstreamBluffs/issues/40), [#27](https://github.com/truevox/BitstreamBluffs/issues/27) |
| Creator Studio, Evolution Reel, audience control | **Planned; not implemented as features** | Video/OBS and replay export, milestone capture, audience adapters; [#62](https://github.com/truevox/BitstreamBluffs/issues/62), [#421](https://github.com/truevox/BitstreamBluffs/issues/421) |
| Frequency packs and host announcers | **Planned; not started as player features** | Other artist packs, voice lines, independent soundtrack/announcer controls; [#28](https://github.com/truevox/BitstreamBluffs/issues/28) |

## Running and developing locally

Built with Phaser 3.90, Matter physics, Vite and JavaScript. Use a supported Node.js release (Node 22 for current server-reference checks), npm and Chromium for browser QA.

```sh
npm ci
npm run dev                     # Vite dev server (port 5173)
npm run build                   # production build to dist/
npm run preview                 # preview the production build
npm test -- tests/src           # current-game unit tests
npm run sim -- --seeds 24 --policy handsOff --out result.json
```

The full Jest suite also includes historical tests under `tests/`; see the changelog and CI for actual baseline/test results. Browser tools use Playwright/Chromium; install the required browser with `npx playwright install chromium` if necessary.

### Controls

The default keyboard layout is **Tricks Right**; Tricks Left and Classic are available. Menu controls are independent of the run layout.

| Action | Tricks Right (default) | Tricks Left |
| --- | --- | --- |
| Frontflip / forward tilt | Up | W |
| Backflip / backward tilt | Down | S |
| Helicopter | Right | D |
| Corkscrew | Left | A |
| Parachute | W | Up |
| AirBrake / ground brake | A | Left |
| Divebomb | S | Down |
| Tuck | D | Right |
| Hop | Space | Space |
| Emergency reset | Shift | Shift |
| Pause | Esc | Esc |

Gamepad and touch are supported; consult in-game controls for available actions. Gamepad/touch parity is tracked in [#211](https://github.com/truevox/BitstreamBluffs/issues/211). Source: [ControlLayouts](src/systems/ControlLayouts.js) and [InputRouter](src/systems/InputRouter.js).

### Simulation and trust

The authoritative game uses a fixed **120 Hz** simulation tick with seeded RNG, separate presentation randomness, versioned rulesets and tick-indexed input tapes. Compatible same-build replays can be independently resimulated; a seed alone is not always a complete course identity (biome mask, rules and equipment matter). A local hash or visual ghost alone is not public competitive proof.

`tools/sim/` drives the real game in headless Chromium for repeatable batch experiments. Example policies include handsOff, hop, flip, stallProbe and terrain (terrain generation only); use `--workers`, `--maxM`, `--maxSec`, `--seedPrefix`, and `--verify`. The separate Exploit Factory compares scripted policies on paired seeds. These are developer harnesses, **not** the finished neural trainer or public verifier.

Replay takeovers, postcards, guest practice and training simulations do not earn official Ride progression/rank. Public verification is not yet active; local records and experimental/AI/TAS evidence must remain honestly labeled. Pre-release architecture preserves version identity without promising historic tape playback.

### Repository layout

- `src/` — current game; `src/main.js` is the entry point and [src/ARCHITECTURE.md](src/ARCHITECTURE.md) describes module contracts.
- `src/systems/` — simulation clock, physics, terrain, progression, input, audio, save, replay, trust and related systems.
- `src/scenes/`, `src/entities/`, `src/ui/`, `src/data/`, `src/shaders/` — Phaser gameplay, content and presentation.
- `public/` — static assets, manifest and bundled music/fallback content; additional soundtrack delivery is versioned separately.
- `tools/` — simulation, replay and other development/QA tooling.
- `server/` — experimental server-reference work; not a live public competition backend.
- `tests/src/` — current-game tests; `js/` and historical tests are legacy reference, not loaded by the current game.
- `docs/` — design, engineering and experiment records. [CHANGELOG.md](CHANGELOG.md) records release slices and limitations.

### Contributing and releases

See [AGENTS.md](AGENTS.md) for engineering/release conventions and the [Netlify preview budget](docs/engineering/netlify-preview-budget.md). Every merge to main is a release: coordinate version, changelog and exact-head review. New PR titles must include `[skip netlify]` unless explicitly authorized under the budget policy. Use the current issue and test evidence before claiming a feature shipped.

