# LLM Notes:

## Parallax Starfield Background:

### Why this approach?
- Modular starfield background logic is factored into `js/background/StarfieldParallax.js`.
- Keeps parallax/background code out of gameplay-heavy scene files.
- All stars are rendered at a Phaser depth (`setDepth(-100)`) behind terrain, player, and collectables (which use higher depths).
- Supports easy reuse in any scene.

### Usage
- Import and instantiate `StarfieldParallax` as the first display object in your scene.
- Call its `update(camera)` in your scene's update loop for smooth parallax.
- Starfield parameters (layers, colors, speeds, etc.) are configurable via constructor options.

### Integration Example
```js
import StarfieldParallax from './background/StarfieldParallax.js';

// In your scene's create():
this.starfield = new StarfieldParallax(this, {/* options */});
this.add.existing(this.starfield); // Should be first to ensure it's behind everything

// In your scene's update():
this.starfield.update(this.cameras.main);
```

### Notes
- See StarfieldParallax.js for full API and documentation.
- This approach avoids z-order bugs and keeps backgrounds performant.
