# LLM Notes

## Puppeteer Use in CI/CD
- Puppeteer is still required for internal and CI test runs (see test:puppeteer and test:all npm scripts).
- In Netlify production builds, Chromium download is skipped (`PUPPETEER_SKIP_DOWNLOAD=1` in netlify.toml) to speed up deploys and avoid unnecessary binary downloads.
- **Do not remove Puppeteer from devDependencies or test scripts.**
- If you re-enable browser-based end-to-end tests in production builds, remove or adjust the env var in netlify.toml.

---

## Common API Misuse: RotationSystem.update

### Issue
- The `RotationSystem.update` method must always be called with an object containing `{ grounded, currentAngle, deltaRotation }`.
- Passing a single value (e.g., `this.player.rotation`) is incorrect and will break flip/rotation tracking.

### Why this matters
- The system relies on full state for tracking flips, landings, and points.
- Incorrect calls can cause subtle bugs in gameplay logic.

### Example of correct usage
```js
this.rotationSystem.update({
  grounded: this.onGround,
  currentAngle: Phaser.Math.RadToDeg(this.player.body.angle),
  deltaRotation: deltaRotation
});
```

### Example of incorrect usage
```js
// ❌ Do not do this:
this.rotationSystem.update(this.player.rotation);
```

### Resolution
- All calls in ModularGameScene.js now use the correct state object.
- See commit :bug: Remove invalid RotationSystem.update(this.player.rotation) call; now always pass full state object per API


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
