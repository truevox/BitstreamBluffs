# Common Issues and Solutions

## Phaser + jsdom Canvas API incompatibility in CI

**Problem:**
Phaser expects a real browser Canvas API, but jsdom (used by Jest in CI/Netlify) does not implement the full Canvas 2D context. This causes errors like:

    TypeError: Cannot set properties of null (setting 'fillStyle')

when Phaser tries to use `getContext('2d')` on a canvas element.

**Solution:**
A Jest setup file (`jest.setup.js`) mocks the Canvas 2D context so Phaser does not crash in jsdom-based CI environments. See that file for the mock implementation.

- Make sure `setupFiles` in Jest config includes `jest.setup.js`.
- See also llm-notes.md for further context.


## Game Physics Issues

### 🐞 Issue: "Cannot read properties of undefined (reading 'position')"

**Description:**  
When adding collectible objects in Phaser 3 with Matter.js physics, accessing physics properties on objects that are being destroyed can cause reference errors.

**Root Cause:**  
1. Race conditions between rendering and physics cycles
2. Tweens continuing to reference objects after they're destroyed
3. Physics bodies being destroyed before visual objects or vice versa

**Solution:**  
Use a decoupled approach where:
1. Create separate entities for physics (collider) and visuals (sprite)
2. Manually coordinate their positions with event listeners
3. Avoid tweens or complex animations on physics objects
4. Use distance-based cleanup instead of screen-bounds based cleanup
5. Always check for valid properties before accessing nested values
6. Add comprehensive try/catch blocks around all position-related code

**Implementation:**
```javascript
// Create separate visual sprite
const sprite = this.add.sprite(x, y, 'texture');

// Create separate physics body
const collider = this.matter.add.circle(x, y, radius, {
    isSensor: true,
    isCollectible: true
});

// Link them together
sprite.collider = collider;
collider.gameObject = sprite;

// Update positions safely in the game loop
this.events.on('update', () => {
    if (sprite && !sprite.destroyed && collider && collider.position) {
        try {
            sprite.x = collider.position.x;
            sprite.y = collider.position.y;
        } catch (e) {
            // Handle errors gracefully
        }
    }
});
```

## Jest Environment Issues (window/Phaser/crypto)

### 🐞 Issue: "window is not defined", "Phaser is not defined", or Web Crypto API errors in Jest

**Description:**
- Tests that use Phaser, DOM APIs, or browser globals fail in Node environment.
- Typical errors: `window is not defined`, `Phaser is not defined`, `ReferenceError: window.crypto`.

**Solution:**
- Jest config now defaults to `testEnvironment: jsdom` (see package.json and llm-notes.md).
- For Node-only tests, add this at the top of the test file:
  ```js
  /**
   * @jest-environment node
   */
  ```

---

## Asset Loading Issues

### 🐞 Issue: "Failed to process file: image [filename]"

**Description:**  
Image assets fail to load, causing missing textures in the game.

**Root Cause:**  
1. Missing image files
2. Incorrect path to assets
3. Server permissions issues

**Solution:**  
1. Add proper error handling for asset loading
2. Create fallback textures programmatically when assets can't be loaded
3. Check that assets exist before trying to use them

**Implementation:**
```javascript
// Handle missing image
this.load.on('loaderror', (file) => {
    if (file.key === 'texture') {
        console.warn('Failed to load texture, creating a fallback');
        // Create a fallback texture with graphics
        const graphics = this.make.graphics({x: 0, y: 0, add: false});
        graphics.fillStyle(0xff00ff, 1);
        graphics.fillCircle(32, 32, 25);
        graphics.generateTexture('texture', 64, 64);
    }
});
```
