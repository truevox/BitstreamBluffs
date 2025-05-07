Bitstream Bluffs: Cold Booting Debumont – A SledHEAD Simulation
Complete Design Document (v0.2 – revised for longer loop & four defined tricks)

🚀 Game Pillars (Immutable)
#	Pillar	Explanation
1	Carve or Crash	Downhill‑only, momentum‑driven sledding. No uphill, no brakes—master the slope or eat snow‑static.
2	Every Run a Story	A seed starts it; a Pascal’s Ledger hash ends it. Each session is a tiny legend you can share verbatim.
3	Glitch Is Gospel	Visual, audio, and even physics corruption are celebrated, not hidden. Bit‑rot is part of the aesthetic.
4	Portable Core	All game logic is engine‑agnostic so it can be transplanted to Unity, Cocos, or anything else later.
5	Fail Fast, Then Flow	Boot‑in → sled as long as you can (1–5 min target) → spectacular crash → instant restart. Total downtime between crash and new ride ≤ 10 seconds.

Clarification: “Boot‑sledge‑explode loop ≤ 10 s” refers only to restart friction—the time between death and new sled on slope. The playable run itself is intended to last 1‑3 minutes on average, up to 5 minutes for talented riders.

🧠 Core Gameplay
1. Physics‑Driven Sledding (2D Side‑Scrolling)
Gravity, slope angle, drag, and air‑resistance all simulated in SledPhysicsEngine.js.

Collision with terrain edges and hazards.

Camera auto‑scrolls; player can’t stall the screen.

2. Defined Trick Set
Trick	Input Pattern	Effect	Scoring Note
Helicopter (CW)	Hold Right while airborne; complete ≥ 360° clockwise spin	Pure style (no physics change)	Base score + rotation multiplier
Helicopter (CCW)	Hold Left while airborne; ≥ 360° counter‑clockwise spin	Pure style	Same scoring rules; separate trick ID
Air Brake	Hold Down mid‑air	Sled swings behind rider, sharply increases drag (slowdown)	Opens tactical short‑landing routes
Parachute	Press Jump/Tuck once in air, then hold Up	Deploys glitch‑parachute sprite, slightly increases hang‑time	Enables longer combo chains

Trick detection lives in TrickDetector.js. Combos multiply score if performed in one airtime window.

3. Procedural Terrain & Hazards
Terrain slice built deterministically from seed:

Hazard	Behavior
Firewall Gate	1‑tile barrier; pass when color matches flicker or fry instantly
Glitch Node	Inverts gravity or flips terrain normals for N seconds
Bitstream Rail	Magnetizes sled forward; speed boost, can chain tricks
Data Chasm	Gap between slices; requires jump, rail, or parachute

🎨 Art & Aesthetic
Palette: 1‑bit base (black/white) with neon accents (#39FF14 green, #FF003C red, #A03CFF purple).

Tiles: 16×16 px; sled 32×16 px with eight animation frames.

Shaders:

ramSmear.frag – horizontal pixel bleed during high speed

bitrotNoise.frag – random bit‑flip speckles on crashes

Background: Three parallax layers populated by “memory fragments” (low‑poly cubes, scroll @ 1×/0.5×/0.25×).

🔧 Architecture & Portability
Copy
Edit
bitstream-bluffs/
├─ core/
│  ├─ SledPhysicsEngine.js
│  ├─ ProceduralTerrainGenerator.js
│  ├─ TrickDetector.js
│  ├─ RunLogger.js
│  └─ SeedManager.js
├─ phaser/
│  ├─ Renderer.js
│  ├─ InputManager.js
│  └─ SoundManager.js
├─ assets/ (sprites, palettes, shaders)
├─ tests/ (Jest)
└─ build/ (Webpack)
Core modules return plain objects—no Phaser types.

Phaser layer only renders, plays audio, collects input.

CI: GitHub Actions → lint, test, bundle (<2 MB gzipped).

Unity bridge later via WebGL or JS‑to‑C# wrappers.

🧪 Tech Stack
Purpose	Tool
Engine	Phaser 3 (ES6 modules)
Build	Babel, Webpack
Code Quality	ESLint, Prettier
Testing	Jest (≥ 90 % coverage on /core)
Versioning	Semantic commits (feat:, fix:)
Hosting	GitHub Pages (auto‑deploy)

🥅 MVP Feature Checklist
 Seed input & validation at boot

 Deterministic terrain gen from seed

 Full sled physics & collision

 Four tricks with scoring & combo logic

 Crash detection → Pascal’s Ledger hash logger

 HUD: speed, score, current seed, trick alerts

 Neon pixel‑glitch visuals + parallax layers

 Sound stubs (sled scrape, glitch pop, crash zap)

 ≤ 10 s crash‑to‑restart turnaround

When all above are solid, tag v0.1 “First Freeze” and publish.

🌱 Stretch Features
Feature	Notes
Ghost Replay	Record input stream + RNG offset; playback overlay.
Daily Seed Challenge	Seed = CRC32(YYYY‑MM‑DD); post on site.
Cloud Leaderboard	Hash + score to Cloudflare Worker (cheap).
AI Commentary Logs	Lightweight Markov text triggered by velocity & airtime.
Unlockable Visual Filters	Style milestones grant extra shader layers.

⏰ Suggested 5‑Sprint Roadmap
Sprint	Focus	Key Deliverables
0	Setup	Repo scaffold, seed UI, placeholder art
1	Terrain & Physics	Generator v1, basic sled movement
2	Tricks & Collisions	Implement 4 tricks, combo scoring
3	Crash Flow & Hash	Ledger integration, restart loop
4	Juice & Polish	Shaders, audio, README, web deploy

(Assumes ~10 hrs/week solo dev; scale as needed.)

🔌 Build / Run Commands
bash
Copy
Edit
# Install
npm install

# Dev server with hot reload
npm run dev

# Lint + tests
npm run test

# Production bundle (build/)
npm run build
Deploy build/ to any static host—tested on GitHub Pages and Netlify.

📜 README Outline (to include)
Overview & Pillars

Getting Started (Node >= 18, npm >= 9)

Script Commands

Seed Format & Examples

Contributing Guidelines (commit style, branch flow)

Porting Notes (Unity embed hints)

License (MIT suggested)

🍁 Final Notes
Run Length Reality Check: Average ride time now explicitly 1–3 minutes, skill ceiling up to 5 minutes.

Restart Speed: Keep death‑to‑sled ≤ 10 s to preserve flow.

Trick Spec: Helicopter CW, Helicopter CCW, Air Brake, Parachute—each with distinct inputs, effects, and scoring hooks.