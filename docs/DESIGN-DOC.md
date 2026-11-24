# **Bitstream Bluffs**

*A downhill‑only, neon‑soaked, trick‑and‑race slice of* ***SledHEAD***

---

## 1. Game Pillars

| #                               | Immutable Principle                                                                                                                                                             | Why It Exists |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **1. Flow State First**         | Every action (tilt, trick, bounce) pushes players toward an unbroken *flow* of carve ➜ air ➜ land. If a feature kills momentum, it’s out.                                       |               |
| **2. Readable Chaos**           | Levels look wild—glitches, laser‑edges, data vents—but silhouettes & hit‑boxes stay crystal‑clear so players always know why they crashed or scored big. Simple retro graphics. |               |
| **3. One‑More‑Run Loop ≤ 10 s** | Boot, sledge, explode, restart in under 10 seconds. Instant retry keeps the “just one more” addiction alive.                                                                    |               |
| **4. Tricks Reward Risk**       | Style counts: harder air‑control & combo timing = exponentially higher score multipliers. If you play safe you finish farther, but leaderboard kings live on the edge.          |               |
| **5. Seeded But Surprising**    | Procedural seeds guarantee shareable runs; layered glitches & optional daily patch rules keep even identical seeds feeling slightly “alive.”                                    |               |

---

## 2. Visual & Tech Spec

| Aspect                  | Detail                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Art Style**           | 1‑bit–outline *Tron*‑wireframe plus neon fill ( cyan,  magenta,  lime,  amber). 16×16→128×128 pixel tiles; upscale w/ **xBRZ** or **EPX** to preserve crispness is a sprite-based stretch goal. For this prototype, use artistically arranged basic shapes instead of sprites to begin with - I'll replace them with sprites during a final art pass, if it's needed. |
| **Glitch VFX**          | Every 3–6s trigger a **visual glitch event** (shader‑based RGB split + scanline wobble is one example) & **audio drop‑out or static** (50–200 ms). Seeds decide pattern so runs are deterministic.                                                                                                                                                                        |
| **Asset Pipeline**      | Stretch goal is Aseprite → 8‑frame PNG strips → TexturePacker → **Phaser 3.80 Spine** runtime (skeletal for rider) + spritesheets for terrain/hazards. All exported under `/assets/…`. This prototype should use artistically arranged shapes rather than sprites.                                                                                                        |
| **Audio**               | 48 kHz **.ogg**; FM‑chip synth base, side‑chain ducked to SFX. Separate *“glitch bus”* applies bit‑crush & stutter during VFX events. For this prototype, just make the sounds programmatically.                                                                                                                                                                          |
| **Resolution & Camera** | Virtual canvas 480 × 270 (16 × 9). Pixel‑perfect camera scaled to device.                                                                                                                                                                                                                                                                                                 |

---

## 3. Target Platforms & Performance

| Platform                   | Goal FPS                                                                                                               | Notes |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| **PC (Win/Linux/macOS)**   | 60 FPS target & hard‑cap  (V‑sync off) to avoid logic runaway.                                                         |       |
| **Steam Deck**             | 40 FPS battery mode / 60 FPS plugged. Verified Deck Input glyphs.                                                      |       |
| **Mobile (iOS & Android)** | 30 FPS floor on mid‑range 2020 phones. **Gamepad first** (Bluetooth), fallback: on‑screen overlay mirrors WASD/Arrows. |       |

Performance Guard‑Rails

* Dynamic timestep capped at 8 ms.
* Terrain chunk pool (object‑recycle).
* WebGL 2 mandatory; canvas fallback omitted.

---

## 4. Core Mechanics

### 4.1 Input Map

```
W – Push Forward (only when velocity < 10 px/s & slope ≥ –5°)
A / D – Tilt Back / Forward (air & ground lean)
S – Brake (ground friction++ or aerial angular‑damp)
A+D – Tuck (reduces drag, −15% gravity scale)
Space – Hop / Bump Jump
Shift – Emergency Reset (respawn on last safe ground, –1 combo)
←/→ – Helicopter CCW/CW (style)
↑ – Air Brake (throw sled → decel 25%, reduces descent)
↓ – Parachute Stall (gravity half for 0.8 s, steer locked)
Esc/Pause – Pascal’s Ledger menu
```

### 4.2 Physics Tuning

| Parameter          | Value                                                 | Rationale                                              |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------ |
| Gravity            | 900 px/s²                                             | Heavier than Alto; snappy airtime.                     |
| Max Tilt Torque    | 420 deg/s²                                            | Lets players spin 540° within average airtime.         |
| Drag (untucked)    | 0.015                                                 | Allows speed retention on gentle slopes but not flats. |
| Air Control Factor | 0.7                                                   | Air tilt less effective than ground lean.              |
| Collision          | SAT on convex hull; sled & rider share compound body. |                                                        |

---

## 5. Procedural Track Generation

| Method                                                   | Pros                                | Cons                                                                         | Verdict                                   |
| -------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
|                                                          |                                     |                                                                              |                                           |
| **Spline‑Driven** (Bezier curves w/ control‐point noise) | Smooth flow, tunable slopes/airtime | Requires post‑process mesh; potential impossible landings if slope too steep | Best for *medium‑length* runs—core loop   |
| **Pure Noise** (Perlin 1‑D heightmap)                    | Infinite variety, zero art cost     | Chaotic readability; hard to guarantee landable bumps                        | Use *sparingly* for end‑game glitch zones |

**Hybrid Recipe** (recommended)

1. **Seed** → deterministic PRNG
2. **Spline Segment Pack** x N (length escalates; each seeded for angle/height variance)
3. **Noise Zone** (difficulty spike)
4. Loop steps 2–3 until player wipe‑out.

Terrain exported as **polyline JSON** → triangulated in‑engine for ground mesh & collision.

---

## 6. Systems Design

### 6.1 Scoring

* **Distance**: +1 pt per meter.
* **Trick Value**: base × rotation × airtime modifier.
* **Combo Multiplier**: begins ×1; +0.25 per unique trick before landing; resets on landing.
* **Style Bonus**: Perfect Landing (+20).
* **Ledger Entries**: On death, the score stored in local IndexedDB.

### 6.2 Leaderboard

* **Initials (3 chars, though we may make it more later, so make either work)** input on Top‑10.
* Stored per‑device; optional “export sharecode” (JSON).
* **Daily Patch Rule (stretch goal)**: at 00:00 UTC, one movement rule toggles (e.g., *Tuck grants +50% speed, but steering −50%*). Applies to all runs; leaderboard flag shows rule id.

### 6.3 Stretch-goal optional Roguelite Meta

* Unlock **Cosmetic Glows** & **Start‑Speed Boosts** with “Data Shards” collected after crashes. No meta power that trivializes core skill curve.

---

## 7. Content Spec

| Category            | Examples                                                                                                      | Behavior                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Hazards**         | *Glitch Chasm*, *Overflow Firewall*, *Packet Spike*, *Garbage‑Data Vent*                                      | Instant crash, OR speed cut, OR physics scramble for 2 s |
| **Terrain Mods**    | High Bandwith Zones (low friction), Compression Zones (higher gravity), Wireless Bridges (gap w/ bounce pads) | Affect physics; telegraph via color coding               |
| **Power‑Ups**       | **Clock Pulse** (+1 s slo‑mo), **Packet Burst** (+30% speed 3 s), **Hashed Backup** (negate 1 crash)          | Spawn probability scales inverse to current distance     |
| **Difficulty Ramp** | Slope variance ↑, hazard density ↑, glitch VFX frequency ↑ for seeds > 1000 m distance                        |                                                          |

---

## 8. Technical Architecture

```
src/
 ├─ main.ts            ← boot, config
 ├─ scenes/
 │   ├─ PreloadScene
 │   ├─ RunScene
 │   ├─ PauseScene
 │   └─ UIScene
 ├─ systems/
 │   ├─ InputRouter.ts       ← gamepad / KB&M / touch
 │   ├─ TerrainGenerator.ts  ← hybrid generator
 │   ├─ PhysicsTuner.ts      ← exposes tweaked constants
 │   └─ ScoreManager.ts
 ├─ data/
 │   ├─ chunks/*.json        ← chunk polyline & metadata
 │   ├─ hazards/*.json       ← ScriptableObject‑style defs
 │   └─ palettes.json
 └─ shaders/
     └─ glitch.frag
```

* **Scene Streaming**: TerrainGenerator keeps a 3‑screen buffer ahead; destroys 2‑screens behind.
* **ScriptableObjects**: Plain JSON; each hazard defines sprite key, collision size, onHit effect, weight.
* **Input Abstraction**: Digital & analog unified to `VirtualPad` object → emits `move`, `tilt`, `trick` events.
* **Data‑Driven Seeds**: `seed` param hashed via xxHash → PRNG state for terrain & glitch event schedule.
* **Save**: LocalStorage `settings`, IndexedDB `runs`, no cloud.

---

## 9. UX & Juice

| Feature             | Implementation                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| **Camera**          | Lerp follow X + anticipation look‑ahead; Y drifts to keep ⅓ screen above rider.                        |
| **Screen Shake**    | Per‑pixel RNG jitter on hard land or crash.                                                            |
| **Global Glitch**   | Full‑screen shader + audio bus stutter - every 5-15 seconds.                                           |
| **Particle Trails** | Neon ribbon behind sled; hue shifts with speed.                                                        |
| **UI**              | Score top‑left, combo top‑right; subtle scanline background; Ledger hash & share‑seed on death screen. |

Accessibility: color‑blind palette swap, screen‑shake toggle, 90 ° tilt‑controls for mobile.

---

## 10. Production Roadmap

| Phase                        | Duration | Exit Criteria                                                  |
| ---------------------------- | -------- | -------------------------------------------------------------- |
| **Prototype**                | 4 wks    | Gravity sled, tilt, single procedural hill, restart loop ≤10 s |
| **Vertical Slice**           | 8 wks    | Core VFX, 4 hazards, chunk+noise hybrid, local leaderboard     |
| **Alpha**                    | 6 wks    | All hazards + power‑ups, full art set, Deck verification       |
| **Beta**                     | 4 wks    | Performance pass, accessibility, mobile overlay                |
| **Release (Steam + Mobile)** | 2 wks    | Leaderboards stable, marketing assets, Steam achievements      |
| **Post‑Launch**              | ongoing  | Daily patch rules, cosmetic DLC, mod‑support docs              |

---

## 11. Future‑Proofing Notes

* **Mod‑Ready Folders**: `/mods/terrain`, `/mods/hazards`, `/mods/shaders` hot‑loaded in dev builds.
* **Data‑Driven Everything**: No hazard or chunk hard‑coded; new JSON → pick‑up on boot.
* **Save Migration**: Use versioned JSON; unknown keys ignored, enabling forward compatibility.

---

## 12. Default Keyboard Mapping (Ship‑Ready)

| Key       | Action            | Notes                                               |
| --------- | ----------------- | --------------------------------------------------- |
| **W**     | Propel / Push     | Flat/upslope kick; disabled in air and on downslope |
| **A**     | Tilt Back         | CCW rotation                                        |
| **D**     | Tilt Forward      | CW rotation                                         |
| **S**     | Tuck              | Aerodynamic form                                    |
| **←**     | Helicopter CCW    | Style                                               |
| **→**     | Helicopter CW     | Style                                               |
| **↑**     | Air Brake         | Horizontal Decelerate                               |
| **↓**     | Parachute Stall   | Float                                               |
| **Space** | Hop               | Terrain bump jump                                   |
| **Shift** | Emergency Recover | Respawn, –score                                     |
| **Esc**   | Pause / Ledger    | Menu                                                |

Gamepad mirrored (Left Stick = tilt, Right Trigger = push, Face Buttons = tricks). Touch overlay maps to same virtual buttons.

---

### **Go code the carve.** 🛷⚡
