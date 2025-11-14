# Bitstream Bluffs 🎿⚡

A neon-soaked, downhill sledding game with a 1-bit Tron-wireframe aesthetic. Ride procedurally generated mountains, perform tricks, and stay ahead of **The Bit Stream**!

## 🎮 How to Play

### Controls

#### Sled Mode (Default)
- **TAB**: Toggle between Sled and Walking modes
- **W/S**: Rotate counterclockwise/clockwise (perform rotation tricks in air)
- **A**: Drag to slow down (ground) / Air Brake trick (air)
- **D**: Tuck to accelerate (ground) / Parachute trick (air)
- **SPACE**: Jump
- **SHIFT**: Restart game
- **ESC**: Pause

#### Walking Mode
- **A/D**: Move left/right
- **SPACE**: Small jump
- **W/S**: No effect in walking mode

### Tricks & Scoring

**Tricks** (perform in mid-air):
- **Rotation**: 200 points × rotations (W/S keys)
- **Air Brake**: 150 points (A key)
- **Parachute**: 200 points (D key)

**Combo System**:
- Chain multiple tricks in one jump for bonus multipliers
- Multiplier increases by 0.25× for each unique trick
- Resets when you land

**Scoring**:
- Distance: +1 point per meter traveled
- Tricks: Base points × combo multiplier
- Blue Terrain: Bonus points while riding

### Terrain Types

- **Blue** (0x0088ff): Awards bonus points while riding
- **Green** (0x00ff44): Low friction - go faster!
- **Magenta** (0xff00aa): High friction - slows you down

### The Bit Stream

A relentless glitch wall chases you down the mountain. Keep moving or get consumed!

## 🛠️ Technical Details

### Stack
- **Phaser 3.90**: Game framework
- **Matter.js**: Physics engine
- **Vite**: Build tool and dev server
- **ES6 Modules**: Clean, modern JavaScript

### Architecture

Clean, focused implementation with minimal dependencies:

```
src/
├── main.js                 # Entry point & Phaser config
├── scenes/
│   ├── BootScene.js        # Initial boot
│   ├── PreloadScene.js     # Asset loading
│   └── GameScene.js        # Main gameplay
├── core/
│   ├── Player.js           # Player physics & controls
│   ├── TerrainGenerator.js # Procedural terrain
│   ├── TrickSystem.js      # Trick tracking & combos
│   └── ScoringSystem.js    # Score calculation
├── effects/
│   ├── Starfield.js        # Parallax background
│   └── GlitchFX.js         # Periodic glitch effects
└── utils/
    └── seedUtils.js        # Seeded random generation
```

### Features

✅ **480×270 pixel-perfect resolution** with scaling
✅ **Procedural terrain generation** with seed sharing
✅ **Three terrain types** with different physics properties
✅ **Full trick system** with combos and multipliers
✅ **The Bit Stream** chasing mechanic
✅ **1-bit Tron wireframe aesthetic** with neon colors
✅ **Parallax starfield** background
✅ **Periodic glitch VFX** (RGB split, scanlines, screen shake)
✅ **Sled/Walking mode toggle**
✅ **Seed-based random generation** for shareable runs

## 🚀 Development

### Setup
```bash
npm install
```

### Run Dev Server
```bash
npm run dev
```
Opens at `http://localhost:5173`

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## 🎨 Design Philosophy

This rebuild follows the principle of **simplicity over complexity**:

- **Single-file systems**: Each core system is self-contained
- **Minimal abstraction**: Direct, readable code over complex architecture
- **Performance-first**: Efficient rendering and physics
- **Quick iteration**: Clean structure for easy modifications

Built from the ground up following:
- `/public/docs/instructions.html` (game mechanics)
- `/docs/DESIGN-DOC.md` (technical specifications)

## 📋 Game Specifications

- **Resolution**: 480×270 (virtual), scaled to fit
- **Physics**: Matter.js at ~900 px/s² gravity
- **Target FPS**: 60 (PC), 30-60 (mobile)
- **Retry Loop**: < 10 seconds
- **Visual Style**: 1-bit Tron wireframe with neon palette

## 🎯 Future Enhancements

- Leaderboard system with 3-character initials (IndexedDB)
- Additional hazards and power-ups
- Mobile touch controls
- Music and sound effects
- More terrain variety
- Perfect landing detection
- Replay system

## 📝 Version

**2.0.0** - Complete rebuild with clean, focused architecture

---

Built with ⚡ by Claude Code
